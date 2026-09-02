import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  agentActorTable,
  agentEntryTable,
} from "../../apps/api/src/database/schema-agent-layer";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

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
        refs: { commits: ["abc123"], files: ["apps/api/src/agent-entry"] },
        coreChanged: ["apps/api/src/agent-entry/index.ts"],
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
      coreChanged: ["apps/api/src/agent-entry/index.ts"],
    });
    expect(payload.actor).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-5",
      onBehalfOf: member.user.id,
    });

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

  it("keeps the ledger append-only: no update or delete surface is mounted", async () => {
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
    const deleted = await app.request(
      `/api/agent-entry/${project.id}/${entry.id}`,
      { method: "DELETE" },
    );

    expect(updated.status).toBe(404);
    expect(deleted.status).toBe(404);

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
