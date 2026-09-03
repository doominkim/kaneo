import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  agentActorTable,
  agentEntryTable,
  agentProjectTable,
} from "../../apps/api/src/database/schema-agent-layer";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import { mcpToolCall, toolJson } from "./helpers/mcp";

type EntryUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
};

type EntrySummary = {
  id: string;
  taskId: string | null;
  kind: string;
  summary: string;
  hasDecision: boolean;
  coreChanged: string[] | null;
  repo: string | null;
  branch: string | null;
  effort: string | null;
  agentLabel: string | null;
  usage: EntryUsage | null;
  createdAt: string;
  actor: {
    id: string;
    provider: string;
    model: string;
    onBehalfOf: string | null;
  } | null;
  author: { userId: string; name: string } | null;
};

type EntryList = {
  entries: EntrySummary[];
  nextBefore: string | null;
};

type EntryDetail = EntrySummary & {
  workspaceId: string;
  projectId: string;
  body: string | null;
  decision: unknown;
  refs: unknown;
  compaction: string;
};

function appendBody(
  projectId: string,
  overrides: Record<string, unknown> = {},
) {
  return JSON.stringify({
    projectId,
    kind: "work",
    summary: "Wired the ledger",
    provider: "anthropic",
    model: "claude-opus-5",
    ...overrides,
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

describe("API integration: agent entries", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("rejects unauthenticated appends", async () => {
    mockAnonymousSession();
    const { app } = createApp();

    const response = await app.request("/api/agent-entry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: appendBody("project-missing"),
    });

    expect(response.status).toBe(401);
  });

  it("appends an entry for a member and persists the full record", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request("/api/agent-entry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: appendBody(project.id, {
        kind: "decision",
        summary: "Chose the append-only ledger",
        body: "Long form agent-facing notes",
        decision: {
          what: "append-only ledger",
          why: "corrections must stay visible",
          rejected: "in-place edits",
          reversible: false,
        },
        refs: {
          repo: "doominkim/kaneo",
          branch: "agent-layer",
          commits: ["abc123"],
          files: ["apps/api/src/agent-entry"],
        },
        sessionId: "session-1",
      }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as EntrySummary;

    expect(payload).toMatchObject({
      taskId: null,
      kind: "decision",
      summary: "Chose the append-only ledger",
      hasDecision: true,
      // files were given but no core paths are configured: judged, none matched
      coreChanged: [],
      repo: "doominkim/kaneo",
      branch: "agent-layer",
    });
    expect(payload.actor).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-5",
      onBehalfOf: member.user.id,
    });
    expect(payload.author).toBeNull();

    // The append response is deliberately the SUMMARY shape.
    expect(payload).not.toHaveProperty("body");
    expect(payload).not.toHaveProperty("decision");

    const [persisted] = await db
      .select()
      .from(agentEntryTable)
      .where(eq(agentEntryTable.id, payload.id));

    expect(persisted).toMatchObject({
      workspaceId: member.workspace.id,
      projectId: project.id,
      taskId: null,
      sessionId: "session-1",
      kind: "decision",
      summary: "Chose the append-only ledger",
      body: "Long form agent-facing notes",
      compaction: "full",
      createdBy: null,
    });
    expect(persisted?.decision).toMatchObject({
      what: "append-only ledger",
      why: "corrections must stay visible",
      rejected: "in-place edits",
      reversible: false,
    });

    const actors = await db
      .select()
      .from(agentActorTable)
      .where(eq(agentActorTable.workspaceId, member.workspace.id));

    expect(actors).toHaveLength(1);
    expect(actors[0]).toMatchObject({
      id: payload.actor?.id,
      provider: "anthropic",
      model: "claude-opus-5",
      onBehalfOf: member.user.id,
    });
  });

  it("defaults kind to work and links an optional task", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id, 1);

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request("/api/agent-entry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        taskId: task.id,
        summary: "Touched the task",
        provider: "anthropic",
        model: "claude-opus-5",
      }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as EntrySummary;

    expect(payload).toMatchObject({
      taskId: task.id,
      kind: "work",
      hasDecision: false,
      coreChanged: null,
      repo: null,
      branch: null,
    });
  });

  it("reuses one actor per provider+model and creates a new one per model", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const first = await app.request("/api/agent-entry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: appendBody(project.id),
    });
    const second = await app.request("/api/agent-entry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: appendBody(project.id, { summary: "Second pass" }),
    });
    const other = await app.request("/api/agent-entry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: appendBody(project.id, {
        summary: "Different model",
        provider: "openai",
        model: "gpt-5.6",
      }),
    });

    const firstPayload = (await first.json()) as EntrySummary;
    const secondPayload = (await second.json()) as EntrySummary;
    const otherPayload = (await other.json()) as EntrySummary;

    expect(secondPayload.actor?.id).toBe(firstPayload.actor?.id);
    expect(otherPayload.actor?.id).not.toBe(firstPayload.actor?.id);

    const actors = await db
      .select()
      .from(agentActorTable)
      .where(eq(agentActorTable.workspaceId, member.workspace.id));

    expect(actors).toHaveLength(2);
  });

  it("round-trips effort, agentLabel, usage and refs.repo/branch", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const usage = {
      inputTokens: 1200,
      outputTokens: 300,
      totalTokens: 1500,
      cacheReadTokens: 900,
    };
    const refs = {
      repo: "doominkim/kaneo",
      branch: "agent-layer",
      commits: ["abc123"],
    };

    const appended = await app.request("/api/agent-entry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: appendBody(project.id, {
        effort: "xhigh",
        agentLabel: "3setter",
        usage,
        refs,
      }),
    });
    expect(appended.status).toBe(200);
    const summary = (await appended.json()) as EntrySummary;
    expect(summary).toMatchObject({
      effort: "xhigh",
      agentLabel: "3setter",
      usage,
    });

    const listed = (await (
      await app.request(`/api/agent-entry/${project.id}`)
    ).json()) as EntryList;
    expect(listed.entries[0]).toMatchObject({
      effort: "xhigh",
      agentLabel: "3setter",
      usage,
    });

    const detail = (await (
      await app.request(`/api/agent-entry/${project.id}/${summary.id}`)
    ).json()) as EntryDetail;
    expect(detail).toMatchObject({
      effort: "xhigh",
      agentLabel: "3setter",
      usage,
      refs,
    });

    const [persisted] = await db
      .select()
      .from(agentEntryTable)
      .where(eq(agentEntryTable.id, summary.id));
    expect(persisted).toMatchObject({
      effort: "xhigh",
      agentLabel: "3setter",
    });
    expect(persisted?.usage).toEqual(usage);
    expect(persisted?.refs).toEqual(refs);
  });

  it("leaves the cost fields null when omitted, for old clients", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request("/api/agent-entry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: appendBody(project.id),
    });
    expect(response.status).toBe(200);
    expect((await response.json()) as EntrySummary).toMatchObject({
      effort: null,
      agentLabel: null,
      usage: null,
    });
  });

  it("rejects an effort outside the vocabulary, negative usage, and an oversized label", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    for (const overrides of [
      { effort: "ultra" },
      { usage: { totalTokens: -1 } },
      { usage: { inputTokens: 1.5 } },
      { agentLabel: "x".repeat(65) },
      { refs: { branch: "b".repeat(201) } },
    ]) {
      const response = await app.request("/api/agent-entry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: appendBody(project.id, overrides),
      });
      expect(response.status, JSON.stringify(overrides)).toBe(400);
    }

    const persisted = await db
      .select()
      .from(agentEntryTable)
      .where(eq(agentEntryTable.projectId, project.id));
    expect(persisted).toHaveLength(0);
  });

  it("rejects a summary longer than the 200 character cap", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request("/api/agent-entry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: appendBody(project.id, { summary: "x".repeat(201) }),
    });

    expect(response.status).toBe(400);

    const persisted = await db
      .select()
      .from(agentEntryTable)
      .where(eq(agentEntryTable.projectId, project.id));
    expect(persisted).toHaveLength(0);
  });

  it("rejects a kind outside the ledger vocabulary", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request("/api/agent-entry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: appendBody(project.id, { kind: "refactor" }),
    });

    expect(response.status).toBe(400);
  });

  it("rejects an append when the workspace cannot be resolved from the project", async () => {
    const member = await createWorkspaceMember();

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await app.request("/api/agent-entry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: appendBody("project-does-not-exist"),
    });

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe(
      "Workspace ID could not be determined",
    );
  });

  it("rejects appends from users outside the project workspace", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    const outsiderId = `user-${randomUUID()}`;
    const [outsider] = await db
      .insert(schema.userTable)
      .values({
        id: outsiderId,
        email: `${outsiderId}@example.com`,
        emailVerified: true,
        name: "Entry Outsider",
      })
      .returning();

    mockAuthenticatedSession(outsider);
    const { app } = createApp();

    const response = await app.request("/api/agent-entry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: appendBody(project.id, { summary: "Forbidden append" }),
    });

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe(
      "You don't have access to this workspace",
    );

    const persisted = await db
      .select()
      .from(agentEntryTable)
      .where(eq(agentEntryTable.summary, "Forbidden append"));

    expect(persisted).toHaveLength(0);
  });

  it("blocks a viewer from appending but still allows listing", async () => {
    const member = await createWorkspaceMember({ role: "viewer" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const append = await app.request("/api/agent-entry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: appendBody(project.id),
    });

    expect(append.status).toBe(403);
    await expect(append.text()).resolves.toBe("Insufficient permissions");

    const list = await app.request(`/api/agent-entry/${project.id}`);
    expect(list.status).toBe(200);
    expect((await list.json()) as EntryList).toEqual({
      entries: [],
      nextBefore: null,
    });
  });

  describe("listing", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    async function seedEntries(workspaceId: string, projectId: string) {
      const [actor] = await db
        .insert(agentActorTable)
        .values({ workspaceId, provider: "anthropic", model: "claude-opus-5" })
        .returning();

      const base = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
      const rows: (typeof agentEntryTable.$inferSelect)[] = [];

      for (const [index, spec] of [
        { summary: "oldest", kind: "work", decision: null },
        {
          summary: "middle",
          kind: "investigation",
          decision: { what: "a", why: "b" },
        },
        { summary: "newest", kind: "work", decision: null },
      ].entries()) {
        const [row] = await db
          .insert(agentEntryTable)
          .values({
            workspaceId,
            projectId,
            actorId: actor.id,
            kind: spec.kind,
            summary: spec.summary,
            body: `body of ${spec.summary}`,
            decision: spec.decision,
            createdAt: new Date(base + index * 60_000),
          })
          .returning();
        rows.push(row);
      }

      return { actor, rows };
    }

    it("returns summaries newest first without body or decision", async () => {
      const member = await createWorkspaceMember();
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const { actor } = await seedEntries(member.workspace.id, project.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(`/api/agent-entry/${project.id}`);
      expect(response.status).toBe(200);

      const payload = (await response.json()) as EntryList;
      expect(payload.entries.map((entry) => entry.summary)).toEqual([
        "newest",
        "middle",
        "oldest",
      ]);
      expect(payload.nextBefore).toBeNull();

      const [first] = payload.entries;
      expect(first).not.toHaveProperty("body");
      expect(first).not.toHaveProperty("decision");
      expect(first.hasDecision).toBe(false);
      expect(payload.entries[1].hasDecision).toBe(true);
      expect(first.actor).toEqual({
        id: actor.id,
        provider: "anthropic",
        model: "claude-opus-5",
        onBehalfOf: null,
      });
      expect(first.author).toBeNull();
    });

    it("pages with limit and the nextBefore cursor", async () => {
      const member = await createWorkspaceMember();
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await seedEntries(member.workspace.id, project.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const firstPage = (await (
        await app.request(`/api/agent-entry/${project.id}?limit=2`)
      ).json()) as EntryList;

      expect(firstPage.entries.map((entry) => entry.summary)).toEqual([
        "newest",
        "middle",
      ]);
      // The cursor is the last entry's id, not its timestamp.
      expect(firstPage.nextBefore).toBe(firstPage.entries[1]?.id ?? null);

      const secondPage = (await (
        await app.request(
          `/api/agent-entry/${project.id}?limit=2&before=${encodeURIComponent(
            firstPage.nextBefore ?? "",
          )}`,
        )
      ).json()) as EntryList;

      expect(secondPage.entries.map((entry) => entry.summary)).toEqual([
        "oldest",
      ]);
      expect(secondPage.nextBefore).toBeNull();
    });

    it("rejects a cursor that is not an entry of the project", async () => {
      const member = await createWorkspaceMember();
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const otherProject = await createProjectFixture({
        workspaceId: member.workspace.id,
        name: "Other project",
      });
      await seedEntries(member.workspace.id, project.id);
      const [foreign] = await db
        .insert(agentEntryTable)
        .values({
          workspaceId: member.workspace.id,
          projectId: otherProject.project.id,
          summary: "other project entry",
        })
        .returning();

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      // A timestamp is what the old contract accepted; it must now fail loudly
      // rather than silently return the first page.
      const stale = await app.request(
        `/api/agent-entry/${project.id}?before=${encodeURIComponent(
          "2026-01-01T00:00:00.000Z",
        )}`,
      );
      expect(stale.status).toBe(400);
      await expect(stale.text()).resolves.toBe("Unknown cursor");

      // An entry id from another project is equally unknown here, so the
      // response does not reveal whether that id exists.
      const crossProject = await app.request(
        `/api/agent-entry/${project.id}?before=${foreign.id}`,
      );
      expect(crossProject.status).toBe(400);
      await expect(crossProject.text()).resolves.toBe("Unknown cursor");
    });

    it("filters by kind and taskId and scopes to the project", async () => {
      const member = await createWorkspaceMember();
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const otherProject = await createProjectFixture({
        workspaceId: member.workspace.id,
        name: "Other project",
      });
      await seedEntries(member.workspace.id, project.id);
      await db.insert(agentEntryTable).values({
        workspaceId: member.workspace.id,
        projectId: otherProject.project.id,
        summary: "other project entry",
      });

      const task = await seedTask(project.id, columns.todo.id, 1);
      await db.insert(agentEntryTable).values({
        workspaceId: member.workspace.id,
        projectId: project.id,
        taskId: task.id,
        summary: "task scoped",
      });

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const byKind = (await (
        await app.request(`/api/agent-entry/${project.id}?kind=investigation`)
      ).json()) as EntryList;
      expect(byKind.entries.map((entry) => entry.summary)).toEqual(["middle"]);

      const byTask = (await (
        await app.request(`/api/agent-entry/${project.id}?taskId=${task.id}`)
      ).json()) as EntryList;
      expect(byTask.entries.map((entry) => entry.summary)).toEqual([
        "task scoped",
      ]);

      const scoped = (await (
        await app.request(`/api/agent-entry/${project.id}`)
      ).json()) as EntryList;
      expect(
        scoped.entries.some((entry) => entry.summary === "other project entry"),
      ).toBe(false);
    });

    // A project-level note (the timeline header composer) has task_id NULL.
    // The tree only lists entries under task nodes, so without this filter
    // those rows are stored but never shown anywhere.
    it("lists the project-level entries with taskId=none and keeps them out of a task filter", async () => {
      const member = await createWorkspaceMember();
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, columns.todo.id, 1);
      const base = Date.UTC(2026, 2, 1, 0, 0, 0, 0);
      await db.insert(agentEntryTable).values([
        {
          workspaceId: member.workspace.id,
          projectId: project.id,
          taskId: null,
          createdBy: member.user.id,
          summary: "project note old",
          createdAt: new Date(base),
        },
        {
          workspaceId: member.workspace.id,
          projectId: project.id,
          taskId: task.id,
          summary: "task scoped",
          createdAt: new Date(base + 60_000),
        },
        {
          workspaceId: member.workspace.id,
          projectId: project.id,
          taskId: null,
          createdBy: member.user.id,
          summary: "project note new",
          createdAt: new Date(base + 120_000),
        },
      ]);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const projectLevel = (await (
        await app.request(`/api/agent-entry/${project.id}?taskId=none`)
      ).json()) as EntryList;
      expect(projectLevel.entries.map((entry) => entry.summary)).toEqual([
        "project note new",
        "project note old",
      ]);
      expect(projectLevel.entries.every((entry) => entry.taskId === null)).toBe(
        true,
      );

      const byTask = (await (
        await app.request(`/api/agent-entry/${project.id}?taskId=${task.id}`)
      ).json()) as EntryList;
      expect(byTask.entries.map((entry) => entry.summary)).toEqual([
        "task scoped",
      ]);

      const all = (await (
        await app.request(`/api/agent-entry/${project.id}`)
      ).json()) as EntryList;
      expect(all.entries.map((entry) => entry.summary)).toEqual([
        "project note new",
        "task scoped",
        "project note old",
      ]);

      // The sentinel pages like any other filter: the cursor stays inside it.
      const firstPage = (await (
        await app.request(`/api/agent-entry/${project.id}?taskId=none&limit=1`)
      ).json()) as EntryList;
      expect(firstPage.entries.map((entry) => entry.summary)).toEqual([
        "project note new",
      ]);
      expect(firstPage.nextBefore).not.toBeNull();
      const secondPage = (await (
        await app.request(
          `/api/agent-entry/${project.id}?taskId=none&limit=1&before=${encodeURIComponent(firstPage.nextBefore ?? "")}`,
        )
      ).json()) as EntryList;
      expect(secondPage.entries.map((entry) => entry.summary)).toEqual([
        "project note old",
      ]);

      // agent_log_tail forwards taskId unchanged; route its HTTP hop back in.
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input));
          return app.request(`${url.pathname}${url.search}`, init);
        }),
      );
      const viaMcp = toolJson<EntryList>(
        await mcpToolCall(app, "agent_log_tail", {
          projectId: project.id,
          taskId: "none",
        }),
      );
      expect(viaMcp.entries.map((entry) => entry.summary)).toEqual([
        "project note new",
        "project note old",
      ]);
    });

    // PostgreSQL stores `created_at` to the microsecond while a JS Date carries
    // milliseconds, so a timestamp cursor would skip every row inside the
    // truncated window. The cursor is the last entry's id and its created_at is
    // read back inside the query, which keeps full precision.
    it("pages every entry exactly once when timestamps differ below the millisecond", async () => {
      const member = await createWorkspaceMember();
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });

      const summaries = ["first", "second", "third"];
      const ids: string[] = [];
      for (const summary of summaries) {
        const [row] = await db
          .insert(agentEntryTable)
          .values({
            workspaceId: member.workspace.id,
            projectId: project.id,
            summary,
          })
          .returning();
        ids.push(row.id);
      }

      // Same millisecond, different microseconds. This has to go through raw
      // SQL: the driver binds a JS Date, which cannot express sub-millisecond
      // precision in the first place.
      const stamps = [
        "2026-01-01 00:00:00.000100",
        "2026-01-01 00:00:00.000200",
        "2026-01-01 00:00:00.000300",
      ];
      for (const [index, id] of ids.entries()) {
        await db.execute(
          sql`update agent_entry set created_at = ${stamps[index]}::timestamp where id = ${id}`,
        );
      }

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const seen: string[] = [];
      let before: string | null = null;

      for (let page = 0; page < summaries.length + 2; page += 1) {
        const url = before
          ? `/api/agent-entry/${project.id}?limit=1&before=${encodeURIComponent(before)}`
          : `/api/agent-entry/${project.id}?limit=1`;
        const payload = (await (await app.request(url)).json()) as EntryList;
        seen.push(...payload.entries.map((entry) => entry.summary));
        if (!payload.nextBefore) break;
        before = payload.nextBefore;
      }

      expect([...seen].sort()).toEqual([...summaries].sort());
    });

    // Identical timestamps are the case the (created_at, id) tie-break exists
    // for: with created_at alone the cursor could neither include nor exclude
    // the equal rows without dropping or repeating one.
    it("pages every entry exactly once when several share the same created_at", async () => {
      const member = await createWorkspaceMember();
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });

      const summaries = ["alpha", "beta", "gamma"];
      const ids: string[] = [];
      for (const summary of summaries) {
        const [row] = await db
          .insert(agentEntryTable)
          .values({
            workspaceId: member.workspace.id,
            projectId: project.id,
            summary,
          })
          .returning();
        ids.push(row.id);
      }

      // Raw SQL so all three rows carry the exact same stored value, down to
      // the microsecond, rather than three driver-serialised Dates.
      for (const id of ids) {
        await db.execute(
          sql`update agent_entry set created_at = '2026-02-02 12:00:00.000500'::timestamp where id = ${id}`,
        );
      }

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const seen: string[] = [];
      let before: string | null = null;

      for (let page = 0; page < summaries.length + 2; page += 1) {
        const url = before
          ? `/api/agent-entry/${project.id}?limit=1&before=${encodeURIComponent(before)}`
          : `/api/agent-entry/${project.id}?limit=1`;
        const payload = (await (await app.request(url)).json()) as EntryList;
        seen.push(...payload.entries.map((entry) => entry.summary));
        if (!payload.nextBefore) break;
        before = payload.nextBefore;
      }

      expect(seen).toHaveLength(summaries.length);
      expect(new Set(seen).size).toBe(summaries.length);
      expect([...seen].sort()).toEqual([...summaries].sort());
    });

    it("rejects a limit above the cap", async () => {
      const member = await createWorkspaceMember();
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(
        `/api/agent-entry/${project.id}?limit=51`,
      );

      expect(response.status).toBe(400);
    });

    it("rejects listing for users outside the workspace", async () => {
      const member = await createWorkspaceMember();
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });

      const outsiderId = `user-${randomUUID()}`;
      const [outsider] = await db
        .insert(schema.userTable)
        .values({
          id: outsiderId,
          email: `${outsiderId}@example.com`,
          emailVerified: true,
          name: "List Outsider",
        })
        .returning();

      mockAuthenticatedSession(outsider);
      const { app } = createApp();

      const response = await app.request(`/api/agent-entry/${project.id}`);
      expect(response.status).toBe(403);
      await expect(response.text()).resolves.toBe(
        "You don't have access to this workspace",
      );
    });
  });

  // One note stream, two kinds of author (DESIGN.md §2.3): the body decides.
  // provider + model → agent entry; neither → human entry by the caller.
  describe("human entries", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function humanBody(projectId: string, overrides: Record<string, unknown>) {
      return JSON.stringify({
        projectId,
        summary: "Reviewed the plan by hand",
        ...overrides,
      });
    }

    it("attributes an entry without provider/model to the current user", async () => {
      const member = await createWorkspaceMember({ userName: "Dominic" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const task = await seedTask(project.id, columns.todo.id, 1);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request("/api/agent-entry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: humanBody(project.id, {
          taskId: task.id,
          kind: "decision",
          body: "long form written by a person",
          decision: { what: "ship it", why: "reviewed", rejected: "wait" },
          refs: { repo: "doominkim/kaneo", branch: "agent-layer" },
          sessionId: null,
        }),
      });

      expect(response.status).toBe(200);
      const payload = (await response.json()) as EntrySummary;
      expect(payload).toMatchObject({
        taskId: task.id,
        kind: "decision",
        summary: "Reviewed the plan by hand",
        hasDecision: true,
        repo: "doominkim/kaneo",
        branch: "agent-layer",
        effort: null,
        agentLabel: null,
        usage: null,
        actor: null,
        author: { userId: member.user.id, name: "Dominic" },
      });

      const [persisted] = await db
        .select()
        .from(agentEntryTable)
        .where(eq(agentEntryTable.id, payload.id));
      expect(persisted).toMatchObject({
        actorId: null,
        createdBy: member.user.id,
        body: "long form written by a person",
      });

      // No agent_actor row is minted for a human write.
      const actors = await db
        .select()
        .from(agentActorTable)
        .where(eq(agentActorTable.workspaceId, member.workspace.id));
      expect(actors).toHaveLength(0);
    });

    it("rejects provider without model and model without provider", async () => {
      const member = await createWorkspaceMember();
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const providerOnly = await app.request("/api/agent-entry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: humanBody(project.id, { provider: "anthropic" }),
      });
      expect(providerOnly.status).toBe(400);
      await expect(providerOnly.text()).resolves.toBe(
        "model: provider and model must be given together",
      );

      const modelOnly = await app.request("/api/agent-entry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: humanBody(project.id, { model: "claude-opus-5" }),
      });
      expect(modelOnly.status).toBe(400);
      await expect(modelOnly.text()).resolves.toBe(
        "provider: provider and model must be given together",
      );

      const rows = await db
        .select({ id: agentEntryTable.id })
        .from(agentEntryTable);
      expect(rows).toHaveLength(0);
    });

    it("rejects effort, agentLabel and usage on a human entry", async () => {
      const member = await createWorkspaceMember();
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      for (const [field, value, message] of [
        [
          "effort",
          "high",
          "effort: effort is only accepted with provider and model (an agent entry)",
        ],
        [
          "agentLabel",
          "3setter",
          "agentLabel: agentLabel is only accepted with provider and model (an agent entry)",
        ],
        [
          "usage",
          { totalTokens: 5 },
          "usage: usage is only accepted with provider and model (an agent entry)",
        ],
      ] as const) {
        const response = await app.request("/api/agent-entry", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: humanBody(project.id, { [field]: value }),
        });
        expect(response.status, field).toBe(400);
        await expect(response.text()).resolves.toBe(message);
      }

      // Explicit nulls are not "present": an agent-shaped client that always
      // sends the keys can still post a human entry.
      const nulls = await app.request("/api/agent-entry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: humanBody(project.id, {
          effort: null,
          agentLabel: null,
          usage: null,
        }),
      });
      expect(nulls.status).toBe(200);
    });

    it("still requires task:update — a viewer cannot post a human entry", async () => {
      const member = await createWorkspaceMember({ role: "viewer" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request("/api/agent-entry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: humanBody(project.id, {}),
      });
      expect(response.status).toBe(403);
    });

    it("interleaves human and agent entries with their authors in list, detail and the handoff filter", async () => {
      const member = await createWorkspaceMember({ userName: "Dominic" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const agentHandoff = (await (
        await app.request("/api/agent-entry", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: appendBody(project.id, {
            kind: "handoff",
            summary: "agent handoff",
          }),
        })
      ).json()) as EntrySummary;
      const humanNote = (await (
        await app.request("/api/agent-entry", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: humanBody(project.id, { summary: "human note" }),
        })
      ).json()) as EntrySummary;
      const humanHandoff = (await (
        await app.request("/api/agent-entry", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: humanBody(project.id, {
            kind: "handoff",
            summary: "human handoff",
            body: "where we are",
          }),
        })
      ).json()) as EntrySummary;

      const list = (await (
        await app.request(`/api/agent-entry/${project.id}`)
      ).json()) as EntryList;
      expect(
        list.entries.map((e) => [e.summary, e.actor?.model ?? null, e.author]),
      ).toEqual([
        ["human handoff", null, { userId: member.user.id, name: "Dominic" }],
        ["human note", null, { userId: member.user.id, name: "Dominic" }],
        ["agent handoff", "claude-opus-5", null],
      ]);

      // The overview callout takes the latest handoff whoever wrote it.
      const handoffs = (await (
        await app.request(`/api/agent-entry/${project.id}?kind=handoff`)
      ).json()) as EntryList;
      expect(handoffs.entries.map((e) => e.id)).toEqual([
        humanHandoff.id,
        agentHandoff.id,
      ]);
      expect(handoffs.entries[0].author?.name).toBe("Dominic");

      const detail = (await (
        await app.request(`/api/agent-entry/${project.id}/${humanHandoff.id}`)
      ).json()) as EntryDetail;
      expect(detail).toMatchObject({
        id: humanHandoff.id,
        body: "where we are",
        actor: null,
        author: { userId: member.user.id, name: "Dominic" },
      });
      expect(humanNote.author?.userId).toBe(member.user.id);
    });

    it("carries author through agent_brief.recentEntries and agent_log_tail", async () => {
      const member = await createWorkspaceMember({ userName: "Dominic" });
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      mockAuthenticatedSession(member.user);
      const { app } = createApp();
      // The tools reach the API over HTTP; route that into the same app.
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input));
          return app.request(`${url.pathname}${url.search}`, init);
        }),
      );

      await app.request("/api/agent-entry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: humanBody(project.id, { summary: "human note" }),
      });
      await mcpToolCall(app, "agent_log_append", {
        projectId: project.id,
        summary: "agent note",
        provider: "anthropic",
        model: "claude-opus-5",
      });

      const tail = toolJson<EntryList>(
        await mcpToolCall(app, "agent_log_tail", { projectId: project.id }),
      );
      expect(
        tail.entries.map((e) => [e.summary, e.actor?.model ?? null, e.author]),
      ).toEqual([
        ["agent note", "claude-opus-5", null],
        ["human note", null, { userId: member.user.id, name: "Dominic" }],
      ]);

      const brief = toolJson<{ recentEntries: EntrySummary[] }>(
        await mcpToolCall(app, "agent_brief", { projectId: project.id }),
      );
      expect(brief.recentEntries.map((e) => e.author)).toEqual([
        null,
        { userId: member.user.id, name: "Dominic" },
      ]);

      // The MCP write path is agent-only: provider/model stay required there.
      const rejected = await mcpToolCall(app, "agent_log_append", {
        projectId: project.id,
        summary: "no identity",
      });
      expect(rejected.isError).toBe(true);
    });
  });

  describe("fetching one entry", () => {
    it("returns the full record including body and decision", async () => {
      const member = await createWorkspaceMember();
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const appended = (await (
        await app.request("/api/agent-entry", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: appendBody(project.id, {
            body: "the long form",
            decision: { what: "x", why: "y" },
          }),
        })
      ).json()) as EntrySummary;

      const response = await app.request(
        `/api/agent-entry/${project.id}/${appended.id}`,
      );

      expect(response.status).toBe(200);
      const payload = (await response.json()) as EntryDetail;

      expect(payload).toMatchObject({
        id: appended.id,
        workspaceId: member.workspace.id,
        projectId: project.id,
        kind: "work",
        summary: "Wired the ledger",
        body: "the long form",
        compaction: "full",
      });
      expect(payload.decision).toEqual({ what: "x", why: "y" });
      expect(payload.actor).toMatchObject({
        provider: "anthropic",
        model: "claude-opus-5",
        onBehalfOf: member.user.id,
      });
    });

    it("returns 404 for an unknown entry id", async () => {
      const member = await createWorkspaceMember();
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(
        `/api/agent-entry/${project.id}/entry-does-not-exist`,
      );

      expect(response.status).toBe(404);
      await expect(response.text()).resolves.toBe("Entry not found");
    });

    // The `{projectId}` segment is what the workspace-access middleware
    // authorizes against, so the lookup must be scoped by it too. Otherwise a
    // caller could authorize against a project they own and read any entry in
    // the instance, body and decision included.
    it("does not return an entry belonging to another workspace", async () => {
      const victim = await createWorkspaceMember();
      const victimProject = await createProjectFixture({
        workspaceId: victim.workspace.id,
      });
      const [foreignEntry] = await db
        .insert(agentEntryTable)
        .values({
          workspaceId: victim.workspace.id,
          projectId: victimProject.project.id,
          summary: "secret summary",
          body: "secret body",
        })
        .returning();

      const caller = await createWorkspaceMember();
      const callerProject = await createProjectFixture({
        workspaceId: caller.workspace.id,
      });

      mockAuthenticatedSession(caller.user);
      const { app } = createApp();

      const response = await app.request(
        `/api/agent-entry/${callerProject.project.id}/${foreignEntry.id}`,
      );

      expect(response.status).toBe(404);
    });

    it("rejects fetching an entry for users outside the workspace", async () => {
      const member = await createWorkspaceMember();
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const [entry] = await db
        .insert(agentEntryTable)
        .values({
          workspaceId: member.workspace.id,
          projectId: project.id,
          summary: "private",
        })
        .returning();

      const outsiderId = `user-${randomUUID()}`;
      const [outsider] = await db
        .insert(schema.userTable)
        .values({
          id: outsiderId,
          email: `${outsiderId}@example.com`,
          emailVerified: true,
          name: "Get Outsider",
        })
        .returning();

      mockAuthenticatedSession(outsider);
      const { app } = createApp();

      const response = await app.request(
        `/api/agent-entry/${project.id}/${entry.id}`,
      );

      expect(response.status).toBe(403);
      await expect(response.text()).resolves.toBe(
        "You don't have access to this workspace",
      );
    });
  });

  it("keeps the ledger append-only: no update surface is mounted (delete is a soft hide, tested below)", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const [entry] = await db
      .insert(agentEntryTable)
      .values({
        workspaceId: member.workspace.id,
        projectId: project.id,
        summary: "immutable",
      })
      .returning();

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const updated = await app.request(
      `/api/agent-entry/${project.id}/${entry.id}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ summary: "tampered" }),
      },
    );
    const patched = await app.request(
      `/api/agent-entry/${project.id}/${entry.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ summary: "tampered" }),
      },
    );

    expect(updated.status).toBe(404);
    expect(patched.status).toBe(404);

    const [persisted] = await db
      .select()
      .from(agentEntryTable)
      .where(
        and(
          eq(agentEntryTable.id, entry.id),
          eq(agentEntryTable.summary, "immutable"),
        ),
      );

    expect(persisted).toBeDefined();
  });
});

