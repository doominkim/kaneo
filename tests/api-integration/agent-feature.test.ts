import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { agentRequirementItemTable } from "../../apps/api/src/database/schema-agent-layer";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

type App = ReturnType<typeof createApp>["app"];
type FeatureSummary = {
  feature: string;
  title: string;
  requirements: {
    status: string;
    itemCount: number;
    activeCount: number;
    coveredCount: number;
  } | null;
  design: { status: string; stale: boolean } | null;
  tasks: { total: number; done: number; stale: number };
};
type FeatureTask = {
  id: string;
  number: number | null;
  status: string | null;
  requirementKeys: string[];
  viaDesign: boolean;
  stale: { stale: boolean; causes: Array<{ kind: string; key: string }> };
};

const json = (body: unknown, method = "PUT") => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function seedTask(
  projectId: string,
  columnId: string,
  number: number,
  status = "to-do",
) {
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId,
      title: `Task ${number}`,
      description: "",
      priority: "medium",
      status,
      columnId,
      number,
      position: number,
    })
    .returning();
  return task;
}

async function setup() {
  const member = await createWorkspaceMember();
  const { project, columns } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  mockAuthenticatedSession(member.user);
  const { app } = createApp();
  return { member, project, columns, app };
}

async function features(app: App, projectId: string) {
  const res = await app.request(`/api/agent-feature/${projectId}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { features: FeatureSummary[] }).features;
}

describe("API integration: feature summaries", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("[REQ-FEATURE-HUB-2] [REQ-FEATURE-HUB-18] [REQ-FEATURE-HUB-19] [REQ-FEATURE-HUB-9] one call lists every feature with requirement, design, task and coverage state", async () => {
    const { app, project, columns } = await setup();
    // Feature A: set + design + two tasks (one done); feature B: design only.
    await app.request(
      `/api/agent-requirement/${project.id}/alpha`,
      json({
        title: "Alpha",
        items: [
          { text: "a1" },
          { text: "a2" },
          { text: "a3", status: "dropped" },
        ],
      }),
    );
    await app.request(`/api/agent-requirement/${project.id}/alpha/approve`, {
      method: "POST",
    });
    await app.request(
      `/api/agent-design/${project.id}/alpha`,
      json({
        title: "Alpha design",
        body: "d",
        requirementKeys: ["REQ-ALPHA-1", "REQ-ALPHA-2"],
      }),
    );
    await app.request(`/api/agent-design/${project.id}/alpha/approve`, {
      method: "POST",
    });
    await app.request(
      `/api/agent-design/${project.id}/beta`,
      json({ title: "Beta design", body: "d" }),
    );
    await app.request(
      `/api/agent-requirement/${project.id}/alpha/coverage`,
      json({
        repo: "r",
        entries: [{ key: "REQ-ALPHA-1", testPath: "a.test.ts" }],
      }),
    );

    const todo = await seedTask(project.id, columns.todo.id, 1);
    const done = await seedTask(project.id, columns.done.id, 2, "done");
    const unlinked = await seedTask(project.id, columns.todo.id, 3);
    await app.request(
      `/api/agent-task-link/${project.id}/${todo.id}`,
      json({ requirementKeys: ["REQ-ALPHA-1"], designFeatures: ["alpha"] }),
    );
    await app.request(
      `/api/agent-task-link/${project.id}/${done.id}`,
      json({ designFeatures: ["alpha"] }),
    );

    // Empty project shape first: no features at all is an empty list, not an error.
    const other = await createProjectFixture({
      workspaceId: project.workspaceId,
    });
    expect(await features(app, other.project.id)).toEqual([]);

    let list = await features(app, project.id);
    expect(list.map((f) => f.feature).sort()).toEqual(["alpha", "beta"]);
    const alpha = list.find((f) => f.feature === "alpha");
    expect(alpha).toMatchObject({
      title: "Alpha",
      requirements: {
        status: "approved",
        itemCount: 3,
        activeCount: 2,
        coveredCount: 1,
      },
      design: { status: "approved", stale: false },
      tasks: { total: 2, done: 1, stale: 0 },
    });
    const beta = list.find((f) => f.feature === "beta");
    expect(beta).toMatchObject({
      title: "Beta design",
      requirements: null,
      design: { status: "draft", stale: false },
      tasks: { total: 0, done: 0, stale: 0 },
    });
    expect(unlinked.id).toBeTruthy();

    // A requirement edit after approval shows up as a stale design and a stale task.
    await new Promise((r) => setTimeout(r, 5));
    await db
      .update(agentRequirementItemTable)
      .set({ updatedAt: new Date() })
      .where(eq(agentRequirementItemTable.key, "REQ-ALPHA-1"));
    list = await features(app, project.id);
    expect(list.find((f) => f.feature === "alpha")).toMatchObject({
      design: { stale: true },
      tasks: { total: 2, done: 1, stale: 1 },
    });
  });

  it("[REQ-FEATURE-HUB-6] the feature task list holds only tasks derived from that feature, with their stale causes", async () => {
    const { app, project, columns } = await setup();
    await app.request(
      `/api/agent-requirement/${project.id}/alpha`,
      json({ title: "Alpha", items: [{ text: "a1" }] }),
    );
    await app.request(
      `/api/agent-design/${project.id}/alpha`,
      json({
        title: "Alpha design",
        body: "d",
        requirementKeys: ["REQ-ALPHA-1"],
      }),
    );
    await app.request(
      `/api/agent-requirement/${project.id}/beta`,
      json({ title: "Beta", items: [{ text: "b1" }] }),
    );
    const t1 = await seedTask(project.id, columns.todo.id, 1);
    const t2 = await seedTask(project.id, columns.todo.id, 2);
    const t3 = await seedTask(project.id, columns.todo.id, 3);
    await app.request(
      `/api/agent-task-link/${project.id}/${t1.id}`,
      json({ requirementKeys: ["REQ-ALPHA-1"] }),
    );
    await app.request(
      `/api/agent-task-link/${project.id}/${t2.id}`,
      json({ designFeatures: ["alpha"], requirementKeys: ["REQ-BETA-1"] }),
    );
    await app.request(
      `/api/agent-task-link/${project.id}/${t3.id}`,
      json({ requirementKeys: ["REQ-BETA-1"] }),
    );

    const res = await app.request(
      `/api/agent-feature/${project.id}/alpha/tasks`,
    );
    expect(res.status).toBe(200);
    const { tasks } = (await res.json()) as { tasks: FeatureTask[] };
    expect(
      tasks.map((t) => [t.number, t.requirementKeys, t.viaDesign]),
    ).toEqual([
      [1, ["REQ-ALPHA-1"], false],
      [2, [], true],
    ]);

    await new Promise((r) => setTimeout(r, 5));
    await db
      .update(agentRequirementItemTable)
      .set({ updatedAt: new Date() })
      .where(eq(agentRequirementItemTable.key, "REQ-ALPHA-1"));
    const after = (await (
      await app.request(`/api/agent-feature/${project.id}/alpha/tasks`)
    ).json()) as { tasks: FeatureTask[] };
    expect(after.tasks[0]?.stale.causes).toEqual([
      expect.objectContaining({ kind: "requirement", key: "REQ-ALPHA-1" }),
    ]);
    expect(after.tasks[1]?.stale.stale).toBe(false);
  });
});
