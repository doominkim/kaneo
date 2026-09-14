import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiKeyMock = vi.hoisted(() => ({
  verifyApiKey: vi.fn(async () => null as unknown),
}));
vi.mock("../../apps/api/src/utils/verify-api-key", () => apiKeyMock);

import db, { schema } from "../../apps/api/src/database";
import {
  agentActorTable,
  agentDecisionTable,
  agentDecisionTaskTable,
  agentEntryTable,
} from "../../apps/api/src/database/schema-agent-layer";
import { createApp } from "../../apps/api/src/index";
import moveTask from "../../apps/api/src/task/controllers/move-task";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import { mcpToolCall, toolJson } from "./helpers/mcp";

type App = ReturnType<typeof createApp>["app"];
type DecisionRef = { id: string; status: string } | null;
type Decision = {
  id: string;
  workspaceId: string;
  projectId: string;
  number: number;
  title: string;
  context: string;
  decision: string;
  alternatives: string | null;
  consequences: string | null;
  sourceNote: string | null;
  status: "accepted" | "superseded";
  sourceEntryId: string | null;
  supersedesDecisionId: string | null;
  tasks: Array<{ id: string; number: number | null; title: string }>;
  createdBy: string | null;
  createdAuthor: { userId: string; name: string } | null;
  createdActor: { id: string; provider: string; model: string } | null;
  updatedBy: string | null;
  updatedAuthor: { userId: string; name: string } | null;
  acceptedBy: string | null;
  acceptedAt: string | null;
  acceptor: { userId: string; name: string } | null;
  reviewed: boolean;
  reviewedAt: string | null;
  reviewedBy: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
  supersedes: DecisionRef;
  supersededBy: DecisionRef;
  updatedAt: string;
};
type DecisionList = {
  decisions: Decision[];
  nextBefore: string | null;
  unreviewedTotal: number;
  acceptedTotal: number;
};

const agent = { provider: "anthropic", model: "claude-opus-5" };
const viaKey = { "x-api-key": "kaneo_test_key" };

async function seedTask(projectId: string, columnId: string, number: number) {
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId,
      title: `ADR linked task ${number}`,
      description: "",
      priority: "medium",
      status: "to-do",
      columnId,
      number,
      position: number,
    })
    .returning();
  if (!task) throw new Error("Failed to seed task");
  return task;
}

async function addMember(workspaceId: string, role: string) {
  const id = `user-${randomUUID()}`;
  const [user] = await db
    .insert(schema.userTable)
    .values({ id, email: `${id}@example.com`, emailVerified: true, name: role })
    .returning();
  await db.insert(schema.workspaceUserTable).values({
    workspaceId,
    userId: user.id,
    role,
    joinedAt: new Date(),
  });
  return user;
}

/** A real apikey row: workspace access checks the key's owner, not just the mocked verifier. */
async function seedApiKey(userId: string) {
  const now = new Date();
  await db
    .insert(schema.apikeyTable)
    .values({
      id: "key-1",
      referenceId: userId,
      userId,
      key: "hashed",
      enabled: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing();
  apiKeyMock.verifyApiKey.mockResolvedValue({
    valid: true,
    key: { id: "key-1", userId, enabled: true, permissions: null },
  });
}

async function createDecision(
  app: App,
  projectId: string,
  overrides: Record<string, unknown> = {},
) {
  return app.request("/api/agent-decision", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectId,
      title: "Adopt an append-only decision history",
      context: "Edits would erase the reason a choice was made.",
      decision: "Record lifecycle changes as new ledger entries.",
      alternatives: "Overwrite the previous entry.",
      consequences: "The timeline grows with each accepted transition.",
      reversible: true,
      taskIds: [],
      ...overrides,
    }),
  });
}

async function jsonDecision(response: Response) {
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as Decision;
}

async function listDecisions(app: App, projectId: string, query = "") {
  const response = await app.request(
    `/api/agent-decision/${projectId}${query ? `?${query}` : ""}`,
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as DecisionList;
}

function lifecycle(
  app: App,
  projectId: string,
  decisionId: string,
  action: "review" | "delete" | "restore",
  headers: Record<string, string> = {},
) {
  const base = `/api/agent-decision/${projectId}/${decisionId}`;
  if (action === "delete") {
    return app.request(base, { method: "DELETE", headers });
  }
  return app.request(`${base}/${action}`, { method: "POST", headers });
}

async function rowOf(decisionId: string) {
  const [row] = await db
    .select()
    .from(agentDecisionTable)
    .where(eq(agentDecisionTable.id, decisionId));
  return row;
}

async function entriesFor(projectId: string) {
  return db
    .select()
    .from(agentEntryTable)
    .where(eq(agentEntryTable.projectId, projectId));
}

type AdrTrace = {
  decisionId: string;
  status: string;
  supersedesDecisionId?: string;
  supersededByDecisionId?: string;
};

function adrOf(entry: { decision: unknown }) {
  return (entry.decision as { adr?: AdrTrace } | null)?.adr ?? null;
}

type ToolDecisionRow = {
  id: string;
  number: number;
  title: string;
  status: string;
  reviewed: boolean;
  author: string | null;
  tasks: Array<number | string>;
};
type ToolDecisionList = {
  decisions: ToolDecisionRow[];
  nextBefore: string | null;
  unreviewedTotal: number;
};
type ToolDecisionPut = {
  id: string;
  number: number;
  status: string;
  reviewed: boolean;
  supersedes: number | null;
  taskIds: string[];
};

/** The MCP read tools reach the API over HTTP; route that into the same app. */
function routeFetchInto(app: App) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      return app.request(`${url.pathname}${url.search}`, init);
    }),
  );
}

function adrInput(projectId: string, overrides: Record<string, unknown> = {}) {
  return {
    projectId,
    title: "Cache project boards in memory",
    context: "Boards are read far more often than written.",
    decision: "Keep a per-project board cache invalidated by events.",
    ...agent,
    ...overrides,
  };
}

async function putViaMcp(app: App, args: Record<string, unknown>) {
  const result = await mcpToolCall(app, "agent_decision_put", args);
  expect(result.isError, result.content[0]?.text).toBeUndefined();
  return toolJson<ToolDecisionPut>(result);
}

async function mcpError(app: App, name: string, args: Record<string, unknown>) {
  const result = await mcpToolCall(app, name, args);
  expect(result.isError, result.content[0]?.text).toBe(true);
  return toolJson<{ error: string }>(result).error;
}