describe("API integration: agent entry core-path judgment", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  async function configure(
    projectId: string,
    workspaceId: string,
    corePaths: string[],
  ) {
    await db
      .insert(agentProjectTable)
      .values({ projectId, workspaceId, corePaths })
      .onConflictDoUpdate({
        target: agentProjectTable.projectId,
        set: { corePaths },
      });
  }

  async function append(projectId: string, overrides: Record<string, unknown>) {
    const { app } = createApp();
    const response = await app.request("/api/agent-entry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: appendBody(projectId, overrides),
    });
    expect(response.status).toBe(200);
    return (await response.json()) as EntrySummary;
  }

  it("matches refs.files against the configured patterns, nested at any depth", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await configure(project.id, member.workspace.id, [
      "src/domain/**",
      "**/migrations/**",
    ]);
    mockAuthenticatedSession(member.user);

    const entry = await append(project.id, {
      refs: {
        files: [
          "README.md",
          "src/domain/order/order.ts",
          "src/ui/button.tsx",
          "apps/api/drizzle/migrations/0001_init.sql",
          "src/domain.ts",
        ],
      },
    });

    expect(entry.coreChanged).toEqual([
      "src/domain/order/order.ts",
      "apps/api/drizzle/migrations/0001_init.sql",
    ]);

    // Persisted, and identical on every read surface.
    const [row] = await db
      .select({ coreChanged: agentEntryTable.coreChanged })
      .from(agentEntryTable)
      .where(eq(agentEntryTable.id, entry.id));
    expect(row?.coreChanged).toEqual(entry.coreChanged);

    const { app } = createApp();
    const list = (await (
      await app.request(`/api/agent-entry/${project.id}`)
    ).json()) as EntryList;
    expect(list.entries[0]?.coreChanged).toEqual(entry.coreChanged);
    const detail = (await (
      await app.request(`/api/agent-entry/${project.id}/${entry.id}`)
    ).json()) as EntryDetail;
    expect(detail.coreChanged).toEqual(entry.coreChanged);
  });

  it("is null without refs.files and [] when nothing is configured", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);

    // No settings row at all.
    expect((await append(project.id, {})).coreChanged).toBeNull();
    expect(
      (await append(project.id, { refs: { branch: "main" } })).coreChanged,
    ).toBeNull();
    expect((await append(project.id, { refs: null })).coreChanged).toBeNull();
    expect(
      (await append(project.id, { refs: { files: ["src/domain/a.ts"] } }))
        .coreChanged,
    ).toEqual([]);
    expect(
      (await append(project.id, { refs: { files: [] } })).coreChanged,
    ).toEqual([]);

    // A settings row with an empty pattern list behaves the same.
    await configure(project.id, member.workspace.id, []);
    expect(
      (await append(project.id, { refs: { files: ["src/domain/a.ts"] } }))
        .coreChanged,
    ).toEqual([]);
    expect((await append(project.id, {})).coreChanged).toBeNull();
  });

  it("includes dotfiles, normalizes paths, skips unmatchable ones, dedupes", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await configure(project.id, member.workspace.id, ["src/domain/**"]);
    mockAuthenticatedSession(member.user);

    const entry = await append(project.id, {
      refs: {
        files: [
          "./src/domain/a.ts",
          "src/domain/a.ts",
          "src/domain/.env.example",
          "src/domain/.config/x.json",
          "/abs/src/domain/b.ts",
          "src/../src/domain/c.ts",
          "src/.hidden",
        ],
      },
    });

    expect(entry.coreChanged).toEqual([
      "src/domain/a.ts",
      "src/domain/.env.example",
      "src/domain/.config/x.json",
    ]);
    // refs are stored as sent; only the judgment is normalized.
    const detail = (await (
      await createApp().app.request(
        `/api/agent-entry/${project.id}/${entry.id}`,
      )
    ).json()) as EntryDetail;
    expect((detail.refs as { files: string[] }).files[0]).toBe(
      "./src/domain/a.ts",
    );
  });

  it("ignores a client-supplied coreChanged and never re-judges old rows", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);

    // Old clients still send the removed field: stripped, not a 400.
    const claimed = await append(project.id, {
      coreChanged: ["src/domain/claimed.ts"],
    });
    expect(claimed.coreChanged).toBeNull();
    const claimedWithFiles = await append(project.id, {
      coreChanged: ["src/domain/claimed.ts"],
      refs: { files: ["src/domain/claimed.ts"] },
    });
    expect(claimedWithFiles.coreChanged).toEqual([]);

    // Configuring patterns afterwards changes future verdicts only.
    await configure(project.id, member.workspace.id, ["src/domain/**"]);
    const after = await append(project.id, {
      refs: { files: ["src/domain/claimed.ts"] },
    });
    expect(after.coreChanged).toEqual(["src/domain/claimed.ts"]);

    const list = (await (
      await createApp().app.request(`/api/agent-entry/${project.id}?limit=10`)
    ).json()) as EntryList;
    const byId = new Map(list.entries.map((e) => [e.id, e.coreChanged]));
    expect(byId.get(claimed.id)).toBeNull();
    expect(byId.get(claimedWithFiles.id)).toEqual([]);
    expect(byId.get(after.id)).toEqual(["src/domain/claimed.ts"]);
  });

  it("uses the patterns of the entry's own project", async () => {
    const member = await createWorkspaceMember();
    const { project: a } = await createProjectFixture({
      workspaceId: member.workspace.id,
      slug: "a",
    });
    const { project: b } = await createProjectFixture({
      workspaceId: member.workspace.id,
      slug: "b",
    });
    await configure(a.id, member.workspace.id, ["src/domain/**"]);
    mockAuthenticatedSession(member.user);

    const files = ["src/domain/a.ts"];
    expect((await append(a.id, { refs: { files } })).coreChanged).toEqual(
      files,
    );
    expect((await append(b.id, { refs: { files } })).coreChanged).toEqual([]);
  });

  it("caps refs arrays: files 200x300, commits 100x64, prs 50x200", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const post = (refs: unknown) =>
      app.request("/api/agent-entry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: appendBody(project.id, { refs }),
      });
    const many = (n: number, s: string) => Array.from({ length: n }, () => s);

    const rejected: Array<[string, unknown]> = [
      ["201 files", { files: many(201, "a.ts") }],
      ["301-char file", { files: ["a".repeat(301)] }],
      ["101 commits", { commits: many(101, "abc") }],
      ["65-char commit", { commits: ["a".repeat(65)] }],
      ["51 prs", { prs: many(51, "#1") }],
      ["201-char pr", { prs: ["a".repeat(201)] }],
    ];
    for (const [label, refs] of rejected) {
      expect((await post(refs)).status, label).toBe(400);
    }
    expect(await db.select().from(agentEntryTable)).toHaveLength(0);

    const ok = await post({
      files: many(200, "a".repeat(300)),
      commits: many(100, "a".repeat(64)),
      prs: many(50, "a".repeat(200)),
    });
    expect(ok.status).toBe(200);
  });

  it("lifts repo and branch onto every summary row", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);

    const withBoth = await append(project.id, {
      refs: { repo: "doominkim/kaneo", branch: "agent-layer" },
    });
    const branchOnly = await append(project.id, {
      refs: { branch: "fix/x", commits: ["abc"] },
    });
    const emptyStrings = await append(project.id, {
      refs: { repo: "", branch: "" },
    });
    const none = await append(project.id, {});

    expect(withBoth).toMatchObject({
      repo: "doominkim/kaneo",
      branch: "agent-layer",
    });
    expect(branchOnly).toMatchObject({ repo: null, branch: "fix/x" });
    expect(emptyStrings).toMatchObject({ repo: null, branch: null });
    expect(none).toMatchObject({ repo: null, branch: null });

    const list = (await (
      await createApp().app.request(`/api/agent-entry/${project.id}`)
    ).json()) as EntryList;
    expect(list.entries.map((e) => [e.id, e.repo, e.branch])).toEqual([
      [none.id, null, null],
      [emptyStrings.id, null, null],
      [branchOnly.id, null, "fix/x"],
      [withBoth.id, "doominkim/kaneo", "agent-layer"],
    ]);
    // Still a summary: the expensive fields stay out.
    expect(list.entries[0]).not.toHaveProperty("body");
    expect(list.entries[0]).not.toHaveProperty("refs");
  });
});

