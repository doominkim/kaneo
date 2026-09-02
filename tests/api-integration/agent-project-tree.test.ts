import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  agentActorTable,
  agentArtifactTable,
  agentDocumentTable,
  agentEntryTable,
} from "../../apps/api/src/database/schema-agent-layer";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type TreeNode = {
  id: string;
  number: number | null;
  title: string;
  status: string;
  done: boolean;
  createdAt: string;
  updatedAt: string;
  branches: Array<{ repo?: string; branch: string }>;
  documents: Array<{
    id: string;
    slug: string;
    title: string;
    actorId: string | null;
    updatedBy: string | null;
    updatedAt: string;
  }>;
  attachments: Array<{
    id: string;
    name: string;
    contentType: string;
    size: number;
    createdAt: string;
  }>;
  usage: {
    entryCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    byModel: Record<string, number>;
  };
  children: TreeNode[];
};

type Tree = { nodes: TreeNode[] };

let taskCounter = 0;

async function seedTask(
  projectId: string,
  columnId: string,
  title: string,
  overrides: Partial<typeof schema.taskTable.$inferInsert> = {},
) {
  taskCounter += 1;
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId,
      title,
      description: "",
      priority: "medium",
      status: "to-do",
      columnId,
      number: taskCounter,
      position: taskCounter,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, taskCounter)),
      ...overrides,
    })
    .returning();
  return task;
}

async function relate(parentId: string, childId: string) {
  await db.insert(schema.taskRelationTable).values({
    sourceTaskId: parentId,
    targetTaskId: childId,
    relationType: "subtask",
  });
}

async function fetchTree(projectId: string) {
  const { app } = createApp();
  const response = await app.request(`/api/agent-project/${projectId}/tree`);
  expect(response.status).toBe(200);
  return (await response.json()) as Tree;
}