describe("MCP integration: ADR tools", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    apiKeyMock.verifyApiKey.mockResolvedValue(null);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("[REQ-AGENT-AUTOAPPLY-34] agent_decision_put creates an accepted, unreviewed ADR attributed to the calling model and supersedes in the same step", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id, 3);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const first = await putViaMcp(
      app,
      adrInput(project.id, {
        taskIds: [task.id],
        refs: { files: ["apps/api/src/board.ts"] },
        sessionId: "session-1",
      }),
    );
    expect(first).toMatchObject({
      number: 1,
      status: "accepted",
      reviewed: false,
      supersedes: null,
      taskIds: [task.id],
    });

    const row = await rowOf(first.id);
    expect(row).toMatchObject({
      status: "accepted",
      createdBy: null,
      acceptedBy: null,
      reviewedAt: null,
      reviewedBy: null,
      refs: { files: ["apps/api/src/board.ts"] },
    });
    expect(row?.acceptedAt).not.toBeNull();
    const [actor] = await db
      .select()
      .from(agentActorTable)
      .where(eq(agentActorTable.id, row?.createdActorId ?? ""));
    expect(actor).toMatchObject({
      workspaceId: member.workspace.id,
      onBehalfOf: member.user.id,
      ...agent,
    });
    expect(
      (await entriesFor(project.id)).filter(
        (entry) => adrOf(entry)?.decisionId === first.id,
      ),
    ).toEqual([
      expect.objectContaining({ actorId: actor?.id, createdBy: null }),
    ]);

    const second = await putViaMcp(
      app,
      adrInput(project.id, {
        title: "Move the board cache to Redis",
        supersedesDecisionId: first.id,
      }),
    );
    expect(second).toMatchObject({
      number: 2,
      status: "accepted",
      reviewed: false,
      supersedes: 1,
    });
    expect((await rowOf(first.id))?.status).toBe("superseded");
    expect((await entriesFor(project.id)).map(adrOf)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          decisionId: first.id,
          status: "superseded",
          supersededByDecisionId: second.id,
        }),
        expect.objectContaining({
          decisionId: second.id,
          status: "accepted",
          supersedesDecisionId: first.id,
        }),
      ]),
    );
  });

  it("[REQ-AGENT-AUTOAPPLY-34] agent_decision_put reports a missing supersede target as 404, a superseded or deleted one as 409, and refuses a viewer, writing nothing", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const count = async () =>
      (
        await db
          .select({ id: agentDecisionTable.id })
          .from(agentDecisionTable)
          .where(eq(agentDecisionTable.projectId, project.id))
      ).length;

    expect(
      await mcpError(
        app,
        "agent_decision_put",
        adrInput(project.id, { supersedesDecisionId: "adr-missing" }),
      ),
    ).toBe("404 The ADR to supersede was not found");

    const old = await putViaMcp(app, adrInput(project.id));
    await putViaMcp(
      app,
      adrInput(project.id, {
        title: "Replacement",
        supersedesDecisionId: old.id,
      }),
    );
    expect(
      await mcpError(
        app,
        "agent_decision_put",
        adrInput(project.id, {
          title: "Second replacement",
          supersedesDecisionId: old.id,
        }),
      ),
    ).toMatch(/^409 /);

    const doomed = await putViaMcp(
      app,
      adrInput(project.id, { title: "Deleted later" }),
    );
    expect((await lifecycle(app, project.id, doomed.id, "delete")).status).toBe(
      200,
    );
    expect(
      await mcpError(
        app,
        "agent_decision_put",
        adrInput(project.id, {
          title: "Replaces a deleted ADR",
          supersedesDecisionId: doomed.id,
        }),
      ),
    ).toMatch(/^409 /);
    expect(await count()).toBe(3);

    const viewer = await addMember(member.workspace.id, "viewer");
    mockAuthenticatedSession(viewer);
    const { app: viewerApp } = createApp();
    expect(
      await mcpError(
        viewerApp,
        "agent_decision_put",
        adrInput(project.id, { title: "Viewer ADR" }),
      ),
    ).toBe("403 Insufficient permissions");
    expect(await count()).toBe(3);
  });

  it("[REQ-AGENT-AUTOAPPLY-32] agent_decision_list returns accepted, non-deleted ADRs with number, title and review mark, filters by q and taskId, and pages with nextBefore", async () => {
    const member = await createWorkspaceMember({
      role: "admin",
      userName: "Dominic",
    });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id, 9);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    // 1 person (task-linked), 2 agent superseded by 3, 4 agent deleted, 5 agent (task-linked).
    const byPerson = await jsonDecision(
      await createDecision(app, project.id, {
        title: "Person ADR about queues",
        taskIds: [task.id],
      }),
    );
    const replaced = await putViaMcp(
      app,
      adrInput(project.id, { title: "Agent ADR one" }),
    );
    const replacement = await putViaMcp(
      app,
      adrInput(project.id, {
        title: "Agent ADR two",
        supersedesDecisionId: replaced.id,
      }),
    );
    const deleted = await putViaMcp(
      app,
      adrInput(project.id, { title: "Agent ADR deleted" }),
    );
    expect(
      (await lifecycle(app, project.id, deleted.id, "delete")).status,
    ).toBe(200);
    const latest = await putViaMcp(
      app,
      adrInput(project.id, {
        title: "Agent ADR about queues",
        taskIds: [task.id],
      }),
    );

    routeFetchInto(app);
    const list = async (args: Record<string, unknown> = {}) => {
      const result = await mcpToolCall(app, "agent_decision_list", {
        projectId: project.id,
        ...args,
      });
      expect(result.isError, result.content[0]?.text).toBeUndefined();
      return toolJson<ToolDecisionList>(result);
    };
    const numbers = (page: ToolDecisionList) =>
      page.decisions.map((d) => d.number);

    const current = await list();
    expect(current.decisions).toEqual([
      expect.objectContaining({
        id: latest.id,
        number: 5,
        title: "Agent ADR about queues",
        status: "accepted",
        reviewed: false,
        author: agent.model,
        tasks: [9],
      }),
      expect.objectContaining({
        id: replacement.id,
        number: 3,
        reviewed: false,
        author: agent.model,
      }),
      expect.objectContaining({
        id: byPerson.id,
        number: 1,
        reviewed: true,
        author: "Dominic",
        tasks: [9],
      }),
    ]);
    // Unreviewed counts the superseded agent ADR too, never the deleted one.
    expect(current).toMatchObject({ nextBefore: null, unreviewedTotal: 3 });

    const all = await list({ status: "all" });
    expect(all.decisions.map((d) => [d.number, d.status])).toEqual([
      [5, "accepted"],
      [3, "accepted"],
      [2, "superseded"],
      [1, "accepted"],
    ]);
    expect(numbers(await list({ q: "queues" }))).toEqual([5, 1]);
    expect(numbers(await list({ taskId: task.id }))).toEqual([5, 1]);
    expect(numbers(await list({ taskId: task.id, q: "Person" }))).toEqual([1]);

    const page1 = await list({ limit: 2 });
    expect(numbers(page1)).toEqual([5, 3]);
    expect(page1.nextBefore).toBe(replacement.id);
    const page2 = await list({ limit: 2, before: page1.nextBefore });
    expect(numbers(page2)).toEqual([1]);
    expect(page2.nextBefore).toBeNull();

    // Refused by the tool's input schema, so the SDK answers in plain text.
    for (const limit of [0, 51]) {
      const refused = await mcpToolCall(app, "agent_decision_list", {
        projectId: project.id,
        limit,
      });
      expect(refused.isError, String(limit)).toBe(true);
    }
  });

  it("[REQ-AGENT-AUTOAPPLY-33] agent_decision_get reads one ADR by id or number with its text, tasks, supersede numbers, author and review mark; a deleted ADR is not found", async () => {
    const member = await createWorkspaceMember({
      role: "admin",
      userName: "Dominic",
    });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id, 4);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const byPerson = await jsonDecision(
      await createDecision(app, project.id, {
        title: "Person ADR",
        taskIds: [task.id],
        refs: { files: ["a.ts"] },
      }),
    );
    const byAgent = await putViaMcp(
      app,
      adrInput(project.id, {
        title: "Agent replacement",
        supersedesDecisionId: byPerson.id,
        alternatives: "Keep the person ADR.",
        consequences: "Boards load faster.",
        reversible: false,
        taskIds: [task.id],
      }),
    );
    const deleted = await putViaMcp(
      app,
      adrInput(project.id, { title: "Deleted ADR" }),
    );
    expect(
      (await lifecycle(app, project.id, deleted.id, "delete")).status,
    ).toBe(200);

    routeFetchInto(app);
    const get = (args: Record<string, unknown>) =>
      mcpToolCall(app, "agent_decision_get", {
        projectId: project.id,
        ...args,
      });

    expect(toolJson(await get({ decisionId: byAgent.id }))).toEqual({
      id: byAgent.id,
      number: 2,
      title: "Agent replacement",
      status: "accepted",
      reviewed: false,
      author: agent.model,
      context: "Boards are read far more often than written.",
      decision: "Keep a per-project board cache invalidated by events.",
      alternatives: "Keep the person ADR.",
      consequences: "Boards load faster.",
      reversible: false,
      refs: null,
      taskIds: [task.id],
      supersedes: 1,
      supersededBy: null,
      createdAt: expect.any(String),
    });

    expect(toolJson(await get({ number: 1 }))).toMatchObject({
      id: byPerson.id,
      status: "superseded",
      reviewed: true,
      author: "Dominic",
      context: "Edits would erase the reason a choice was made.",
      alternatives: "Overwrite the previous entry.",
      refs: { files: ["a.ts"] },
      taskIds: [task.id],
      supersedes: null,
      supersededBy: 2,
    });

    for (const args of [
      { decisionId: deleted.id },
      { number: 3 },
      { number: 99 },
    ]) {
      expect(
        await mcpError(app, "agent_decision_get", {
          projectId: project.id,
          ...args,
        }),
      ).toMatch(/^404 /);
    }
  });
});

