import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  agentActorTable,
  agentDocumentTable,
} from "../../apps/api/src/database/schema-agent-layer";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import { mcpToolCall, toolJson } from "./helpers/mcp";

type DocumentSummary = {
  id: string;
  slug: string;
  title: string;
  taskId: string | null;
  updatedBy: string | null;
  actorId: string | null;
  updatedAt: string;
};

type DocumentDetail = DocumentSummary & {
  workspaceId: string;
  projectId: string;
  body: string;
  createdAt: string;
};

type DocumentList = { documents: DocumentSummary[] };

function putBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    title: "Session report",
    body: "# Report\n\nDone.",
    ...overrides,
  });
}

function put(
  app: ReturnType<typeof createApp>["app"],
  projectId: string,
  slug: string,
  body: string = putBody(),
) {
  return app.request(`/api/agent-document/${projectId}/${slug}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body,
  });
}

async function seedTask(projectId: string, columnId: string, number: number) {
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId,
      title: `Seeded task ${number}`,
      description: "",
      priority: "medium",
      status: "to-do",
      columnId,
      number,
      position: number,
    })
    .returning();
  return task;
}

async function seedOutsider(name: string) {
  const outsiderId = `user-${randomUUID()}`;
  const [outsider] = await db
    .insert(schema.userTable)
    .values({
      id: outsiderId,
      email: `${outsiderId}@example.com`,
      emailVerified: true,
      name,
    })
    .returning();
  return outsider;
}

describe("API integration: agent documents", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects unauthenticated list and put", async () => {
    mockAnonymousSession();
    const { app } = createApp();

    const list = await app.request("/api/agent-document/project-missing");
    const write = await put(app, "project-missing", "report");

    expect(list.status).toBe(401);
    expect(write.status).toBe(401);
  });

  it("rejects an unknown project", async () => {
    const member = await createWorkspaceMember();
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request(
      "/api/agent-document/project-does-not-exist",
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe(
      "Workspace ID could not be determined",
    );
  });

  it("rejects users outside the project workspace", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const outsider = await seedOutsider("Document Outsider");

    mockAuthenticatedSession(outsider);
    const { app } = createApp();

    const list = await app.request(`/api/agent-document/${project.id}`);
    const write = await put(app, project.id, "report");

    expect(list.status).toBe(403);
    expect(write.status).toBe(403);
    await expect(list.text()).resolves.toBe(
      "You don't have access to this workspace",
    );
  });

  it("creates a document for a member and stamps the human author", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const empty = (await (
      await app.request(`/api/agent-document/${project.id}`)
    ).json()) as DocumentList;
    expect(empty).toEqual({ documents: [] });

    const response = await put(app, project.id, "session-report");
    expect(response.status).toBe(200);
    const payload = (await response.json()) as DocumentDetail;

    expect(payload).toMatchObject({
      workspaceId: member.workspace.id,
      projectId: project.id,
      slug: "session-report",
      title: "Session report",
      body: "# Report\n\nDone.",
      taskId: null,
      updatedBy: member.user.id,
      actorId: null,
    });

    const list = (await (
      await app.request(`/api/agent-document/${project.id}`)
    ).json()) as DocumentList;
    expect(list.documents).toHaveLength(1);
    expect(list.documents[0]).toMatchObject({
      id: payload.id,
      slug: "session-report",
      title: "Session report",
      updatedBy: member.user.id,
      actorId: null,
    });
    // Listing never ships bodies.
    expect(list.documents[0]).not.toHaveProperty("body");

    const detail = await app.request(
      `/api/agent-document/${project.id}/session-report`,
    );
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as DocumentDetail).body).toBe(
      "# Report\n\nDone.",
    );
  });

  it("replaces an existing slug in place and clears a previous agent author", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const [actor] = await db
      .insert(agentActorTable)
      .values({
        workspaceId: member.workspace.id,
        provider: "anthropic",
        model: "claude-opus-5",
      })
      .returning();
    const [seeded] = await db
      .insert(agentDocumentTable)
      .values({
        workspaceId: member.workspace.id,
        projectId: project.id,
        slug: "design-packet",
        title: "Agent draft",
        body: "agent body",
        actorId: actor.id,
        updatedAt: new Date(Date.UTC(2026, 0, 1)),
      })
      .returning();

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await put(
      app,
      project.id,
      "design-packet",
      putBody({ title: "Human revision", body: "human body" }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as DocumentDetail;

    // Same row, new content, authorship flipped to the human.
    expect(payload.id).toBe(seeded.id);
    expect(payload).toMatchObject({
      title: "Human revision",
      body: "human body",
      updatedBy: member.user.id,
      actorId: null,
    });
    expect(new Date(payload.updatedAt).getTime()).toBeGreaterThan(
      seeded.updatedAt.getTime(),
    );

    const rows = await db
      .select()
      .from(agentDocumentTable)
      .where(eq(agentDocumentTable.projectId, project.id));
    expect(rows).toHaveLength(1);
  });

  it("blocks a viewer from writing but lets them read", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: admin.workspace.id,
    });
    await db.insert(agentDocumentTable).values({
      workspaceId: admin.workspace.id,
      projectId: project.id,
      slug: "readable",
      title: "Readable",
      body: "body",
      updatedBy: admin.user.id,
    });

    const viewerId = `user-${randomUUID()}`;
    const [viewer] = await db
      .insert(schema.userTable)
      .values({
        id: viewerId,
        email: `${viewerId}@example.com`,
        emailVerified: true,
        name: "Viewer",
      })
      .returning();
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: admin.workspace.id,
      userId: viewer.id,
      role: "viewer",
      joinedAt: new Date(),
    });

    mockAuthenticatedSession(viewer);
    const { app } = createApp();

    const write = await put(app, project.id, "readable");
    expect(write.status).toBe(403);
    await expect(write.text()).resolves.toBe("Insufficient permissions");

    const list = await app.request(`/api/agent-document/${project.id}`);
    expect(list.status).toBe(200);
    const detail = await app.request(
      `/api/agent-document/${project.id}/readable`,
    );
    expect(detail.status).toBe(200);
  });

  it("requires project:update to delete — member 403, admin 200, then 404", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: admin.workspace.id,
    });
    const [doc] = await db
      .insert(agentDocumentTable)
      .values({
        workspaceId: admin.workspace.id,
        projectId: project.id,
        slug: "deletable",
        title: "Deletable",
        body: "body",
        updatedBy: admin.user.id,
      })
      .returning();

    const memberId = `user-${randomUUID()}`;
    const [member] = await db
      .insert(schema.userTable)
      .values({
        id: memberId,
        email: `${memberId}@example.com`,
        emailVerified: true,
        name: "Member",
      })
      .returning();
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: admin.workspace.id,
      userId: member.id,
      role: "member",
      joinedAt: new Date(),
    });

    mockAuthenticatedSession(member);
    const asMember = createApp().app;
    const forbidden = await asMember.request(
      `/api/agent-document/${project.id}/deletable`,
      { method: "DELETE" },
    );
    expect(forbidden.status).toBe(403);
    await expect(forbidden.text()).resolves.toBe("Insufficient permissions");

    mockAuthenticatedSession(admin.user);
    const asAdmin = createApp().app;
    const deleted = await asAdmin.request(
      `/api/agent-document/${project.id}/deletable`,
      { method: "DELETE" },
    );
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ id: doc.id, slug: "deletable" });

    const gone = await asAdmin.request(
      `/api/agent-document/${project.id}/deletable`,
    );
    expect(gone.status).toBe(404);

    const again = await asAdmin.request(
      `/api/agent-document/${project.id}/deletable`,
      { method: "DELETE" },
    );
    expect(again.status).toBe(404);
    await expect(again.text()).resolves.toBe("Document not found");
  });

  it("validates the slug on every route", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    for (const bad of ["Bad_Slug", "-leading", "a".repeat(65), "with space"]) {
      const write = await put(app, project.id, encodeURIComponent(bad));
      expect(write.status, bad).toBe(400);
      const read = await app.request(
        `/api/agent-document/${project.id}/${encodeURIComponent(bad)}`,
      );
      expect(read.status, bad).toBe(400);
    }

    const longest = await put(app, project.id, "a".repeat(64));
    expect(longest.status).toBe(200);

    const rows = await db
      .select()
      .from(agentDocumentTable)
      .where(eq(agentDocumentTable.projectId, project.id));
    expect(rows).toHaveLength(1);
  });

  it("rejects a body over 200KB and accepts one at the limit", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const tooBig = await put(
      app,
      project.id,
      "big",
      putBody({ body: "x".repeat(200 * 1024 + 1) }),
    );
    expect(tooBig.status).toBe(400);
    await expect(tooBig.text()).resolves.toContain("200KB");

    // Multi-byte characters count by bytes, not by length.
    const multibyte = await put(
      app,
      project.id,
      "big",
      putBody({ body: "가".repeat(70 * 1024) }),
    );
    expect(multibyte.status).toBe(400);

    const atLimit = await put(
      app,
      project.id,
      "big",
      putBody({ body: "x".repeat(200 * 1024) }),
    );
    expect(atLimit.status).toBe(200);
  });

  it("requires taskId to belong to the project", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const other = await createProjectFixture({
      workspaceId: member.workspace.id,
      name: "Other",
    });
    const ownTask = await seedTask(project.id, columns.todo.id, 1);
    const foreignTask = await seedTask(
      other.project.id,
      other.columns.todo.id,
      1,
    );

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const foreign = await put(
      app,
      project.id,
      "linked",
      putBody({ taskId: foreignTask.id }),
    );
    expect(foreign.status).toBe(400);
    await expect(foreign.text()).resolves.toBe(
      "taskId does not belong to this project",
    );

    const unknown = await put(
      app,
      project.id,
      "linked",
      putBody({ taskId: "task-does-not-exist" }),
    );
    expect(unknown.status).toBe(400);

    const own = await put(
      app,
      project.id,
      "linked",
      putBody({ taskId: ownTask.id }),
    );
    expect(own.status).toBe(200);
    expect(((await own.json()) as DocumentDetail).taskId).toBe(ownTask.id);

    // Re-saving without taskId unlinks it — the body is a full replacement.
    const unlinked = await put(app, project.id, "linked");
    expect(((await unlinked.json()) as DocumentDetail).taskId).toBeNull();
  });

  it("keeps slugs project-scoped: same slug in two projects, and no cross-project reads", async () => {
    const member = await createWorkspaceMember();
    const first = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const second = await createProjectFixture({
      workspaceId: member.workspace.id,
      name: "Second",
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const a = (await (
      await put(app, first.project.id, "report", putBody({ title: "A" }))
    ).json()) as DocumentDetail;
    const b = (await (
      await put(app, second.project.id, "report", putBody({ title: "B" }))
    ).json()) as DocumentDetail;
    expect(a.id).not.toBe(b.id);

    const missing = await app.request(
      `/api/agent-document/${first.project.id}/only-in-second`,
    );
    expect(missing.status).toBe(404);
    await expect(missing.text()).resolves.toBe("Document not found");

    await put(app, second.project.id, "only-in-second");
    const crossProject = await app.request(
      `/api/agent-document/${first.project.id}/only-in-second`,
    );
    expect(crossProject.status).toBe(404);
  });

  it("survives task deletion with taskId set to null", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id, 1);

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const saved = (await (
      await put(app, project.id, "orphan", putBody({ taskId: task.id }))
    ).json()) as DocumentDetail;

    await db.delete(schema.taskTable).where(eq(schema.taskTable.id, task.id));

    const [row] = await db
      .select()
      .from(agentDocumentTable)
      .where(eq(agentDocumentTable.id, saved.id));
    expect(row).toBeDefined();
    expect(row?.taskId).toBeNull();
  });

  describe("MCP path (agent_doc_put / agent_doc_get)", () => {
    const identity = { provider: "anthropic", model: "claude-opus-5" };

    it("attributes the write to an agent actor on behalf of the session user", async () => {
      const member = await createWorkspaceMember();
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, columns.todo.id, 1);
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const result = await mcpToolCall(app, "agent_doc_put", {
        projectId: project.id,
        slug: "session-report",
        title: "Session report",
        body: "# Report\n\nby agent",
        taskId: task.id,
        ...identity,
      });
      expect(result.isError, result.content[0]?.text).toBeUndefined();
      const saved = toolJson<DocumentSummary>(result);
      expect(saved.actorId).toEqual(expect.any(String));
      expect(saved).toEqual({
        id: expect.any(String),
        slug: "session-report",
        title: "Session report",
        taskId: task.id,
        actorId: saved.actorId,
        updatedAt: expect.any(String),
      });
      // The put response never echoes the body back.
      expect(saved).not.toHaveProperty("body");

      const [row] = await db
        .select()
        .from(agentDocumentTable)
        .where(eq(agentDocumentTable.id, saved.id));
      expect(row).toMatchObject({
        workspaceId: member.workspace.id,
        projectId: project.id,
        body: "# Report\n\nby agent",
        updatedBy: null,
        actorId: saved.actorId,
      });
      const [actor] = await db
        .select()
        .from(agentActorTable)
        .where(eq(agentActorTable.id, saved.actorId as string));
      expect(actor).toMatchObject({
        workspaceId: member.workspace.id,
        onBehalfOf: member.user.id,
        provider: "anthropic",
        model: "claude-opus-5",
      });

      // Read back through the HTTP surface: agent author, no human author.
      const detail = (await (
        await app.request(`/api/agent-document/${project.id}/session-report`)
      ).json()) as DocumentDetail;
      expect(detail).toMatchObject({ updatedBy: null, actorId: saved.actorId });
    });

    it("flips authorship both ways: agent overwrite clears updatedBy, human overwrite clears actorId", async () => {
      const member = await createWorkspaceMember();
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const human = (await (
        await put(app, project.id, "packet", putBody({ title: "Human" }))
      ).json()) as DocumentDetail;
      expect(human).toMatchObject({ updatedBy: member.user.id, actorId: null });

      const agent = toolJson<DocumentSummary>(
        await mcpToolCall(app, "agent_doc_put", {
          projectId: project.id,
          slug: "packet",
          title: "Agent",
          body: "agent body",
          ...identity,
        }),
      );
      expect(agent.id).toBe(human.id);
      const [afterAgent] = await db
        .select()
        .from(agentDocumentTable)
        .where(eq(agentDocumentTable.id, human.id));
      expect(afterAgent).toMatchObject({
        title: "Agent",
        updatedBy: null,
        actorId: agent.actorId,
      });

      await put(app, project.id, "packet", putBody({ title: "Human again" }));
      const [afterHuman] = await db
        .select()
        .from(agentDocumentTable)
        .where(eq(agentDocumentTable.id, human.id));
      expect(afterHuman).toMatchObject({
        title: "Human again",
        updatedBy: member.user.id,
        actorId: null,
      });
      // Still one row, one actor.
      expect(
        await db
          .select()
          .from(agentDocumentTable)
          .where(eq(agentDocumentTable.projectId, project.id)),
      ).toHaveLength(1);
      expect(await db.select().from(agentActorTable)).toHaveLength(1);
    });

    it("enforces workspace access and task:update on the in-process path", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      const { project } = await createProjectFixture({
        workspaceId: admin.workspace.id,
      });
      const args = {
        projectId: project.id,
        slug: "blocked",
        title: "Blocked",
        body: "x",
        ...identity,
      };

      const outsider = await seedOutsider("MCP Outsider");
      mockAuthenticatedSession(outsider);
      const denied = await mcpToolCall(createApp().app, "agent_doc_put", args);
      expect(denied.isError).toBe(true);
      expect(toolJson(denied)).toEqual({
        error: "403 You don't have access to this workspace",
      });

      const viewerId = `user-${randomUUID()}`;
      const [viewer] = await db
        .insert(schema.userTable)
        .values({
          id: viewerId,
          email: `${viewerId}@example.com`,
          emailVerified: true,
          name: "Viewer",
        })
        .returning();
      await db.insert(schema.workspaceUserTable).values({
        workspaceId: admin.workspace.id,
        userId: viewer.id,
        role: "viewer",
        joinedAt: new Date(),
      });
      mockAuthenticatedSession(viewer);
      const forbidden = await mcpToolCall(
        createApp().app,
        "agent_doc_put",
        args,
      );
      expect(forbidden.isError).toBe(true);
      expect(toolJson(forbidden)).toEqual({
        error: "403 Insufficient permissions",
      });
      // No actor row is minted for a caller who was refused authorization.
      expect(await db.select().from(agentActorTable)).toEqual([]);

      mockAuthenticatedSession(admin.user);
      const unknownProject = await mcpToolCall(
        createApp().app,
        "agent_doc_put",
        {
          ...args,
          projectId: "project-missing",
        },
      );
      expect(toolJson(unknownProject)).toEqual({
        error: "400 Workspace ID could not be determined",
      });
      const foreignTask = await mcpToolCall(createApp().app, "agent_doc_put", {
        ...args,
        taskId: "task-missing",
      });
      expect(toolJson(foreignTask)).toEqual({
        error: "400 taskId does not belong to this project",
      });

      expect(await db.select().from(agentDocumentTable)).toEqual([]);
    });

    it("agent_doc_get reads the agent-authored document back in 8KB windows", async () => {
      const member = await createWorkspaceMember();
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();
      // The tool reaches the API over HTTP; route that into the same app.
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input));
          return app.request(`${url.pathname}${url.search}`, init);
        }),
      );

      const body = "가".repeat(4000);
      const saved = toolJson<DocumentSummary>(
        await mcpToolCall(app, "agent_doc_put", {
          projectId: project.id,
          slug: "long",
          title: "Long",
          body,
          ...identity,
        }),
      );

      const first = toolJson<Record<string, unknown>>(
        await mcpToolCall(app, "agent_doc_get", {
          projectId: project.id,
          slug: "long",
        }),
      );
      expect(first).toMatchObject({
        id: saved.id,
        updatedBy: null,
        actorId: saved.actorId,
        bodyBytes: 12_000,
        offset: 0,
        nextOffset: 8190,
        truncated: true,
      });
      expect(first.body).toBe("가".repeat(2730));

      const rest = toolJson<Record<string, unknown>>(
        await mcpToolCall(app, "agent_doc_get", {
          projectId: project.id,
          slug: "long",
          offset: first.nextOffset,
        }),
      );
      expect(rest).toMatchObject({ nextOffset: null, truncated: false });
      expect(`${first.body}${rest.body}`).toBe(body);
    });
  });
});