describe("API integration: agent project tree", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    taskCounter = 0;
  });

  it("rejects anonymous callers and outsiders", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    mockAnonymousSession();
    const anonymous = await createApp().app.request(
      `/api/agent-project/${project.id}/tree`,
    );
    expect(anonymous.status).toBe(401);

    const outsiderId = `user-${randomUUID()}`;
    const [outsider] = await db
      .insert(schema.userTable)
      .values({
        id: outsiderId,
        email: `${outsiderId}@example.com`,
        emailVerified: true,
        name: "Tree Outsider",
      })
      .returning();
    mockAuthenticatedSession(outsider);
    const forbidden = await createApp().app.request(
      `/api/agent-project/${project.id}/tree`,
    );
    expect(forbidden.status).toBe(403);

    mockAuthenticatedSession(member.user);
    const unknown = await createApp().app.request(
      "/api/agent-project/project-missing/tree",
    );
    expect(unknown.status).toBe(400);
  });

  it("returns an empty tree for a project without tasks", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);

    expect(await fetchTree(project.id)).toEqual({ nodes: [] });
  });

  it("nests subtask targets under their parent and orders roots by creation", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    // Seeded out of order on purpose: root order must follow createdAt.
    const second = await seedTask(project.id, columns.todo.id, "second", {
      createdAt: new Date(Date.UTC(2026, 0, 2)),
    });
    const first = await seedTask(project.id, columns.todo.id, "first", {
      createdAt: new Date(Date.UTC(2026, 0, 1)),
    });
    const child = await seedTask(project.id, columns.todo.id, "child");
    const grandchild = await seedTask(
      project.id,
      columns.todo.id,
      "grandchild",
    );
    await relate(first.id, child.id);
    await relate(child.id, grandchild.id);

    // A blocks relation must not create nesting.
    await db.insert(schema.taskRelationTable).values({
      sourceTaskId: second.id,
      targetTaskId: first.id,
      relationType: "blocks",
    });

    mockAuthenticatedSession(member.user);
    const tree = await fetchTree(project.id);

    expect(tree.nodes.map((n) => n.title)).toEqual(["first", "second"]);
    const [root] = tree.nodes;
    expect(root.children.map((n) => n.title)).toEqual(["child"]);
    expect(root.children[0].children.map((n) => n.title)).toEqual([
      "grandchild",
    ]);
    expect(root).toMatchObject({
      id: first.id,
      number: first.number,
      status: "to-do",
      done: false,
      branches: [],
      documents: [],
      attachments: [],
      usage: {
        entryCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        byModel: {},
      },
    });
  });

  it("ignores subtask relations whose child lives in another project", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const other = await createProjectFixture({
      workspaceId: member.workspace.id,
      name: "Other",
    });
    const parent = await seedTask(project.id, columns.todo.id, "parent");
    const foreign = await seedTask(
      other.project.id,
      other.columns.todo.id,
      "foreign",
    );
    await relate(parent.id, foreign.id);

    mockAuthenticatedSession(member.user);
    const tree = await fetchTree(project.id);

    expect(tree.nodes).toHaveLength(1);
    expect(tree.nodes[0].children).toEqual([]);
  });

  it("marks done from the column's isFinal or a done/archived status", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await seedTask(project.id, columns.done.id, "in final column", {
      status: "done",
    });
    await seedTask(project.id, columns.inProgress.id, "open", {
      status: "in-progress",
    });
    // No column at all — status is the only signal left.
    await seedTask(project.id, columns.todo.id, "archived without column", {
      status: "archived",
      columnId: null,
    });

    mockAuthenticatedSession(member.user);
    const tree = await fetchTree(project.id);

    expect(
      Object.fromEntries(tree.nodes.map((n) => [n.title, n.done])),
    ).toEqual({
      "in final column": true,
      open: false,
      "archived without column": true,
    });
  });

  it("derives distinct branches newest first and rolls usage up per model", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id, "task");
    const untouched = await seedTask(project.id, columns.todo.id, "untouched");

    const [claude] = await db
      .insert(agentActorTable)
      .values({
        workspaceId: member.workspace.id,
        provider: "anthropic",
        model: "claude-opus-5",
      })
      .returning();
    const [gpt] = await db
      .insert(agentActorTable)
      .values({
        workspaceId: member.workspace.id,
        provider: "openai",
        model: "gpt-5.6",
      })
      .returning();

    const base = Date.UTC(2026, 1, 1);
    const entries = [
      {
        actorId: claude.id,
        refs: { repo: "doominkim/kaneo", branch: "feat/a", commits: ["1"] },
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      },
      {
        actorId: gpt.id,
        refs: { repo: "doominkim/kaneo", branch: "feat/b" },
        // No totalTokens: falls back to input + output.
        usage: { inputTokens: 10, outputTokens: 5 },
      },
      {
        actorId: claude.id,
        // Same branch again, and a different repo for the same branch name.
        refs: { repo: "doominkim/kaneo", branch: "feat/a" },
        usage: { totalTokens: 20 },
      },
      {
        actorId: null,
        refs: { branch: "feat/a" },
        usage: { totalTokens: 7 },
      },
      {
        actorId: claude.id,
        // No usage at all: counted, adds nothing.
        refs: null,
        usage: null,
      },
    ];
    for (const [index, spec] of entries.entries()) {
      await db.insert(agentEntryTable).values({
        workspaceId: member.workspace.id,
        projectId: project.id,
        taskId: task.id,
        actorId: spec.actorId,
        summary: `entry ${index}`,
        refs: spec.refs,
        usage: spec.usage,
        createdAt: new Date(base + index * 60_000),
      });
    }
    // An entry on another task must not leak into this one's rollup.
    await db.insert(agentEntryTable).values({
      workspaceId: member.workspace.id,
      projectId: project.id,
      taskId: null,
      summary: "project-level",
      usage: { totalTokens: 9999 },
    });

    mockAuthenticatedSession(member.user);
    const tree = await fetchTree(project.id);
    const node = tree.nodes.find((n) => n.id === task.id);
    const other = tree.nodes.find((n) => n.id === untouched.id);

    // Newest entry first: the repo-less feat/a (entry 3) is the most recent
    // distinct pair, then feat/a with repo (entry 2), then feat/b (entry 1).
    expect(node?.branches).toEqual([
      { branch: "feat/a" },
      { repo: "doominkim/kaneo", branch: "feat/a" },
      { repo: "doominkim/kaneo", branch: "feat/b" },
    ]);
    expect(node?.usage).toEqual({
      entryCount: 5,
      inputTokens: 110,
      outputTokens: 55,
      totalTokens: 150 + 15 + 20 + 7,
      byModel: { "claude-opus-5": 170, "gpt-5.6": 15, unknown: 7 },
    });
    expect(other?.usage.entryCount).toBe(0);
  });

  it("hangs linked documents and finalized artifacts as leaves", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id, "with leaves");
    const bare = await seedTask(project.id, columns.todo.id, "bare");

    const [doc] = await db
      .insert(agentDocumentTable)
      .values({
        workspaceId: member.workspace.id,
        projectId: project.id,
        taskId: task.id,
        slug: "report",
        title: "Report",
        body: "x".repeat(10_000),
        updatedBy: member.user.id,
      })
      .returning();
    // A project-level document (no task) is not a leaf of any node.
    await db.insert(agentDocumentTable).values({
      workspaceId: member.workspace.id,
      projectId: project.id,
      slug: "unlinked",
      title: "Unlinked",
      body: "y",
      updatedBy: member.user.id,
    });
    // Two finalized artifacts (newest first), one still pending (invisible),
    // one project-level (no task, so not a leaf).
    const artifactBase = {
      workspaceId: member.workspace.id,
      projectId: project.id,
      uploadedBy: member.user.id,
    };
    const [older] = await db
      .insert(agentArtifactTable)
      .values({
        ...artifactBase,
        taskId: task.id,
        name: "report.html",
        contentType: "text/html",
        size: 4096,
        storageKey: `agent-artifacts/${member.workspace.id}/${project.id}/a1/report.html`,
        finalizedAt: new Date(Date.UTC(2026, 2, 1)),
        createdAt: new Date(Date.UTC(2026, 2, 1)),
      })
      .returning();
    const [newer] = await db
      .insert(agentArtifactTable)
      .values({
        ...artifactBase,
        taskId: task.id,
        name: "bundle.zip",
        contentType: "application/zip",
        size: 65536,
        storageKey: `agent-artifacts/${member.workspace.id}/${project.id}/a2/bundle.zip`,
        finalizedAt: new Date(Date.UTC(2026, 2, 2)),
        createdAt: new Date(Date.UTC(2026, 2, 2)),
      })
      .returning();
    await db.insert(agentArtifactTable).values([
      {
        ...artifactBase,
        taskId: task.id,
        name: "pending.pdf",
        contentType: "application/pdf",
        size: 1,
        storageKey: `agent-artifacts/${member.workspace.id}/${project.id}/a3/pending.pdf`,
        finalizedAt: null,
      },
      {
        ...artifactBase,
        taskId: null,
        name: "project-level.md",
        contentType: "text/markdown",
        size: 1,
        storageKey: `agent-artifacts/${member.workspace.id}/${project.id}/a4/project-level.md`,
        finalizedAt: new Date(),
      },
    ]);
    // An upstream asset row on the task is NOT surfaced: attachments come
    // from the fork-owned agent_artifact table, not from `asset`.
    await db.insert(schema.assetTable).values({
      workspaceId: member.workspace.id,
      projectId: project.id,
      taskId: task.id,
      objectKey: `tasks/${task.id}/bundle.zip`,
      filename: "bundle.zip",
      mimeType: "application/zip",
      size: 1234,
      kind: "attachment",
      surface: "description",
      createdBy: member.user.id,
    });

    mockAuthenticatedSession(member.user);
    const tree = await fetchTree(project.id);
    const node = tree.nodes.find((n) => n.id === task.id);
    const bareNode = tree.nodes.find((n) => n.id === bare.id);

    expect(node?.documents).toEqual([
      {
        id: doc.id,
        slug: "report",
        title: "Report",
        actorId: null,
        updatedBy: member.user.id,
        updatedAt: doc.updatedAt.toISOString(),
      },
    ]);
    // Leaves carry no body — that is what keeps the tree bounded.
    expect(JSON.stringify(tree)).not.toContain("xxxxxxxxxx");
    expect(node?.attachments).toEqual([
      {
        id: newer.id,
        name: "bundle.zip",
        contentType: "application/zip",
        size: 65536,
        createdAt: newer.createdAt.toISOString(),
      },
      {
        id: older.id,
        name: "report.html",
        contentType: "text/html",
        size: 4096,
        createdAt: older.createdAt.toISOString(),
      },
    ]);
    // No storage key or URL in the tree — URLs are minted per click.
    expect(JSON.stringify(node?.attachments)).not.toContain("agent-artifacts/");
    expect(bareNode?.documents).toEqual([]);
    expect(bareNode?.attachments).toEqual([]);
  });

  it("terminates on a relation cycle and still shows every task", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const a = await seedTask(project.id, columns.todo.id, "a");
    const b = await seedTask(project.id, columns.todo.id, "b");
    const c = await seedTask(project.id, columns.todo.id, "c");
    const root = await seedTask(project.id, columns.todo.id, "root");
    // root -> a -> b -> c -> a
    await relate(root.id, a.id);
    await relate(a.id, b.id);
    await relate(b.id, c.id);
    await relate(c.id, a.id);
    // A detached cycle: nothing points into it from a root.
    const x = await seedTask(project.id, columns.todo.id, "x");
    const y = await seedTask(project.id, columns.todo.id, "y");
    await relate(x.id, y.id);
    await relate(y.id, x.id);

    mockAuthenticatedSession(member.user);
    const tree = await fetchTree(project.id);

    expect(tree.nodes.map((n) => n.title)).toEqual(["root", "x"]);
    const chain: string[] = [];
    let cursor: TreeNode | undefined = tree.nodes[0];
    while (cursor) {
      chain.push(cursor.title);
      cursor = cursor.children[0];
    }
    // c's child a is an ancestor, so the walk stops there.
    expect(chain).toEqual(["root", "a", "b", "c"]);

    const detached = tree.nodes[1];
    expect(detached.children.map((n) => n.title)).toEqual(["y"]);
    expect(detached.children[0].children).toEqual([]);
  });

  it("documents the node as a recursive OpenAPI component", async () => {
    const { app } = createApp();
    const spec = (await (await app.request("/api/openapi")).json()) as {
      paths: Record<string, unknown>;
      components: {
        schemas: Record<string, { properties?: Record<string, unknown> }>;
      };
    };

    expect(spec.paths).toHaveProperty("/agent-project/{projectId}/tree");
    const node = spec.components.schemas.AgentTreeNode;
    expect(node?.properties?.children).toEqual({
      type: "array",
      items: { $ref: "#/components/schemas/AgentTreeNode" },
    });
  });
});