describe("API integration: agent entry soft delete", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  type DeleteResult = { id: string; deletedAt: string | null };

  /** A second person in an existing workspace, so "someone else's entry" exists. */
  async function addMember(workspaceId: string, role: string, name: string) {
    const userId = `user-${randomUUID()}`;
    const [user] = await db
      .insert(schema.userTable)
      .values({
        id: userId,
        email: `${userId}@example.com`,
        emailVerified: true,
        name,
      })
      .returning();
    await db.insert(schema.workspaceUserTable).values({
      workspaceId,
      userId: user.id,
      role,
      joinedAt: new Date(),
    });
    return user;
  }

  async function seedEntry(
    workspaceId: string,
    projectId: string,
    overrides: Partial<typeof agentEntryTable.$inferInsert> = {},
  ) {
    const [entry] = await db
      .insert(agentEntryTable)
      .values({
        workspaceId,
        projectId,
        summary: "seeded",
        ...overrides,
      })
      .returning();
    return entry;
  }

  async function seedActor(workspaceId: string, onBehalfOf: string) {
    const [actor] = await db
      .insert(agentActorTable)
      .values({
        workspaceId,
        onBehalfOf,
        provider: "anthropic",
        model: "claude-opus-5",
      })
      .returning();
    return actor;
  }

  function del(
    app: ReturnType<typeof createApp>["app"],
    projectId: string,
    entryId: string,
  ) {
    return app.request(`/api/agent-entry/${projectId}/${entryId}`, {
      method: "DELETE",
    });
  }

  function restore(
    app: ReturnType<typeof createApp>["app"],
    projectId: string,
    entryId: string,
  ) {
    return app.request(`/api/agent-entry/${projectId}/${entryId}/restore`, {
      method: "POST",
    });
  }

  /** Routes the MCP tools' outbound HTTP back into the app under test. */
  function routeFetchInto(app: ReturnType<typeof createApp>["app"]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        return app.request(`${url.pathname}${url.search}`, init);
      }),
    );
  }

  it("lets the human author hide their own entry without project:update, and keeps every other column", async () => {
    // A viewer has task:read only, so nothing but authorship can grant this.
    const viewer = await createWorkspaceMember({ role: "viewer" });
    const { project } = await createProjectFixture({
      workspaceId: viewer.workspace.id,
    });
    const entry = await seedEntry(viewer.workspace.id, project.id, {
      createdBy: viewer.user.id,
      kind: "decision",
      summary: "mine",
      body: "long form",
      decision: { what: "x", why: "y" },
      refs: { branch: "feat/x" },
    });

    mockAuthenticatedSession(viewer.user);
    const { app } = createApp();

    const before = Date.now();
    const response = await del(app, project.id, entry.id);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as DeleteResult;
    expect(payload.id).toBe(entry.id);
    expect(payload.deletedAt).not.toBeNull();
    const deletedAt = new Date(payload.deletedAt as string).getTime();
    expect(deletedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(deletedAt).toBeLessThanOrEqual(Date.now() + 1000);

    const [persisted] = await db
      .select()
      .from(agentEntryTable)
      .where(eq(agentEntryTable.id, entry.id));
    expect(persisted).toMatchObject({
      deletedBy: viewer.user.id,
      kind: "decision",
      summary: "mine",
      body: "long form",
      createdBy: viewer.user.id,
    });
    expect(persisted?.deletedAt?.toISOString()).toBe(payload.deletedAt);
    expect(persisted?.decision).toEqual({ what: "x", why: "y" });
    expect(persisted?.refs).toEqual({ branch: "feat/x" });

    // Deleting twice is "not found", not a second stamp.
    const again = await del(app, project.id, entry.id);
    expect(again.status).toBe(404);
    const [unchanged] = await db
      .select({ deletedAt: agentEntryTable.deletedAt })
      .from(agentEntryTable)
      .where(eq(agentEntryTable.id, entry.id));
    expect(unchanged?.deletedAt?.toISOString()).toBe(payload.deletedAt);
  });

  it("refuses someone else's entry, and any agent entry, without project:update", async () => {
    const author = await createWorkspaceMember({ userName: "Author" });
    const viewer = await addMember(author.workspace.id, "viewer", "Viewer");
    const { project } = await createProjectFixture({
      workspaceId: author.workspace.id,
    });
    const actor = await seedActor(author.workspace.id, viewer.id);
    const theirs = await seedEntry(author.workspace.id, project.id, {
      createdBy: author.user.id,
    });
    // Run on the viewer's own behalf, yet still an agent entry: no human author.
    const agentEntry = await seedEntry(author.workspace.id, project.id, {
      actorId: actor.id,
    });

    mockAuthenticatedSession(viewer);
    const { app } = createApp();

    for (const target of [theirs, agentEntry]) {
      const response = await del(app, project.id, target.id);
      expect(response.status).toBe(403);
      await expect(response.text()).resolves.toBe(
        "Only the entry's author or a project:update holder can delete it",
      );
    }

    const rows = await db
      .select({ deletedAt: agentEntryTable.deletedAt })
      .from(agentEntryTable)
      .where(eq(agentEntryTable.projectId, project.id));
    expect(rows.map((r) => r.deletedAt)).toEqual([null, null]);
  });

  it("lets project:update hide anyone's entry, human or agent", async () => {
    const author = await createWorkspaceMember({ userName: "Author" });
    // Built-in `member` has no project:update; `admin` is the first role that does.
    const maintainer = await addMember(author.workspace.id, "admin", "Admin");
    const { project } = await createProjectFixture({
      workspaceId: author.workspace.id,
    });
    const actor = await seedActor(author.workspace.id, author.user.id);
    const human = await seedEntry(author.workspace.id, project.id, {
      createdBy: author.user.id,
    });
    const agent = await seedEntry(author.workspace.id, project.id, {
      actorId: actor.id,
    });

    mockAuthenticatedSession(maintainer);
    const { app } = createApp();

    for (const target of [human, agent]) {
      const response = await del(app, project.id, target.id);
      expect(response.status).toBe(200);
      const [persisted] = await db
        .select({ deletedBy: agentEntryTable.deletedBy })
        .from(agentEntryTable)
        .where(eq(agentEntryTable.id, target.id));
      expect(persisted?.deletedBy).toBe(maintainer.id);
    }
  });

  it("reports an entry from another project, or an unknown id, as not found", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const other = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const foreign = await seedEntry(member.workspace.id, other.project.id, {
      createdBy: member.user.id,
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    expect((await del(app, project.id, foreign.id)).status).toBe(404);
    expect((await del(app, project.id, "entry-missing")).status).toBe(404);
    expect((await restore(app, project.id, foreign.id)).status).toBe(404);

    const [persisted] = await db
      .select({ deletedAt: agentEntryTable.deletedAt })
      .from(agentEntryTable)
      .where(eq(agentEntryTable.id, foreign.id));
    expect(persisted?.deletedAt).toBeNull();
  });

  it("hides a deleted entry from the listing, the handoff pick, the single fetch, the MCP reads and the tree", async () => {
    const member = await createWorkspaceMember({
      userName: "Dominic",
      role: "admin",
    });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id, 1);
    const actor = await seedActor(member.workspace.id, member.user.id);
    const base = Date.now() - 10 * 60_000;
    const kept = await seedEntry(member.workspace.id, project.id, {
      taskId: task.id,
      actorId: actor.id,
      kind: "handoff",
      summary: "older handoff",
      refs: { branch: "feat/kept" },
      usage: { totalTokens: 10 },
      createdAt: new Date(base),
    });
    const hidden = await seedEntry(member.workspace.id, project.id, {
      taskId: task.id,
      actorId: actor.id,
      kind: "handoff",
      summary: "newest handoff, deleted",
      body: "should not be readable",
      refs: { branch: "feat/hidden" },
      usage: { totalTokens: 1000 },
      createdAt: new Date(base + 60_000),
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    routeFetchInto(app);

    expect((await del(app, project.id, hidden.id)).status).toBe(200);

    const list = (await (
      await app.request(`/api/agent-entry/${project.id}`)
    ).json()) as EntryList;
    expect(list.entries.map((e) => e.id)).toEqual([kept.id]);
    expect(list.entries[0]?.deletedAt).toBeNull();

    // The overview callout picks the newest handoff: the hidden one must not win.
    const handoffs = (await (
      await app.request(`/api/agent-entry/${project.id}?kind=handoff&limit=1`)
    ).json()) as EntryList;
    expect(handoffs.entries.map((e) => e.id)).toEqual([kept.id]);

    const byTask = (await (
      await app.request(`/api/agent-entry/${project.id}?taskId=${task.id}`)
    ).json()) as EntryList;
    expect(byTask.entries.map((e) => e.id)).toEqual([kept.id]);

    const single = await app.request(
      `/api/agent-entry/${project.id}/${hidden.id}`,
    );
    expect(single.status).toBe(404);

    const tail = toolJson<EntryList>(
      await mcpToolCall(app, "agent_log_tail", { projectId: project.id }),
    );
    expect(tail.entries.map((e) => e.id)).toEqual([kept.id]);

    const brief = toolJson<{ recentEntries: EntrySummary[] }>(
      await mcpToolCall(app, "agent_brief", { projectId: project.id }),
    );
    expect(brief.recentEntries.map((e) => e.id)).toEqual([kept.id]);

    const viaGet = await mcpToolCall(app, "agent_entry_get", {
      projectId: project.id,
      entryId: hidden.id,
    });
    expect(viaGet.isError).toBe(true);
    expect(viaGet.content[0]?.text).not.toContain("should not be readable");

    type TreeNode = {
      id: string;
      branches: Array<{ branch: string }>;
      usage: { entryCount: number; totalTokens: number };
    };
    const tree = (await (
      await app.request(`/api/agent-project/${project.id}/tree`)
    ).json()) as { nodes: TreeNode[] };
    const node = tree.nodes.find((n) => n.id === task.id);
    expect(node?.branches).toEqual([{ branch: "feat/kept" }]);
    expect(node?.usage).toMatchObject({ entryCount: 1, totalTokens: 10 });
  });

  it("keeps a deleted entry usable as a paging cursor", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const base = Date.now() - 10 * 60_000;
    const oldest = await seedEntry(member.workspace.id, project.id, {
      summary: "oldest",
      createdAt: new Date(base),
    });
    const middle = await seedEntry(member.workspace.id, project.id, {
      summary: "middle",
      createdBy: member.user.id,
      createdAt: new Date(base + 60_000),
    });
    await seedEntry(member.workspace.id, project.id, {
      summary: "newest",
      createdAt: new Date(base + 120_000),
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const page = (await (
      await app.request(`/api/agent-entry/${project.id}?limit=2`)
    ).json()) as EntryList;
    expect(page.nextBefore).toBe(middle.id);

    expect((await del(app, project.id, middle.id)).status).toBe(200);

    const next = (await (
      await app.request(
        `/api/agent-entry/${project.id}?limit=2&before=${middle.id}`,
      )
    ).json()) as EntryList;
    expect(next.entries.map((e) => e.id)).toEqual([oldest.id]);
  });

  it("shows deleted entries to project:update with includeDeleted=true, and refuses the flag to others", async () => {
    const member = await createWorkspaceMember({
      userName: "Admin",
      role: "admin",
    });
    // A plain member authors entries but has no project:update either.
    const viewer = await addMember(member.workspace.id, "member", "Member");
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const live = await seedEntry(member.workspace.id, project.id, {
      summary: "live",
      createdAt: new Date(Date.now() - 120_000),
    });
    const gone = await seedEntry(member.workspace.id, project.id, {
      summary: "gone",
      body: "hidden body",
      createdBy: member.user.id,
      createdAt: new Date(Date.now() - 60_000),
    });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    expect((await del(app, project.id, gone.id)).status).toBe(200);

    const list = (await (
      await app.request(`/api/agent-entry/${project.id}?includeDeleted=true`)
    ).json()) as EntryList;
    expect(list.entries.map((e) => [e.id, e.deletedAt !== null])).toEqual([
      [gone.id, true],
      [live.id, false],
    ]);

    const detailResponse = await app.request(
      `/api/agent-entry/${project.id}/${gone.id}?includeDeleted=true`,
    );
    expect(detailResponse.status).toBe(200);
    const detail = (await detailResponse.json()) as EntryDetail & {
      deletedAt: string | null;
      deletedBy: string | null;
    };
    expect(detail).toMatchObject({
      id: gone.id,
      body: "hidden body",
      deletedBy: member.user.id,
    });
    expect(detail.deletedAt).not.toBeNull();

    // `false` is the default and needs no permission.
    const explicitFalse = await app.request(
      `/api/agent-entry/${project.id}?includeDeleted=false`,
    );
    expect(explicitFalse.status).toBe(200);
    expect(
      ((await explicitFalse.json()) as EntryList).entries.map((e) => e.id),
    ).toEqual([live.id]);

    mockAuthenticatedSession(viewer);
    const viewerApp = createApp().app;

    for (const path of [
      `/api/agent-entry/${project.id}?includeDeleted=true`,
      `/api/agent-entry/${project.id}/${gone.id}?includeDeleted=true`,
    ]) {
      const response = await viewerApp.request(path);
      expect(response.status, path).toBe(403);
      await expect(response.text()).resolves.toBe(
        "includeDeleted requires project:update",
      );
    }
    // The gate is on the flag, not the row: the viewer still gets the default view.
    const viewerList = (await (
      await viewerApp.request(`/api/agent-entry/${project.id}`)
    ).json()) as EntryList;
    expect(viewerList.entries.map((e) => e.id)).toEqual([live.id]);
    expect(
      (await viewerApp.request(`/api/agent-entry/${project.id}/${gone.id}`))
        .status,
    ).toBe(404);
  });

  it("restores with project:update only, and only a deleted entry", async () => {
    const author = await createWorkspaceMember({
      userName: "Admin",
      role: "admin",
    });
    const viewer = await addMember(author.workspace.id, "member", "Member");
    const { project } = await createProjectFixture({
      workspaceId: author.workspace.id,
    });
    const entry = await seedEntry(author.workspace.id, project.id, {
      createdBy: viewer.id,
      summary: "viewer's note",
    });

    // The author could hide it, but cannot bring it back on their own.
    mockAuthenticatedSession(viewer);
    const viewerApp = createApp().app;
    expect((await del(viewerApp, project.id, entry.id)).status).toBe(200);
    const refused = await restore(viewerApp, project.id, entry.id);
    expect(refused.status).toBe(403);
    await expect(refused.text()).resolves.toBe("Insufficient permissions");

    mockAuthenticatedSession(author.user);
    const { app } = createApp();
    const restored = await restore(app, project.id, entry.id);
    expect(restored.status).toBe(200);
    expect((await restored.json()) as DeleteResult).toEqual({
      id: entry.id,
      deletedAt: null,
    });

    const [persisted] = await db
      .select({
        deletedAt: agentEntryTable.deletedAt,
        deletedBy: agentEntryTable.deletedBy,
        summary: agentEntryTable.summary,
      })
      .from(agentEntryTable)
      .where(eq(agentEntryTable.id, entry.id));
    expect(persisted).toEqual({
      deletedAt: null,
      deletedBy: null,
      summary: "viewer's note",
    });

    const list = (await (
      await app.request(`/api/agent-entry/${project.id}`)
    ).json()) as EntryList;
    expect(list.entries.map((e) => e.id)).toEqual([entry.id]);
    expect(
      (await app.request(`/api/agent-entry/${project.id}/${entry.id}`)).status,
    ).toBe(200);

    // Not deleted any more: a second restore is "not found".
    expect((await restore(app, project.id, entry.id)).status).toBe(404);
  });

  it("rejects delete and restore from outside the workspace and when unauthenticated", async () => {
    const member = await createWorkspaceMember();
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const entry = await seedEntry(member.workspace.id, project.id, {
      createdBy: member.user.id,
    });

    mockAnonymousSession();
    const anonymous = createApp().app;
    expect((await del(anonymous, project.id, entry.id)).status).toBe(401);
    expect((await restore(anonymous, project.id, entry.id)).status).toBe(401);

    const outsider = await createWorkspaceMember();
    mockAuthenticatedSession(outsider.user);
    const app = createApp().app;
    expect((await del(app, project.id, entry.id)).status).toBe(403);
    expect((await restore(app, project.id, entry.id)).status).toBe(403);

    const [persisted] = await db
      .select({ deletedAt: agentEntryTable.deletedAt })
      .from(agentEntryTable)
      .where(eq(agentEntryTable.id, entry.id));
    expect(persisted?.deletedAt).toBeNull();
  });
});