describe("API integration: ADR", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    apiKeyMock.verifyApiKey.mockResolvedValue(null);
  });

  it("[REQ-AGENT-AUTOAPPLY-3] 프로젝트 번호를 원자적으로 배정해 draft 없이 accepted 로 만들고 같은 프로젝트의 작업만 연결한다", async () => {
    const member = await createWorkspaceMember({ userName: "ADR Author" });
    const firstProject = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const secondProject = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const linkedTask = await seedTask(
      firstProject.project.id,
      firstProject.columns.todo.id,
      7,
    );
    const foreignTask = await seedTask(
      secondProject.project.id,
      secondProject.columns.todo.id,
      1,
    );
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        createDecision(app, firstProject.project.id, {
          title: `Concurrent ADR ${index + 1}`,
          taskIds: index === 0 ? [linkedTask.id] : [],
          ...(index === 1 ? { provider: "openai", model: "gpt-6" } : {}),
        }),
      ),
    );
    const decisions = await Promise.all(responses.map(jsonDecision));

    expect(decisions.map((decision) => decision.number).sort()).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(decisions.every((decision) => decision.status === "accepted")).toBe(
      true,
    );
    expect(decisions.every((decision) => decision.acceptedAt !== null)).toBe(
      true,
    );
    expect(decisions[0]?.tasks).toEqual([
      { id: linkedTask.id, number: 7, title: linkedTask.title },
    ]);
    expect(decisions[0]?.createdAuthor).toEqual({
      userId: member.user.id,
      name: "ADR Author",
    });
    expect(decisions[1]?.createdBy).toBeNull();
    expect(decisions[1]?.createdActor).toMatchObject({
      provider: "openai",
      model: "gpt-6",
    });

    const invalid = await createDecision(app, firstProject.project.id, {
      taskIds: [foreignTask.id],
    });
    expect(invalid.status).toBe(400);

    const persisted = await db
      .select({
        number: agentDecisionTable.number,
        status: agentDecisionTable.status,
      })
      .from(agentDecisionTable)
      .where(eq(agentDecisionTable.projectId, firstProject.project.id))
      .orderBy(asc(agentDecisionTable.number));
    expect(persisted.map((row) => row.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(persisted.map((row) => row.status))).toEqual(
      new Set(["accepted"]),
    );
  });

  it("첫 에이전트 작성이 동시에 와도 actor를 재사용하고 provider가 다르면 구분한다", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const concurrent = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        createDecision(app, project.id, {
          title: `Agent ADR ${index}`,
          provider: "anthropic",
          model: "shared-model-name",
        }),
      ),
    );
    const decisions = await Promise.all(concurrent.map(jsonDecision));
    expect(
      new Set(decisions.map((decision) => decision.createdActor?.id)).size,
    ).toBe(1);

    const otherProvider = await jsonDecision(
      await createDecision(app, project.id, {
        title: "Same model name from another provider",
        provider: "openai",
        model: "shared-model-name",
      }),
    );
    expect(otherProvider.createdActor?.id).not.toBe(
      decisions[0]?.createdActor?.id,
    );

    const actors = await db
      .select()
      .from(agentActorTable)
      .where(eq(agentActorTable.workspaceId, member.workspace.id));
    expect(actors).toHaveLength(2);
    expect(actors.map((actor) => actor.provider).sort()).toEqual([
      "anthropic",
      "openai",
    ]);
  });

  it("[REQ-AGENT-AUTOAPPLY-6] [REQ-AGENT-AUTOAPPLY-7] 사람이 만든 ADR 은 만든 사람이 확인한 상태이고 에이전트가 만든 ADR 은 미확인이다", async () => {
    const member = await createWorkspaceMember({ userName: "ADR Author" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const human = await jsonDecision(
      await createDecision(app, project.id, { title: "Human ADR" }),
    );
    expect(human).toMatchObject({
      status: "accepted",
      acceptedBy: member.user.id,
      acceptor: { userId: member.user.id, name: "ADR Author" },
      reviewed: true,
      reviewedBy: member.user.id,
    });
    expect(human.reviewedAt).toEqual(expect.any(String));

    const byAgent = await jsonDecision(
      await createDecision(app, project.id, { title: "Agent ADR", ...agent }),
    );
    expect(byAgent).toMatchObject({
      status: "accepted",
      acceptedBy: null,
      acceptor: null,
      reviewed: false,
      reviewedAt: null,
      reviewedBy: null,
    });
    expect(byAgent.acceptedAt).toEqual(expect.any(String));

    const replacement = await jsonDecision(
      await createDecision(app, project.id, {
        title: "Agent replacement",
        supersedesDecisionId: human.id,
        ...agent,
      }),
    );
    expect(replacement.reviewed).toBe(false);

    const all = await listDecisions(app, project.id, "status=all");
    expect(all.decisions.map((d) => [d.title, d.reviewed])).toEqual([
      ["Agent replacement", false],
      ["Agent ADR", false],
      ["Human ADR", true],
    ]);
    expect(all.unreviewedTotal).toBe(2);
    // The count is project-wide: a filter that hides them does not shrink it.
    expect(
      (await listDecisions(app, project.id, "status=superseded"))
        .unreviewedTotal,
    ).toBe(2);
  });

  it("[REQ-AGENT-AUTOAPPLY-9] ADR 확인은 사람만 한다: 세션 요청은 확인 표시만 남기고 API 키 요청은 403", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const first = await jsonDecision(
      await createDecision(app, project.id, { title: "First", ...agent }),
    );
    const second = await jsonDecision(
      await createDecision(app, project.id, { title: "Second", ...agent }),
    );
    const entriesBefore = (await entriesFor(project.id)).length;

    await seedApiKey(member.user.id);
    const refused = await lifecycle(
      app,
      project.id,
      second.id,
      "review",
      viaKey,
    );
    expect(refused.status).toBe(403);
    expect((await rowOf(second.id))?.reviewedAt).toBeNull();

    const reviewed = await jsonDecision(
      await lifecycle(app, project.id, first.id, "review"),
    );
    expect(reviewed).toMatchObject({
      reviewed: true,
      reviewedBy: member.user.id,
      updatedAt: first.updatedAt,
    });
    expect((await listDecisions(app, project.id)).unreviewedTotal).toBe(1);
    expect((await entriesFor(project.id)).length).toBe(entriesBefore);
    expect((await lifecycle(app, project.id, "missing", "review")).status).toBe(
      404,
    );
  });

  it("[REQ-AGENT-AUTOAPPLY-23] accepted ADR 내용 수정 요청은 409 로 거부하고 대체 ADR 을 안내한다", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const created = await jsonDecision(await createDecision(app, project.id));

    const refused = await app.request(
      `/api/agent-decision/${project.id}/${created.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expectedUpdatedAt: created.updatedAt,
          decision: "Rewrite accepted content",
        }),
      },
    );
    expect(refused.status).toBe(409);
    await expect(refused.text()).resolves.toBe(
      "accepted ADR is immutable; create a superseding ADR",
    );
    expect(await rowOf(created.id)).toMatchObject({
      decision: created.decision,
      updatedAt: new Date(created.updatedAt),
    });

    // The accept step no longer exists.
    const accept = await app.request(
      `/api/agent-decision/${project.id}/${created.id}/accept`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: created.updatedAt }),
      },
    );
    expect(accept.status).toBe(404);
  });

  it("기존 결정 항목을 원문 의미를 바꾸지 않고 한 번만 accepted ADR 로 승격한다", async () => {
    const member = await createWorkspaceMember({
      userName: "Promoter",
      role: "admin",
    });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id, 3);
    const [entry] = await db
      .insert(agentEntryTable)
      .values({
        workspaceId: member.workspace.id,
        projectId: project.id,
        taskId: task.id,
        createdBy: member.user.id,
        kind: "decision",
        summary: "Use a durable queue",
        body: "Investigation notes with uncertain historical details.",
        decision: {
          what: "Persist jobs before acknowledging them.",
          why: "Restarts must not lose work.",
          rejected: "Keep jobs only in process memory.",
          reversible: false,
        },
        refs: { files: ["apps/api/src/jobs.ts"] },
      })
      .returning();
    if (!entry) throw new Error("Failed to seed source entry");
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const promote = () =>
      app.request(`/api/agent-decision/${project.id}/from-entry/${entry.id}`, {
        method: "POST",
      });

    const first = await jsonDecision(await promote());
    const second = await jsonDecision(await promote());

    expect(second.id).toBe(first.id);
    expect(first).toMatchObject({
      title: "Use a durable queue",
      context: "Restarts must not lose work.",
      decision: "Persist jobs before acknowledging them.",
      alternatives: "Keep jobs only in process memory.",
      consequences: null,
      sourceNote: "Investigation notes with uncertain historical details.",
      sourceEntryId: entry.id,
      tasks: [{ id: task.id }],
      status: "accepted",
      acceptedBy: member.user.id,
      reviewed: true,
      reviewedBy: member.user.id,
    });

    const [preserved] = await db
      .select()
      .from(agentEntryTable)
      .where(eq(agentEntryTable.id, entry.id));
    expect(preserved).toMatchObject({
      body: "Investigation notes with uncertain historical details.",
      decision: entry.decision,
      deletedAt: null,
    });

    // A deleted promotion still owns the entry: promoting again points at restore.
    expect((await lifecycle(app, project.id, first.id, "delete")).status).toBe(
      200,
    );
    const again = await promote();
    expect(again.status).toBe(409);
  });

  it("[REQ-AGENT-AUTOAPPLY-19] supersedesDecisionId 로 만들면 같은 트랜잭션에서 이전 ADR 을 superseded 로 바꾸고 추적 가능한 타임라인을 남긴다", async () => {
    const member = await createWorkspaceMember({
      userName: "Reviewer",
      role: "admin",
    });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const previous = await jsonDecision(
      await createDecision(app, project.id, { title: "ADR one" }),
    );

    const replacementResponses = await Promise.all(
      ["ADR two", "ADR three"].map((title) =>
        createDecision(app, project.id, {
          title,
          supersedesDecisionId: previous.id,
        }),
      ),
    );
    expect(
      replacementResponses.map((response) => response.status).sort(),
    ).toEqual([200, 409]);

    const rows = await db
      .select()
      .from(agentDecisionTable)
      .where(eq(agentDecisionTable.projectId, project.id));
    // The losing create rolled back entirely, number included.
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === previous.id)?.status).toBe(
      "superseded",
    );
    const acceptedReplacement = rows.find(
      (row) => row.supersedesDecisionId === previous.id,
    );
    expect(acceptedReplacement).toMatchObject({
      status: "accepted",
      number: 2,
    });

    const timeline = await db
      .select({ decision: agentEntryTable.decision })
      .from(agentEntryTable)
      .where(
        and(
          eq(agentEntryTable.projectId, project.id),
          eq(agentEntryTable.kind, "decision"),
        ),
      );
    expect(timeline).toHaveLength(3);
    expect(timeline.map(adrOf)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          decisionId: previous.id,
          status: "accepted",
        }),
        expect.objectContaining({
          decisionId: previous.id,
          status: "superseded",
          supersededByDecisionId: acceptedReplacement?.id,
        }),
        expect.objectContaining({
          decisionId: acceptedReplacement?.id,
          status: "accepted",
          supersedesDecisionId: previous.id,
        }),
      ]),
    );

    const entryList = await app.request(`/api/agent-entry/${project.id}`);
    expect(entryList.status).toBe(200);
    const entryPayload = (await entryList.json()) as {
      entries: Array<Record<string, unknown>>;
    };
    const acceptedEntry = entryPayload.entries.find(
      (entry) => entry.adrDecisionId === acceptedReplacement?.id,
    );
    expect(acceptedEntry).toMatchObject({ adrStatus: "accepted" });
    const entryDetail = await app.request(
      `/api/agent-entry/${project.id}/${String(acceptedEntry?.id)}`,
    );
    expect(entryDetail.status).toBe(200);
    await expect(entryDetail.json()).resolves.toMatchObject({
      id: acceptedEntry?.id,
      adrDecisionId: acceptedReplacement?.id,
      adrNumber: acceptedReplacement?.number,
      adrStatus: "accepted",
    });

    const previousDetail = await jsonDecision(
      await app.request(`/api/agent-decision/${project.id}/${previous.id}`),
    );
    expect(previousDetail.supersededBy).toMatchObject({
      id: acceptedReplacement?.id,
      status: "accepted",
    });

    // Only an accepted, non-deleted ADR of this project can be superseded.
    expect(
      (
        await createDecision(app, project.id, {
          supersedesDecisionId: previous.id,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await createDecision(app, project.id, {
          supersedesDecisionId: "missing",
        })
      ).status,
    ).toBe(404);
    const lone = await jsonDecision(
      await createDecision(app, project.id, { title: "Lone" }),
    );
    expect((await lifecycle(app, project.id, lone.id, "delete")).status).toBe(
      200,
    );
    expect(
      (await createDecision(app, project.id, { supersedesDecisionId: lone.id }))
        .status,
    ).toBe(409);
  });

  it("[REQ-AGENT-AUTOAPPLY-33] 목록의 number 필터는 그 번호의 ADR 하나만 돌려주고 status·삭제 필터를 그대로 따른다", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const first = await jsonDecision(
      await createDecision(app, project.id, { title: "First" }),
    );
    const second = await jsonDecision(
      await createDecision(app, project.id, {
        title: "Second",
        supersedesDecisionId: first.id,
      }),
    );
    const third = await jsonDecision(
      await createDecision(app, project.id, { title: "Third" }),
    );
    expect((await lifecycle(app, project.id, third.id, "delete")).status).toBe(
      200,
    );
    const ids = async (query: string) =>
      (await listDecisions(app, project.id, query)).decisions.map((d) => d.id);

    expect(await ids("number=2")).toEqual([second.id]);
    // Superseded: left out by the default status, found with status=all.
    expect(await ids("number=1")).toEqual([]);
    expect(await ids("number=1&status=all")).toEqual([first.id]);
    // Deleted: left out unless status=deleted.
    expect(await ids("number=3&status=all")).toEqual([]);
    expect(await ids("number=3&status=deleted")).toEqual([third.id]);
    expect(await ids("number=99&status=all")).toEqual([]);

    for (const bad of ["number=0", "number=-1", "number=1.5", "number=abc"]) {
      const response = await app.request(
        `/api/agent-decision/${project.id}?${bad}`,
      );
      expect(response.status, bad).toBe(400);
    }
  });

  it("[REQ-AGENT-AUTOAPPLY-37] 목록의 acceptedTotal 은 필터·페이지와 무관하게 삭제되지 않은 accepted ADR 수를 센다", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const one = await jsonDecision(
      await createDecision(app, project.id, { title: "One" }),
    );
    const two = await jsonDecision(
      await createDecision(app, project.id, { title: "Two" }),
    );
    const three = await jsonDecision(
      await createDecision(app, project.id, { title: "Three", ...agent }),
    );
    await jsonDecision(
      await createDecision(app, project.id, {
        title: "Four",
        ...agent,
        supersedesDecisionId: two.id,
      }),
    );
    const five = await jsonDecision(
      await createDecision(app, project.id, { title: "Five" }),
    );
    expect((await lifecycle(app, project.id, five.id, "delete")).status).toBe(
      200,
    );

    // Accepted and not deleted: One, Three, Four. Unreviewed: Three, Four.
    for (const query of [
      "",
      "limit=1",
      "status=all",
      "status=superseded",
      "status=deleted",
      "number=1",
      "q=nothing-matches-this",
      `before=${one.id}`,
    ]) {
      expect(
        await listDecisions(app, project.id, query),
        query || "(no query)",
      ).toMatchObject({ acceptedTotal: 3, unreviewedTotal: 2 });
    }

    expect((await lifecycle(app, project.id, three.id, "delete")).status).toBe(
      200,
    );
    expect(await listDecisions(app, project.id)).toMatchObject({
      acceptedTotal: 2,
      unreviewedTotal: 1,
    });
  });

  it("목록은 상태·검색·작업·커서로 제한하고 일반 구성원은 ADR 을 삭제·복구하지 못한다", async () => {
    const member = await createWorkspaceMember({ userName: "Member" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id, 11);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const first = await jsonDecision(
      await createDecision(app, project.id, {
        title: "Postgres queue",
        context: "Need durable delivery",
        taskIds: [task.id],
      }),
    );
    await jsonDecision(
      await createDecision(app, project.id, { title: "Object storage" }),
    );

    expect((await lifecycle(app, project.id, first.id, "delete")).status).toBe(
      403,
    );
    expect((await lifecycle(app, project.id, first.id, "restore")).status).toBe(
      403,
    );
    expect((await rowOf(first.id))?.deletedAt).toBeNull();

    const searchedPayload = await listDecisions(
      app,
      project.id,
      `q=durable&taskId=${task.id}&status=accepted`,
    );
    expect(searchedPayload.decisions).toHaveLength(1);
    expect(searchedPayload.decisions[0]).toMatchObject({
      id: first.id,
      contextPreview: "Need durable delivery",
    });
    expect(searchedPayload.decisions[0]).not.toHaveProperty("context");
    expect(searchedPayload.decisions[0]).not.toHaveProperty("decision");

    const firstPagePayload = await listDecisions(
      app,
      project.id,
      "status=all&limit=1",
    );
    expect(firstPagePayload.decisions).toHaveLength(1);
    expect(firstPagePayload.nextBefore).toBe(firstPagePayload.decisions[0]?.id);
    const secondPagePayload = await listDecisions(
      app,
      project.id,
      `status=all&limit=1&before=${firstPagePayload.nextBefore}`,
    );
    expect(secondPagePayload.decisions).toHaveLength(1);
    expect(secondPagePayload.decisions[0]?.id).not.toBe(
      firstPagePayload.decisions[0]?.id,
    );
  });

  it("다른 워크스페이스 사용자는 모든 ADR 경로에서 내용을 읽거나 바꾸지 못한다", async () => {
    const owner = await createWorkspaceMember({ role: "admin" });
    const outsider = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: owner.workspace.id,
    });
    const [decision] = await db
      .insert(agentDecisionTable)
      .values({
        workspaceId: owner.workspace.id,
        projectId: project.id,
        number: 1,
        title: "Private architecture",
        context: "Private context",
        decision: "Private decision",
        status: "accepted",
        createdBy: owner.user.id,
        updatedBy: owner.user.id,
      })
      .returning();
    const [entry] = await db
      .insert(agentEntryTable)
      .values({
        workspaceId: owner.workspace.id,
        projectId: project.id,
        createdBy: owner.user.id,
        kind: "decision",
        summary: "Private legacy decision",
        decision: { what: "Private", why: "Private reason" },
      })
      .returning();
    if (!decision || !entry) throw new Error("Failed to seed private ADR");
    mockAuthenticatedSession(outsider.user);
    const { app } = createApp();

    const requests = await Promise.all([
      app.request(`/api/agent-decision/${project.id}`),
      app.request(`/api/agent-decision/${project.id}/${decision.id}`),
      createDecision(app, project.id, { title: "Unauthorized ADR" }),
      app.request(`/api/agent-decision/${project.id}/${decision.id}`, {
        method: "PATCH",
      }),
      app.request(`/api/agent-decision/${project.id}/from-entry/${entry.id}`, {
        method: "POST",
      }),
      lifecycle(app, project.id, decision.id, "review"),
      lifecycle(app, project.id, decision.id, "delete"),
      lifecycle(app, project.id, decision.id, "restore"),
    ]);

    expect(requests.map((response) => response.status)).toEqual([
      403, 403, 403, 403, 403, 403, 403, 403,
    ]);
    const responseBodies = await Promise.all(
      requests.map((response) => response.text()),
    );
    expect(responseBodies.join("\n")).not.toContain("Private architecture");
    expect(responseBodies.join("\n")).not.toContain("Private context");
    expect(responseBodies.join("\n")).not.toContain("Private decision");

    expect(await rowOf(decision.id)).toMatchObject({
      title: "Private architecture",
      status: "accepted",
      reviewedAt: null,
      deletedAt: null,
      updatedAt: decision.updatedAt,
    });
    expect(
      await db
        .select()
        .from(agentDecisionTable)
        .where(eq(agentDecisionTable.projectId, project.id)),
    ).toHaveLength(1);
  });

  it("연결된 작업을 옮기면 같은 트랜잭션에서 ADR 연결을 끊고 읽기에서도 숨긴다", async () => {
    const member = await createWorkspaceMember();
    const source = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const destination = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(source.project.id, source.columns.todo.id, 20);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const decision = await jsonDecision(
      await createDecision(app, source.project.id, { taskIds: [task.id] }),
    );

    await moveTask({
      taskId: task.id,
      destinationProjectId: destination.project.id,
      currentUserId: member.user.id,
    });

    expect(
      await db
        .select()
        .from(agentDecisionTaskTable)
        .where(eq(agentDecisionTaskTable.taskId, task.id)),
    ).toEqual([]);

    // Even a stale link inserted outside the API cannot leak a task from the
    // destination project into this project's ADR reads.
    await db.insert(agentDecisionTaskTable).values({
      decisionId: decision.id,
      taskId: task.id,
    });
    const detail = await jsonDecision(
      await app.request(
        `/api/agent-decision/${source.project.id}/${decision.id}`,
      ),
    );
    expect(detail.tasks).toEqual([]);
    const filtered = await app.request(
      `/api/agent-decision/${source.project.id}?taskId=${task.id}`,
    );
    expect(filtered.status).toBe(200);
    await expect(filtered.json()).resolves.toMatchObject({ decisions: [] });

    const racingTask = await seedTask(
      source.project.id,
      source.columns.todo.id,
      21,
    );
    const [createResult, moveResult] = await Promise.all([
      createDecision(app, source.project.id, {
        title: "Concurrent link",
        taskIds: [racingTask.id],
      }),
      moveTask({
        taskId: racingTask.id,
        destinationProjectId: destination.project.id,
        currentUserId: member.user.id,
      }),
    ]);
    expect([200, 400]).toContain(createResult.status);
    expect(moveResult.task.projectId).toBe(destination.project.id);
    expect(
      await db
        .select()
        .from(agentDecisionTaskTable)
        .where(eq(agentDecisionTaskTable.taskId, racingTask.id)),
    ).toEqual([]);
  });

  it("대체 연결이 있어도 프로젝트와 워크스페이스 삭제가 연쇄되고 무관한 행은 남는다", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const deletedProject = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const workspaceProject = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const unrelated = await createWorkspaceMember();
    const unrelatedProject = await createProjectFixture({
      workspaceId: unrelated.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    async function seedAcceptedChain(projectId: string) {
      const previous = await jsonDecision(
        await createDecision(app, projectId, { title: "Previous ADR" }),
      );
      return jsonDecision(
        await createDecision(app, projectId, {
          title: "Replacement ADR",
          supersedesDecisionId: previous.id,
        }),
      );
    }

    await seedAcceptedChain(deletedProject.project.id);
    await seedAcceptedChain(workspaceProject.project.id);
    const [unrelatedPrevious] = await db
      .insert(agentDecisionTable)
      .values({
        workspaceId: unrelated.workspace.id,
        projectId: unrelatedProject.project.id,
        number: 1,
        title: "Unrelated previous",
        context: "Unrelated context",
        decision: "Unrelated decision",
        status: "superseded",
      })
      .returning();
    if (!unrelatedPrevious) throw new Error("Failed to seed unrelated ADR");
    await db.insert(agentDecisionTable).values({
      workspaceId: unrelated.workspace.id,
      projectId: unrelatedProject.project.id,
      number: 2,
      title: "Unrelated replacement",
      context: "Unrelated context",
      decision: "Unrelated decision",
      status: "accepted",
      supersedesDecisionId: unrelatedPrevious.id,
    });

    await expect(
      db
        .delete(schema.projectTable)
        .where(eq(schema.projectTable.id, deletedProject.project.id)),
    ).resolves.toBeDefined();
    expect(
      await db
        .select()
        .from(agentDecisionTable)
        .where(eq(agentDecisionTable.projectId, deletedProject.project.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(agentDecisionTable)
        .where(eq(agentDecisionTable.projectId, workspaceProject.project.id)),
    ).toHaveLength(2);

    await expect(
      db
        .delete(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, member.workspace.id)),
    ).resolves.toBeDefined();
    expect(
      await db
        .select()
        .from(agentDecisionTable)
        .where(eq(agentDecisionTable.workspaceId, member.workspace.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(agentDecisionTable)
        .where(eq(agentDecisionTable.workspaceId, unrelated.workspace.id)),
    ).toHaveLength(2);
  });

  describe("agent-autoapply: delete and restore", () => {
    async function adminSetup() {
      const admin = await createWorkspaceMember({
        userName: "Maintainer",
        role: "admin",
      });
      const { project } = await createProjectFixture({
        workspaceId: admin.workspace.id,
      });
      mockAuthenticatedSession(admin.user);
      const { app } = createApp();
      return { admin, project, app };
    }

    it("[REQ-AGENT-AUTOAPPLY-12] [REQ-AGENT-AUTOAPPLY-14] [REQ-AGENT-AUTOAPPLY-15] project:update 권한자가 삭제하면 행은 남고 읽기에서 빠지며, 복구하면 삭제 전 상태로 돌아온다", async () => {
      const { admin, project, app } = await adminSetup();
      const target = await jsonDecision(
        await createDecision(app, project.id, { title: "Wrong ADR", ...agent }),
      );
      const kept = await jsonDecision(
        await createDecision(app, project.id, { title: "Kept ADR" }),
      );

      const member = await addMember(admin.workspace.id, "member");
      mockAuthenticatedSession(member);
      expect(
        (await lifecycle(createApp().app, project.id, target.id, "delete"))
          .status,
      ).toBe(403);
      mockAuthenticatedSession(admin.user);

      const deleted = await lifecycle(app, project.id, target.id, "delete");
      expect(deleted.status, await deleted.clone().text()).toBe(200);
      expect(await deleted.json()).toMatchObject({
        id: target.id,
        deletedAt: expect.any(String),
        deletedBy: admin.user.id,
        restoredDecisionId: null,
      });
      const row = await rowOf(target.id);
      expect(row).toMatchObject({
        title: "Wrong ADR",
        status: "accepted",
        deletedBy: admin.user.id,
      });
      expect(row?.deletedAt).not.toBeNull();

      expect(
        (await app.request(`/api/agent-decision/${project.id}/${target.id}`))
          .status,
      ).toBe(404);
      const current = await listDecisions(app, project.id);
      expect(current.decisions.map((d) => d.id)).toEqual([kept.id]);
      expect(current.unreviewedTotal).toBe(0);
      expect(
        (await listDecisions(app, project.id, "status=all")).decisions.map(
          (d) => d.id,
        ),
      ).toEqual([kept.id]);
      expect(
        (await listDecisions(app, project.id, "status=deleted")).decisions,
      ).toEqual([
        expect.objectContaining({
          id: target.id,
          deletedAt: expect.any(String),
          deletedBy: admin.user.id,
        }),
      ]);
      expect(
        (await lifecycle(app, project.id, target.id, "review")).status,
      ).toBe(404);
      expect(
        (await lifecycle(app, project.id, target.id, "delete")).status,
      ).toBe(404);

      const restored = await jsonDecision(
        await lifecycle(app, project.id, target.id, "restore"),
      );
      expect(restored).toMatchObject({
        id: target.id,
        title: "Wrong ADR",
        status: "accepted",
        reviewed: false,
        deletedAt: null,
        deletedBy: null,
        updatedAt: target.updatedAt,
      });
      expect((await listDecisions(app, project.id)).unreviewedTotal).toBe(1);
      expect(
        (await lifecycle(app, project.id, target.id, "restore")).status,
      ).toBe(404);

      const removal = (await entriesFor(project.id)).filter(
        (entry) => entry.kind === "work",
      );
      expect(removal.map((entry) => entry.summary).sort()).toEqual([
        "ADR-001 복구 · Wrong ADR",
        "ADR-001 삭제 · Wrong ADR",
      ]);
      expect(
        removal.every(
          (entry) =>
            entry.createdBy === admin.user.id && entry.actorId === null,
        ),
      ).toBe(true);
    });

    it("[REQ-AGENT-AUTOAPPLY-20] 다른 ADR 을 대체한 accepted ADR 을 삭제하면 대체됐던 ADR 이 accepted 로 돌아온다", async () => {
      const { admin, project, app } = await adminSetup();
      const previous = await jsonDecision(
        await createDecision(app, project.id, { title: "Original", ...agent }),
      );
      const replacement = await jsonDecision(
        await createDecision(app, project.id, {
          title: "Wrong replacement",
          supersedesDecisionId: previous.id,
          ...agent,
        }),
      );
      expect((await rowOf(previous.id))?.status).toBe("superseded");
      expect((await rowOf(replacement.id))?.status).toBe("accepted");

      const deleted = await lifecycle(
        app,
        project.id,
        replacement.id,
        "delete",
      );
      expect(deleted.status).toBe(200);
      expect(await deleted.json()).toMatchObject({
        restoredDecisionId: previous.id,
      });
      const back = await jsonDecision(
        await app.request(`/api/agent-decision/${project.id}/${previous.id}`),
      );
      expect(back).toMatchObject({ status: "accepted", supersededBy: null });

      // The person's restore is on the timeline as an ADR status change.
      const restoredTrace = (await entriesFor(project.id)).filter(
        (entry) =>
          entry.createdBy === admin.user.id &&
          adrOf(entry)?.decisionId === previous.id,
      );
      expect(restoredTrace.map(adrOf)).toEqual([
        expect.objectContaining({ status: "accepted" }),
      ]);

      // The deleted replacement no longer holds the slot.
      expect(
        (
          await createDecision(app, project.id, {
            title: "Second try",
            supersedesDecisionId: previous.id,
          })
        ).status,
      ).toBe(200);
    });

    it("[REQ-AGENT-AUTOAPPLY-21] 대체됐던 ADR 이 이미 삭제된 상태면 복원 없이 삭제만 한다", async () => {
      const { project, app } = await adminSetup();
      const previous = await jsonDecision(
        await createDecision(app, project.id, { title: "Original" }),
      );
      const replacement = await jsonDecision(
        await createDecision(app, project.id, {
          title: "Replacement",
          supersedesDecisionId: previous.id,
        }),
      );

      const deletedPrevious = await lifecycle(
        app,
        project.id,
        previous.id,
        "delete",
      );
      expect(await deletedPrevious.json()).toMatchObject({
        restoredDecisionId: null,
      });
      const deletedReplacement = await lifecycle(
        app,
        project.id,
        replacement.id,
        "delete",
      );
      expect(deletedReplacement.status).toBe(200);
      expect(await deletedReplacement.json()).toMatchObject({
        restoredDecisionId: null,
      });

      const previousRow = await rowOf(previous.id);
      expect(previousRow?.status).toBe("superseded");
      expect(previousRow?.deletedAt).not.toBeNull();
      expect((await rowOf(replacement.id))?.deletedAt).not.toBeNull();
    });

    it("[REQ-AGENT-AUTOAPPLY-22] 삭제 전 accepted 였고 다른 ADR 을 대체했던 ADR 을 복구하면 대체됐던 ADR 이 accepted 이고 삭제되지 않았을 때만 다시 대체하고, 아니면 409", async () => {
      const { admin, project, app } = await adminSetup();
      const previous = await jsonDecision(
        await createDecision(app, project.id, { title: "Original", ...agent }),
      );
      const replacement = await jsonDecision(
        await createDecision(app, project.id, {
          title: "Replacement",
          supersedesDecisionId: previous.id,
          ...agent,
        }),
      );

      expect((await rowOf(replacement.id))?.status).toBe("accepted");
      await lifecycle(app, project.id, replacement.id, "delete");
      expect((await rowOf(previous.id))?.status).toBe("accepted");
      const restored = await jsonDecision(
        await lifecycle(app, project.id, replacement.id, "restore"),
      );
      expect(restored).toMatchObject({
        status: "accepted",
        deletedAt: null,
        supersedes: { id: previous.id, status: "superseded" },
      });
      expect((await rowOf(previous.id))?.status).toBe("superseded");
      const resuperseded = (await entriesFor(project.id)).filter(
        (entry) =>
          entry.createdBy === admin.user.id &&
          adrOf(entry)?.decisionId === previous.id,
      );
      expect(resuperseded.map(adrOf)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: "superseded",
            supersededByDecisionId: replacement.id,
          }),
        ]),
      );

      // Someone replaced it meanwhile: restoring would make two replacements.
      await lifecycle(app, project.id, replacement.id, "delete");
      const other = await jsonDecision(
        await createDecision(app, project.id, {
          title: "Other replacement",
          supersedesDecisionId: previous.id,
        }),
      );
      const conflict = await lifecycle(
        app,
        project.id,
        replacement.id,
        "restore",
      );
      expect(conflict.status).toBe(409);
      await expect(conflict.text()).resolves.toBe(
        "ADR-003 is now the accepted ADR of this supersede chain; restoring this one would make a second accepted ADR",
      );
      expect((await rowOf(replacement.id))?.deletedAt).not.toBeNull();
      expect(
        (
          await jsonDecision(
            await app.request(
              `/api/agent-decision/${project.id}/${previous.id}`,
            ),
          )
        ).supersededBy,
      ).toMatchObject({ id: other.id });

      // Once nothing else in the chain is live, the replacement comes back as
      // the chain's only accepted ADR; the deleted predecessor is not touched.
      await lifecycle(app, project.id, other.id, "delete");
      expect((await rowOf(previous.id))?.status).toBe("accepted");
      await lifecycle(app, project.id, previous.id, "delete");
      const previousDeleted = await rowOf(previous.id);
      const alone = await jsonDecision(
        await lifecycle(app, project.id, replacement.id, "restore"),
      );
      expect(alone).toMatchObject({
        status: "accepted",
        deletedAt: null,
        supersedes: null,
      });
      expect(await rowOf(previous.id)).toMatchObject({
        status: "accepted",
        deletedAt: previousDeleted?.deletedAt,
        updatedAt: previousDeleted?.updatedAt,
      });
    });

    /** P ← D ← E: D superseded P and was itself superseded by E. */
    async function seedChain(app: App, projectId: string) {
      const previous = await jsonDecision(
        await createDecision(app, projectId, { title: "P original" }),
      );
      const middle = await jsonDecision(
        await createDecision(app, projectId, {
          title: "D middle",
          supersedesDecisionId: previous.id,
        }),
      );
      const latest = await jsonDecision(
        await createDecision(app, projectId, {
          title: "E latest",
          supersedesDecisionId: middle.id,
        }),
      );
      return { previous, middle, latest };
    }

    function addedSince(
      before: Array<{ id: string }>,
      after: Awaited<ReturnType<typeof entriesFor>>,
    ) {
      return after
        .filter((entry) => !before.some((prior) => prior.id === entry.id))
        .map((entry) => [entry.kind, entry.summary]);
    }

    it("[REQ-AGENT-AUTOAPPLY-44] 이미 superseded 인 ADR 을 삭제하면 대체됐던 ADR 도 대체한 ADR 도 상태가 바뀌지 않는다", async () => {
      const { admin, project, app } = await adminSetup();
      const { previous, middle, latest } = await seedChain(app, project.id);
      const previousBefore = await rowOf(previous.id);
      const latestBefore = await rowOf(latest.id);
      expect(previousBefore?.status).toBe("superseded");
      expect((await rowOf(middle.id))?.status).toBe("superseded");
      expect(latestBefore?.status).toBe("accepted");
      const entriesBefore = await entriesFor(project.id);

      const deleted = await lifecycle(app, project.id, middle.id, "delete");
      expect(deleted.status, await deleted.clone().text()).toBe(200);
      expect(await deleted.json()).toMatchObject({
        id: middle.id,
        deletedBy: admin.user.id,
        restoredDecisionId: null,
      });

      expect(await rowOf(previous.id)).toMatchObject({
        status: "superseded",
        deletedAt: null,
        updatedAt: previousBefore?.updatedAt,
      });
      expect(await rowOf(latest.id)).toMatchObject({
        status: "accepted",
        deletedAt: null,
        updatedAt: latestBefore?.updatedAt,
      });
      const middleRow = await rowOf(middle.id);
      expect(middleRow?.status).toBe("superseded");
      expect(middleRow?.deletedAt).not.toBeNull();

      // Only the delete itself is on the timeline.
      expect(addedSince(entriesBefore, await entriesFor(project.id))).toEqual([
        ["work", "ADR-002 삭제 · D middle"],
      ]);
      expect(
        (await listDecisions(app, project.id)).decisions.map((d) => d.id),
      ).toEqual([latest.id]);
    });

    it("[REQ-AGENT-AUTOAPPLY-44] 이미 superseded 인 ADR 을 복구하면 삭제만 풀고 다른 ADR 의 상태는 바꾸지 않는다", async () => {
      const { project, app } = await adminSetup();
      const { previous, middle, latest } = await seedChain(app, project.id);
      expect(
        (await lifecycle(app, project.id, middle.id, "delete")).status,
      ).toBe(200);
      const previousBefore = await rowOf(previous.id);
      const latestBefore = await rowOf(latest.id);
      const entriesBefore = await entriesFor(project.id);

      const restored = await jsonDecision(
        await lifecycle(app, project.id, middle.id, "restore"),
      );
      expect(restored).toMatchObject({
        id: middle.id,
        status: "superseded",
        deletedAt: null,
        deletedBy: null,
        supersedes: { id: previous.id, status: "superseded" },
        supersededBy: { id: latest.id, status: "accepted" },
      });

      expect(await rowOf(previous.id)).toMatchObject({
        status: "superseded",
        deletedAt: null,
        updatedAt: previousBefore?.updatedAt,
      });
      expect(await rowOf(latest.id)).toMatchObject({
        status: "accepted",
        deletedAt: null,
        updatedAt: latestBefore?.updatedAt,
      });
      expect(addedSince(entriesBefore, await entriesFor(project.id))).toEqual([
        ["work", "ADR-002 복구 · D middle"],
      ]);
    });

    /** Title → status, with `/deleted` appended for a soft-deleted row. */
    async function chainState(decisions: Array<{ id: string }>) {
      const state: Record<string, string> = {};
      for (const { id } of decisions) {
        const row = await rowOf(id);
        state[row?.title ?? id] =
          `${row?.status}${row?.deletedAt ? "/deleted" : ""}`;
      }
      return state;
    }

    function liveAcceptedCount(state: Record<string, string>) {
      return Object.values(state).filter((value) => value === "accepted")
        .length;
    }

    it("[REQ-AGENT-AUTOAPPLY-20] [REQ-AGENT-AUTOAPPLY-21] [REQ-AGENT-AUTOAPPLY-22] [REQ-AGENT-AUTOAPPLY-44] P←D←E: D 와 E 를 지우면 P 가 accepted 가 되고, E 복구로 P 가 다시 superseded, D 복구로 원래 상태가 된다", async () => {
      const { project, app } = await adminSetup();
      const chain = await seedChain(app, project.id);
      const { previous, middle, latest } = chain;
      const all = [previous, middle, latest];
      expect(await chainState(all)).toEqual({
        "P original": "superseded",
        "D middle": "superseded",
        "E latest": "accepted",
      });

      // D is already superseded: deleting it moves nothing else.
      expect(
        await (await lifecycle(app, project.id, middle.id, "delete")).json(),
      ).toMatchObject({ restoredDecisionId: null });
      // E is accepted: acceptance walks past the deleted D to P.
      expect(
        await (await lifecycle(app, project.id, latest.id, "delete")).json(),
      ).toMatchObject({ restoredDecisionId: previous.id });
      expect(await chainState(all)).toEqual({
        "P original": "accepted",
        "D middle": "superseded/deleted",
        "E latest": "accepted/deleted",
      });

      // D cannot come back before E: nothing live would replace it.
      const early = await lifecycle(app, project.id, middle.id, "restore");
      expect(early.status).toBe(409);
      await expect(early.text()).resolves.toBe(
        "No live ADR replaces this superseded ADR; restore the ADR that replaced it first",
      );

      // E comes back: P, its nearest live ancestor, is superseded again.
      expect(
        await jsonDecision(
          await lifecycle(app, project.id, latest.id, "restore"),
        ),
      ).toMatchObject({ status: "accepted", deletedAt: null });
      expect(await chainState(all)).toEqual({
        "P original": "superseded",
        "D middle": "superseded/deleted",
        "E latest": "accepted",
      });

      // Now D: E replaces it again, so it returns exactly as it was.
      expect(
        await jsonDecision(
          await lifecycle(app, project.id, middle.id, "restore"),
        ),
      ).toMatchObject({
        status: "superseded",
        supersedes: { id: previous.id, status: "superseded" },
        supersededBy: { id: latest.id, status: "accepted" },
      });
      expect(await chainState(all)).toEqual({
        "P original": "superseded",
        "D middle": "superseded",
        "E latest": "accepted",
      });
      expect(
        (await listDecisions(app, project.id)).decisions.map((d) => d.id),
      ).toEqual([latest.id]);
    });

    it("[REQ-AGENT-AUTOAPPLY-20] [REQ-AGENT-AUTOAPPLY-22] 길이 4 체인 P←A←B←C 에서 accepted 는 매 단계 하나이고, 이어받은 체인이나 살아 있는 후손이 있으면 복구는 409", async () => {
      const { project, app } = await adminSetup();
      const p = await jsonDecision(
        await createDecision(app, project.id, { title: "P" }),
      );
      const a = await jsonDecision(
        await createDecision(app, project.id, {
          title: "A",
          supersedesDecisionId: p.id,
        }),
      );
      const b = await jsonDecision(
        await createDecision(app, project.id, {
          title: "B",
          supersedesDecisionId: a.id,
        }),
      );
      const c = await jsonDecision(
        await createDecision(app, project.id, {
          title: "C",
          supersedesDecisionId: b.id,
        }),
      );
      const all = [p, a, b, c];
      const step = async (
        decision: { id: string },
        action: "delete" | "restore",
        status = 200,
      ) => {
        const response = await lifecycle(app, project.id, decision.id, action);
        expect(response.status, await response.clone().text()).toBe(status);
        const state = await chainState(all);
        expect(liveAcceptedCount(state), JSON.stringify(state)).toBe(1);
        return response;
      };

      await step(b, "delete");
      expect(await (await step(c, "delete")).json()).toMatchObject({
        restoredDecisionId: a.id,
      });
      expect(await (await step(a, "delete")).json()).toMatchObject({
        restoredDecisionId: p.id,
      });
      expect(await chainState(all)).toEqual({
        P: "accepted",
        A: "accepted/deleted",
        B: "superseded/deleted",
        C: "accepted/deleted",
      });

      await step(c, "restore");
      await step(b, "restore");
      // A was the accepted end when it was deleted, but C is live below it now:
      // A back as accepted would be a second accepted ADR.
      const blocked = await step(a, "restore", 409);
      await expect(blocked.text()).resolves.toBe(
        "ADR-004 is now the accepted ADR of this supersede chain; restoring this one would make a second accepted ADR",
      );
      expect(await chainState(all)).toEqual({
        P: "superseded",
        A: "accepted/deleted",
        B: "superseded",
        C: "accepted",
      });

      // Another ADR takes the chain over from B; C cannot come back.
      expect(await (await step(c, "delete")).json()).toMatchObject({
        restoredDecisionId: b.id,
      });
      const x = await jsonDecision(
        await createDecision(app, project.id, {
          title: "X",
          supersedesDecisionId: b.id,
        }),
      );
      all.push(x);
      const takenOver = await step(c, "restore", 409);
      await expect(takenOver.text()).resolves.toBe(
        "ADR-005 is now the accepted ADR of this supersede chain; restoring this one would make a second accepted ADR",
      );
      expect(await chainState(all)).toEqual({
        P: "superseded",
        A: "accepted/deleted",
        B: "superseded",
        C: "accepted/deleted",
        X: "accepted",
      });
    });

    it("[REQ-AGENT-AUTOAPPLY-22] 같은 체인에 동시에 들어온 복구와 대체 작성 중 하나만 성공해 accepted 가 하나로 남는다", async () => {
      const { project, app } = await adminSetup();
      // P ← C ← D and, after D was deleted, P ← X: two branches whose heads
      // do not share a direct predecessor, so no unique index separates them.
      const p = await jsonDecision(
        await createDecision(app, project.id, { title: "P" }),
      );
      const c = await jsonDecision(
        await createDecision(app, project.id, {
          title: "C",
          supersedesDecisionId: p.id,
        }),
      );
      const d = await jsonDecision(
        await createDecision(app, project.id, {
          title: "D",
          supersedesDecisionId: c.id,
        }),
      );
      await lifecycle(app, project.id, c.id, "delete");
      await lifecycle(app, project.id, d.id, "delete");
      const x = await jsonDecision(
        await createDecision(app, project.id, {
          title: "X",
          supersedesDecisionId: p.id,
        }),
      );
      await lifecycle(app, project.id, x.id, "delete");
      await lifecycle(app, project.id, p.id, "delete");
      const all = [p, c, d, x];
      expect(await chainState(all)).toEqual({
        P: "accepted/deleted",
        C: "superseded/deleted",
        D: "accepted/deleted",
        X: "accepted/deleted",
      });

      const racing = await Promise.all([
        lifecycle(app, project.id, d.id, "restore"),
        lifecycle(app, project.id, x.id, "restore"),
      ]);
      expect(racing.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(liveAcceptedCount(await chainState(all))).toBe(1);

      // A replacement written while the chain's head is being restored.
      const q = await jsonDecision(
        await createDecision(app, project.id, { title: "Q" }),
      );
      const r = await jsonDecision(
        await createDecision(app, project.id, {
          title: "R",
          supersedesDecisionId: q.id,
        }),
      );
      await lifecycle(app, project.id, r.id, "delete");
      const [created, restored] = await Promise.all([
        createDecision(app, project.id, {
          title: "Y",
          supersedesDecisionId: q.id,
        }),
        lifecycle(app, project.id, r.id, "restore"),
      ]);
      expect([created.status, restored.status].sort()).toEqual([200, 409]);
      // Y exists only when the create won.
      const [y] = await db
        .select({ id: agentDecisionTable.id })
        .from(agentDecisionTable)
        .where(
          and(
            eq(agentDecisionTable.projectId, project.id),
            eq(agentDecisionTable.title, "Y"),
          ),
        );
      const qrState = await chainState(y ? [q, r, y] : [q, r]);
      expect(liveAcceptedCount(qrState), JSON.stringify(qrState)).toBe(1);
    });

    it("[REQ-AGENT-AUTOAPPLY-6] API 키로 만든 ADR 과 승격한 ADR 은 키 소유자가 작성자이지만 미확인으로 남는다", async () => {
      const { admin, project, app } = await adminSetup();
      const [entry] = await db
        .insert(agentEntryTable)
        .values({
          workspaceId: admin.workspace.id,
          projectId: project.id,
          createdBy: admin.user.id,
          kind: "decision",
          summary: "Use a durable queue",
          decision: {
            what: "Persist jobs before acknowledging them.",
            why: "Restarts must not lose work.",
          },
        })
        .returning();
      if (!entry) throw new Error("Failed to seed source entry");

      await seedApiKey(admin.user.id);
      const unreviewed = {
        status: "accepted",
        createdBy: admin.user.id,
        createdActor: null,
        acceptedBy: admin.user.id,
        reviewed: false,
        reviewedAt: null,
        reviewedBy: null,
      };
      const created = await jsonDecision(
        await app.request("/api/agent-decision", {
          method: "POST",
          headers: { "content-type": "application/json", ...viaKey },
          body: JSON.stringify({
            projectId: project.id,
            title: "Keyed ADR",
            context: "Written by a script.",
            decision: "Record it.",
            taskIds: [],
          }),
        }),
      );
      expect(created).toMatchObject(unreviewed);

      const promoted = await jsonDecision(
        await app.request(
          `/api/agent-decision/${project.id}/from-entry/${entry.id}`,
          { method: "POST", headers: viaKey },
        ),
      );
      expect(promoted).toMatchObject({
        ...unreviewed,
        sourceEntryId: entry.id,
      });
      expect((await listDecisions(app, project.id)).unreviewedTotal).toBe(2);
    });

    it("[REQ-AGENT-AUTOAPPLY-16] API 키로는 ADR 을 삭제·복구하지 못한다", async () => {
      const { admin, project, app } = await adminSetup();
      const decision = await jsonDecision(
        await createDecision(app, project.id),
      );

      await seedApiKey(admin.user.id);
      expect(
        (await lifecycle(app, project.id, decision.id, "delete", viaKey))
          .status,
      ).toBe(403);
      expect((await rowOf(decision.id))?.deletedAt).toBeNull();

      expect(
        (await lifecycle(app, project.id, decision.id, "delete")).status,
      ).toBe(200);
      expect(
        (await lifecycle(app, project.id, decision.id, "restore", viaKey))
          .status,
      ).toBe(403);
      expect((await rowOf(decision.id))?.deletedAt).not.toBeNull();
    });
  });
});
