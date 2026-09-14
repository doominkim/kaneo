import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The timeline entry of a requirement/design change is written in the same
 * transaction as the change (agent-autoapply). The real appendEntry runs and
 * inserts its row, then this wrapper throws: if the entry were written after
 * the change committed, the change would survive; if it were written before
 * the change in its own statement, the entry would survive. Only a shared
 * transaction leaves neither.
 */
const timeline = vi.hoisted(() => ({ fail: false }));
vi.mock(
  "../../apps/api/src/agent-entry/controllers/append-entry",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../apps/api/src/agent-entry/controllers/append-entry")
      >();
    return {
      ...actual,
      default: async (
        ...args: Parameters<typeof actual.default>
      ): ReturnType<typeof actual.default> => {
        const entry = await actual.default(...args);
        if (timeline.fail) throw new Error("timeline write failed");
        return entry;
      },
    };
  },
);

import db, { schema } from "../../apps/api/src/database";
import {
  agentEntryTable,
  agentRequirementSetTable,
  agentSpecRevisionTable,
  agentTaskRequirementTable,
} from "../../apps/api/src/database/schema-agent-layer";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type App = ReturnType<typeof createApp>["app"];

const json = (body: unknown, method = "PUT") => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function setup() {
  const admin = await createWorkspaceMember({ role: "admin" });
  const { project, columns } = await createProjectFixture({
    workspaceId: admin.workspace.id,
  });
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      title: "Task 1",
      description: "",
      priority: "medium",
      status: "to-do",
      columnId: columns.todo.id,
      number: 1,
      position: 1,
    })
    .returning();
  if (!task) throw new Error("Failed to seed task");
  mockAuthenticatedSession(admin.user);
  const { app } = createApp();
  return { app, project, task };
}

async function entryCount(projectId: string) {
  return (
    await db
      .select({ id: agentEntryTable.id })
      .from(agentEntryTable)
      .where(eq(agentEntryTable.projectId, projectId))
  ).length;
}

async function itemText(app: App, projectId: string) {
  const res = await app.request(`/api/agent-requirement/${projectId}/alpha`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: Array<{ text: string }> }).items[0]
    ?.text;
}

describe("agent-autoapply: timeline entries commit with their change", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    timeline.fail = false;
  });
  afterEach(() => {
    timeline.fail = false;
    vi.restoreAllMocks();
  });

  it("[REQ-AGENT-AUTOAPPLY-15] a failed timeline write rolls back a requirement save, a revert, deletes, restores and a task acknowledgement", async () => {
    const { app, project, task } = await setup();
    const setPath = `/api/agent-requirement/${project.id}/alpha`;
    const designPath = `/api/agent-design/${project.id}/alpha`;
    const linkPath = `/api/agent-task-link/${project.id}/${task.id}`;

    expect(
      (
        await app.request(
          setPath,
          json({ title: "Alpha", items: [{ text: "a" }] }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(
          designPath,
          json({ title: "D", body: "d", requirementKeys: ["REQ-ALPHA-1"] }),
        )
      ).status,
    ).toBe(200);
    expect(
      (await app.request(linkPath, json({ requirementKeys: ["REQ-ALPHA-1"] })))
        .status,
    ).toBe(200);
    const revisionCount = async () =>
      (
        await db
          .select({ id: agentSpecRevisionTable.id })
          .from(agentSpecRevisionTable)
          .where(eq(agentSpecRevisionTable.projectId, project.id))
      ).length;

    // Save: an item edit writes an entry, a revision and the new text.
    let entries = await entryCount(project.id);
    let revisions = await revisionCount();
    timeline.fail = true;
    const save = await app.request(
      setPath,
      json({ title: "Alpha", items: [{ key: "REQ-ALPHA-1", text: "b" }] }),
    );
    expect(save.status).toBe(500);
    timeline.fail = false;
    expect(await itemText(app, project.id)).toBe("a");
    expect(await entryCount(project.id)).toBe(entries);
    expect(await revisionCount()).toBe(revisions);

    // Revert: goes through the same save.
    const [original] = await db
      .select({ id: agentSpecRevisionTable.id })
      .from(agentSpecRevisionTable)
      .innerJoin(
        agentRequirementSetTable,
        eq(agentRequirementSetTable.id, agentSpecRevisionTable.setId),
      )
      .where(eq(agentRequirementSetTable.projectId, project.id));
    expect(
      (
        await app.request(
          setPath,
          json({ title: "Alpha", items: [{ key: "REQ-ALPHA-1", text: "b" }] }),
        )
      ).status,
    ).toBe(200);
    entries = await entryCount(project.id);
    revisions = await revisionCount();
    timeline.fail = true;
    const revert = await app.request(
      `${setPath}/revisions/${original?.id}/revert`,
      { method: "POST" },
    );
    expect(revert.status).toBe(500);
    timeline.fail = false;
    expect(await itemText(app, project.id)).toBe("b");
    expect(await entryCount(project.id)).toBe(entries);
    expect(await revisionCount()).toBe(revisions);

    // Acknowledge: the link clock does not move.
    timeline.fail = true;
    expect(
      (await app.request(`${linkPath}/acknowledge`, { method: "POST" })).status,
    ).toBe(500);
    timeline.fail = false;
    const [link] = await db
      .select()
      .from(agentTaskRequirementTable)
      .where(eq(agentTaskRequirementTable.taskId, task.id));
    expect(link).toMatchObject({ acknowledgedAt: null, reviewedAt: null });
    expect(await entryCount(project.id)).toBe(entries);

    // Delete: both documents stay readable.
    for (const path of [setPath, designPath]) {
      timeline.fail = true;
      expect((await app.request(path, { method: "DELETE" })).status, path).toBe(
        500,
      );
      timeline.fail = false;
      expect((await app.request(path)).status, path).toBe(200);
    }
    expect(await entryCount(project.id)).toBe(entries);

    // Restore: both documents stay deleted.
    for (const path of [setPath, designPath]) {
      expect((await app.request(path, { method: "DELETE" })).status, path).toBe(
        200,
      );
    }
    entries = await entryCount(project.id);
    for (const path of [setPath, designPath]) {
      timeline.fail = true;
      expect(
        (await app.request(`${path}/restore`, { method: "POST" })).status,
        path,
      ).toBe(500);
      timeline.fail = false;
      expect((await app.request(path)).status, path).toBe(404);
    }
    expect(await entryCount(project.id)).toBe(entries);

    // With the timeline working again, the same restore succeeds.
    expect(
      (await app.request(`${setPath}/restore`, { method: "POST" })).status,
    ).toBe(200);
    expect(await entryCount(project.id)).toBe(entries + 1);
  });
});
