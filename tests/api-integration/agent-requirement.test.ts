import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiKeyMock = vi.hoisted(() => ({
  verifyApiKey: vi.fn(async () => null as unknown),
}));
vi.mock("../../apps/api/src/utils/verify-api-key", () => apiKeyMock);

import db, { schema } from "../../apps/api/src/database";
import {
  agentEntryTable,
  agentRequirementItemTable,
} from "../../apps/api/src/database/schema-agent-layer";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import { mcpToolCall, toolJson } from "./helpers/mcp";

type App = ReturnType<typeof createApp>["app"];
type Item = {
  id: string;
  key: string;
  seq: number;
  text: string;
  status: string;
  updatedAt: string;
  coverage: Array<{ repo: string; testPath: string }>;
  designs: Array<{ feature: string }>;
  tasks: Array<{ id: string }>;
};
type SetDetail = {
  id: string;
  feature: string;
  status: string;
  approvedAt: string | null;
  nextSeq: number;
  updatedBy: string | null;
  actorId: string | null;
  items: Item[];
};
type Design = {
  id: string;
  status: string;
  approvedAt: string | null;
  stale: { stale: boolean; causes: Array<{ kind: string; key: string }> };
  requirements: Array<{ key: string; changedSinceApproval: boolean }>;
  tasks: Array<{ id: string }>;
};
type TaskLinks = {
  requirements: Array<{ key: string; acknowledgedAt: string | null }>;
  designs: Array<{ feature: string }>;
  stale: { stale: boolean; causes: Array<{ kind: string; key: string }> };
};

const identity = { provider: "anthropic", model: "claude-opus-5" };
const json = (body: unknown, method = "PUT") => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

async function seedTask(projectId: string, columnId: string, number: number) {
  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId,
      title: `Task ${number}`,
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

async function setup() {
  const member = await createWorkspaceMember();
  const { project, columns } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  mockAuthenticatedSession(member.user);
  const { app } = createApp();
  return { member, project, columns, app };
}

function putSet(app: App, projectId: string, feature: string, body: unknown) {
  return app.request(
    `/api/agent-requirement/${projectId}/${feature}`,
    json(body),
  );
}
async function getSet(app: App, projectId: string, feature: string) {
  const res = await app.request(
    `/api/agent-requirement/${projectId}/${feature}`,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as SetDetail;
}
async function getDesign(app: App, projectId: string, feature: string) {
  const res = await app.request(`/api/agent-design/${projectId}/${feature}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Design;
}
async function getLinks(app: App, projectId: string, taskId: string) {
  const res = await app.request(`/api/agent-task-link/${projectId}/${taskId}`);
  expect(res.status).toBe(200);
  return (await res.json()) as TaskLinks;
}
/** Move an item's clock to "now", strictly after whatever was created before the call. */
async function bumpItem(key: string) {
  await new Promise((r) => setTimeout(r, 5));
  await db
    .update(agentRequirementItemTable)
    .set({ updatedAt: new Date() })
    .where(eq(agentRequirementItemTable.key, key));
  await new Promise((r) => setTimeout(r, 5));
}
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
async function entriesFor(projectId: string) {
  return db
    .select()
    .from(agentEntryTable)
    .where(eq(agentEntryTable.projectId, projectId));
}

describe("API integration: requirement sets, designs, task links", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    apiKeyMock.verifyApiKey.mockResolvedValue(null);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("[REQ-SPEC-TABS-2] [REQ-SPEC-TABS-3] stores a set with issued keys, and a re-PUT upserts items without deleting", async () => {
    const { app, project, member } = await setup();
    const created = await putSet(app, project.id, "spec-tabs", {
      title: "Spec tabs",
      body: "# scope",
      items: [{ text: "first", layer: "api" }, { text: "second" }],
    });
    expect(created.status).toBe(200);
    const set = (await created.json()) as SetDetail;
    expect(set.status).toBe("draft");
    expect(set.updatedBy).toBe(member.user.id);
    expect(set.actorId).toBeNull();
    expect(set.items.map((i) => i.key)).toEqual([
      "REQ-SPEC-TABS-1",
      "REQ-SPEC-TABS-2",
    ]);
    expect(set.nextSeq).toBe(3);

    // Only item 2 is sent again; item 1 must survive, and a third is issued.
    const again = await putSet(app, project.id, "spec-tabs", {
      title: "Spec tabs",
      items: [
        { key: "REQ-SPEC-TABS-2", text: "second", status: "dropped" },
        { text: "third" },
      ],
    });
    expect(again.status).toBe(200);
    const after = (await again.json()) as SetDetail;
    expect(after.items.map((i) => [i.key, i.status])).toEqual([
      ["REQ-SPEC-TABS-1", "active"],
      ["REQ-SPEC-TABS-2", "dropped"],
      ["REQ-SPEC-TABS-3", "active"],
    ]);

    const list = await app.request(`/api/agent-requirement/${project.id}`);
    const { sets } = (await list.json()) as {
      sets: Array<{ feature: string; itemCount: number; activeCount: number }>;
    };
    expect(sets).toEqual([
      expect.objectContaining({
        feature: "spec-tabs",
        itemCount: 3,
        activeCount: 2,
      }),
    ]);
  });

  it("[REQ-FEATURE-HUB-23] [REQ-FEATURE-HUB-24] a body with criterion lines is the source of truth: rows are derived, keys are issued and written back", async () => {
    const { app, project } = await setup();
    const doc = [
      "# Feature 허브",
      "",
      "배경 문단.",
      "",
      "## 1. 목록",
      "",
      "1. 시스템은 탭을 6개 보여준다. `e2e`",
      "2. Feature 탭을 열면 시스템은 feature 를 한 줄씩 보여준다. `e2e`",
      "",
      "## 2. 승인",
      "",
      "1. 설계를 처음 승인하면 시스템은 태스크를 stale 로 만들지 않는다. `api`",
      "",
    ].join("\n");
    const created = await putSet(app, project.id, "feature-hub", {
      title: "Feature 허브",
      body: doc,
      // Rows sent alongside a document are ignored: the document wins.
      items: [{ text: "무시되는 행" }],
    });
    expect(created.status, await created.clone().text()).toBe(200);
    const set = (await created.json()) as SetDetail & {
      body: string;
      items: Array<Item & { story: string | null }>;
    };
    expect(set.items.map((i) => [i.key, i.story])).toEqual([
      ["REQ-FEATURE-HUB-1", "1. 목록"],
      ["REQ-FEATURE-HUB-2", "1. 목록"],
      ["REQ-FEATURE-HUB-3", "2. 승인"],
    ]);
    expect(set.items.some((i) => i.text === "무시되는 행")).toBe(false);
    expect(set.body).toContain("6개 보여준다. `e2e` REQ-FEATURE-HUB-1");
    expect(set.body).toContain(
      "stale 로 만들지 않는다. `api` REQ-FEATURE-HUB-3",
    );
    expect(set.nextSeq).toBe(4);

    // Saving the returned body again changes nothing: no new keys, no clock movement, no entry.
    const before = await entriesFor(project.id);
    const again = await putSet(app, project.id, "feature-hub", {
      title: "Feature 허브",
      body: set.body,
    });
    const same = (await again.json()) as SetDetail;
    expect(same.items.map((i) => i.updatedAt)).toEqual(
      set.items.map((i) => i.updatedAt),
    );
    expect(same.nextSeq).toBe(4);
    expect((await entriesFor(project.id)).length).toBe(before.length);

    // Editing one sentence moves only that clock and leaves one entry naming the key.
    const edited = await putSet(app, project.id, "feature-hub", {
      title: "Feature 허브",
      body: set.body.replace("한 줄씩 보여준다", "한 줄씩 나열한다"),
    });
    const after = (await edited.json()) as SetDetail;
    expect(after.items[1]?.text).toBe(
      "Feature 탭을 열면 시스템은 feature 를 한 줄씩 나열한다.",
    );
    expect(after.items[0]?.updatedAt).toBe(set.items[0]?.updatedAt);
    expect(after.items[1]?.updatedAt).not.toBe(set.items[1]?.updatedAt);
    const entries = await entriesFor(project.id);
    expect(entries.length).toBe(before.length + 1);
    expect(entries.at(-1)?.summary).toContain("REQ-FEATURE-HUB-2");
    expect(entries.at(-1)?.body).toContain("한 줄씩 보여준다");
  });

  it("[REQ-FEATURE-HUB-26] [REQ-FEATURE-HUB-22] a struck-through or missing line is dropped, and a line without a badge is rejected", async () => {
    const { app, project } = await setup();
    const doc =
      "## A\n\n1. 시스템은 x 한다. `api`\n2. 시스템은 y 한다. `api`\n3. 시스템은 z 한다. `unit`\n";
    const first = (await (
      await putSet(app, project.id, "feature-hub", { title: "T", body: doc })
    ).json()) as SetDetail & { body: string };

    // Strike line 1, delete line 3 from the document.
    const next = first.body
      .replace(
        "1. 시스템은 x 한다. `api` REQ-FEATURE-HUB-1",
        "1. ~~시스템은 x 한다. `api` REQ-FEATURE-HUB-1~~",
      )
      .replace("3. 시스템은 z 한다. `unit` REQ-FEATURE-HUB-3\n", "");
    const second = (await (
      await putSet(app, project.id, "feature-hub", { title: "T", body: next })
    ).json()) as SetDetail;
    expect(second.items.map((i) => [i.key, i.status])).toEqual([
      ["REQ-FEATURE-HUB-1", "dropped"],
      ["REQ-FEATURE-HUB-2", "active"],
      ["REQ-FEATURE-HUB-3", "dropped"],
    ]);

    // Un-striking brings it back; the key was never reused.
    const third = (await (
      await putSet(app, project.id, "feature-hub", {
        title: "T",
        body: next
          .replace(
            "1. ~~시스템은 x 한다. `api` REQ-FEATURE-HUB-1~~",
            "1. 시스템은 x 한다. `api` REQ-FEATURE-HUB-1",
          )
          .concat("4. 시스템은 w 한다. `e2e`\n"),
      })
    ).json()) as SetDetail;
    expect(third.items.map((i) => [i.key, i.status])).toEqual([
      ["REQ-FEATURE-HUB-1", "active"],
      ["REQ-FEATURE-HUB-2", "active"],
      ["REQ-FEATURE-HUB-3", "dropped"],
      ["REQ-FEATURE-HUB-4", "active"],
    ]);

    const noBadge = await putSet(app, project.id, "feature-hub", {
      title: "T",
      body: "## A\n\n1. 배지가 없다.\n",
    });
    expect(noBadge.status).toBe(400);
    expect(await noBadge.text()).toContain("verification badge");
    const badBadge = await putSet(app, project.id, "feature-hub", {
      title: "T",
      body: "## A\n\n1. 시스템은 x. `ui`\n",
    });
    expect(badBadge.status).toBe(400);
  });

  it("[REQ-SPEC-TABS-16] rejects keys of another feature, malformed keys and duplicates in a project", async () => {
    const { app, project } = await setup();
    const wrongFeature = await putSet(app, project.id, "spec-tabs", {
      title: "T",
      items: [{ key: "REQ-ADMIN-QA-1", text: "x" }],
    });
    expect(wrongFeature.status).toBe(400);

    const malformed = await putSet(app, project.id, "spec-tabs", {
      title: "T",
      items: [{ key: "SPEC-TABS-1", text: "x" }],
    });
    expect(malformed.status).toBe(400);

    const badFeature = await putSet(app, project.id, "Spec_Tabs", {
      title: "T",
      items: [],
    });
    expect(badFeature.status).toBe(400);

    // Explicit import of numbering keeps nextSeq ahead of it.
    const imported = await putSet(app, project.id, "spec-tabs", {
      title: "T",
      items: [{ key: "REQ-SPEC-TABS-7", text: "seven" }, { text: "next" }],
    });
    expect(imported.status).toBe(200);
    const set = (await imported.json()) as SetDetail;
    expect(set.items.map((i) => i.key)).toEqual([
      "REQ-SPEC-TABS-7",
      "REQ-SPEC-TABS-8",
    ]);

    const dup = await putSet(app, project.id, "spec-tabs", {
      title: "T",
      items: [
        { key: "REQ-SPEC-TABS-7", text: "seven" },
        { key: "REQ-SPEC-TABS-7", text: "again" },
      ],
    });
    expect(dup.status).toBe(400);
  });

  it("[REQ-SPEC-TABS-4] approval is human-only, records a decision entry, and an API key is refused", async () => {
    const { app, project, member } = await setup();
    await putSet(app, project.id, "spec-tabs", {
      title: "T",
      items: [{ text: "x" }],
    });

    const approved = await app.request(
      `/api/agent-requirement/${project.id}/spec-tabs/approve`,
      {
        method: "POST",
      },
    );
    expect(approved.status).toBe(200);
    const row = (await approved.json()) as {
      status: string;
      approvedAt: string | null;
      approvedBy: string;
    };
    expect(row.status).toBe("approved");
    expect(row.approvedAt).toEqual(expect.any(String));
    expect(row.approvedBy).toBe(member.user.id);
    const decisions = (await entriesFor(project.id)).filter(
      (e) => e.kind === "decision",
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.summary).toContain("승인");

    // Same user, but via API key: refused at the route, not silently allowed.
    await seedApiKey(member.user.id);
    const viaKey = await app.request(
      `/api/agent-requirement/${project.id}/spec-tabs/approve`,
      {
        method: "POST",
        headers: { "x-api-key": "kaneo_test_key" },
      },
    );
    expect(viaKey.status).toBe(403);
  });

  it("[REQ-SPEC-TABS-9] [REQ-SPEC-TABS-14] editing an item moves updatedAt, keeps the previous text on the timeline, and drops approval to draft", async () => {
    const { app, project } = await setup();
    await putSet(app, project.id, "spec-tabs", {
      title: "T",
      items: [{ text: "before" }],
    });
    await app.request(
      `/api/agent-requirement/${project.id}/spec-tabs/approve`,
      { method: "POST" },
    );
    const before = await getSet(app, project.id, "spec-tabs");

    const edited = await putSet(app, project.id, "spec-tabs", {
      title: "T",
      items: [{ key: "REQ-SPEC-TABS-1", text: "after" }],
    });
    const after = (await edited.json()) as SetDetail;
    expect(after.status).toBe("draft");
    expect(after.approvedAt).toBe(before.approvedAt); // clock kept for downstream stale checks
    expect(
      new Date(String(after.items[0]?.updatedAt)).getTime(),
    ).toBeGreaterThanOrEqual(
      new Date(String(before.items[0]?.updatedAt)).getTime(),
    );

    const entries = await entriesFor(project.id);
    const edit = entries.find((e) => e.summary.includes("REQ-SPEC-TABS-1"));
    expect(edit?.body).toContain("before");
    expect(entries.some((e) => e.summary.includes("draft"))).toBe(true);

    // Unchanged text does not move the clock or write an entry.
    const untouched = await putSet(app, project.id, "spec-tabs", {
      title: "T",
      items: [{ key: "REQ-SPEC-TABS-1", text: "after" }],
    });
    const same = (await untouched.json()) as SetDetail;
    expect(same.items[0]?.updatedAt).toBe(after.items[0]?.updatedAt);
    expect((await entriesFor(project.id)).length).toBe(entries.length); // already draft: nothing to record
  });

  it("[REQ-SPEC-TABS-5] [REQ-SPEC-TABS-6] [REQ-SPEC-TABS-8] a design maps to items, approval is human-only, and stale names the moved key", async () => {
    const { app, project } = await setup();
    await putSet(app, project.id, "spec-tabs", {
      title: "T",
      items: [{ text: "a" }, { text: "b" }],
    });

    const unknown = await app.request(
      `/api/agent-design/${project.id}/spec-tabs`,
      json({ title: "D", body: "# d", requirementKeys: ["REQ-SPEC-TABS-9"] }),
    );
    expect(unknown.status).toBe(400);

    const put = await app.request(
      `/api/agent-design/${project.id}/spec-tabs`,
      json({
        title: "D",
        body: "# d",
        requirementKeys: ["REQ-SPEC-TABS-1", "REQ-SPEC-TABS-2"],
      }),
    );
    expect(put.status).toBe(200);
    let design = (await put.json()) as Design;
    expect(design.requirements.map((r) => r.key)).toEqual([
      "REQ-SPEC-TABS-1",
      "REQ-SPEC-TABS-2",
    ]);
    expect(design.stale).toEqual({ stale: false, causes: [] });

    const approve = await app.request(
      `/api/agent-design/${project.id}/spec-tabs/approve`,
      { method: "POST" },
    );
    expect(approve.status).toBe(200);

    await bumpItem("REQ-SPEC-TABS-2");
    design = await getDesign(app, project.id, "spec-tabs");
    expect(design.stale.stale).toBe(true);
    expect(design.stale.causes).toEqual([
      expect.objectContaining({ kind: "requirement", key: "REQ-SPEC-TABS-2" }),
    ]);
    expect(
      design.requirements.find((r) => r.key === "REQ-SPEC-TABS-2")
        ?.changedSinceApproval,
    ).toBe(true);

    const list = await app.request(`/api/agent-design/${project.id}`);
    const { designs } = (await list.json()) as {
      designs: Array<{ feature: string; stale: { stale: boolean } }>;
    };
    expect(designs[0]?.stale.stale).toBe(true);

    // The requirement item shows the design it went into.
    const set = await getSet(app, project.id, "spec-tabs");
    expect(set.items[0]?.designs.map((d) => d.feature)).toEqual(["spec-tabs"]);
  });

  it("[REQ-SPEC-TABS-7] [REQ-SPEC-TABS-8] [REQ-SPEC-TABS-10] [REQ-FEATURE-HUB-14] [REQ-FEATURE-HUB-15] task links go stale when upstream moves and clear on acknowledge; first design approval does not", async () => {
    const { app, project, columns } = await setup();
    const task = await seedTask(project.id, columns.todo.id, 1);
    await putSet(app, project.id, "spec-tabs", {
      title: "T",
      items: [{ text: "a" }],
    });
    await app.request(
      `/api/agent-design/${project.id}/spec-tabs`,
      json({ title: "D", body: "d", requirementKeys: ["REQ-SPEC-TABS-1"] }),
    );

    const linked = await app.request(
      `/api/agent-task-link/${project.id}/${task.id}`,
      json({
        requirementKeys: ["REQ-SPEC-TABS-1"],
        designFeatures: ["spec-tabs"],
      }),
    );
    expect(linked.status).toBe(200);
    let links = (await linked.json()) as TaskLinks;
    expect(links.requirements.map((r) => r.key)).toEqual(["REQ-SPEC-TABS-1"]);
    expect(links.designs.map((d) => d.feature)).toEqual(["spec-tabs"]);
    expect(links.stale.stale).toBe(false);

    await bumpItem("REQ-SPEC-TABS-1");
    links = await getLinks(app, project.id, task.id);
    expect(links.stale.causes).toEqual([
      expect.objectContaining({ kind: "requirement", key: "REQ-SPEC-TABS-1" }),
    ]);

    const badges = await app.request(`/api/agent-task-link/${project.id}`);
    const { tasks } = (await badges.json()) as {
      tasks: Array<{
        taskId: string;
        stale: boolean;
        requirementKeys: string[];
      }>;
    };
    expect(tasks).toEqual([
      {
        taskId: task.id,
        requirementKeys: ["REQ-SPEC-TABS-1"],
        designFeatures: ["spec-tabs"],
        stale: true,
      },
    ]);

    // Acknowledge is human-only and clears stale without touching upstream.
    const ack = await app.request(
      `/api/agent-task-link/${project.id}/${task.id}/acknowledge`,
      { method: "POST" },
    );
    expect(ack.status).toBe(200);
    links = await getLinks(app, project.id, task.id);
    expect(links.stale.stale).toBe(false);
    expect(links.requirements[0]?.acknowledgedAt).toEqual(expect.any(String));

    // The first approval of a design is not a change to tasks derived from it:
    // their link clocks move with it (REQ-FEATURE-HUB-14).
    await new Promise((r) => setTimeout(r, 5));
    await app.request(`/api/agent-design/${project.id}/spec-tabs/approve`, {
      method: "POST",
    });
    links = await getLinks(app, project.id, task.id);
    expect(links.stale.stale).toBe(false);

    // A re-approval later than the ack makes it stale through the design link (REQ-FEATURE-HUB-15).
    await new Promise((r) => setTimeout(r, 5));
    await app.request(`/api/agent-design/${project.id}/spec-tabs/approve`, {
      method: "POST",
    });
    links = await getLinks(app, project.id, task.id);
    expect(links.stale.causes).toEqual([
      expect.objectContaining({ kind: "design", key: "spec-tabs" }),
    ]);

    // A task outside the project cannot be linked.
    const other = await createProjectFixture({
      workspaceId: project.workspaceId,
    });
    const cross = await app.request(
      `/api/agent-task-link/${other.project.id}/${task.id}`,
      json({ requirementKeys: [] }),
    );
    expect(cross.status).toBe(400);
  });

  it("[REQ-SPEC-TABS-17] coverage upsert replaces a repo's rows and rejects unknown keys", async () => {
    const { app, project } = await setup();
    await putSet(app, project.id, "spec-tabs", {
      title: "T",
      items: [{ text: "a" }, { text: "b" }],
    });
    const url = `/api/agent-requirement/${project.id}/spec-tabs/coverage`;

    const unknown = await app.request(
      url,
      json({
        repo: "r",
        entries: [{ key: "REQ-SPEC-TABS-9", testPath: "t.ts" }],
      }),
    );
    expect(unknown.status).toBe(400);

    const first = await app.request(
      url,
      json({
        repo: "r",
        entries: [
          { key: "REQ-SPEC-TABS-1", testPath: "a.test.ts", testName: "one" },
          { key: "REQ-SPEC-TABS-2", testPath: "b.test.ts" },
        ],
      }),
    );
    expect(first.status).toBe(200);
    let set = await getSet(app, project.id, "spec-tabs");
    expect(set.items.map((i) => i.coverage.length)).toEqual([1, 1]);

    // Second report from the same repo no longer cites key 2 → its coverage is gone; other repo untouched.
    await app.request(
      url,
      json({
        repo: "other",
        entries: [{ key: "REQ-SPEC-TABS-2", testPath: "x.test.ts" }],
      }),
    );
    await app.request(
      url,
      json({
        repo: "r",
        entries: [{ key: "REQ-SPEC-TABS-1", testPath: "a.test.ts" }],
      }),
    );
    set = await getSet(app, project.id, "spec-tabs");
    expect(set.items[0]?.coverage).toEqual([
      expect.objectContaining({ repo: "r", testPath: "a.test.ts" }),
    ]);
    expect(set.items[1]?.coverage).toEqual([
      expect.objectContaining({ repo: "other" }),
    ]);
  });

  it("[REQ-SPEC-TABS-15] the light requirement-set route serves keys and clocks to an API-key caller", async () => {
    const { app, project, member } = await setup();
    await putSet(app, project.id, "spec-tabs", {
      title: "T",
      items: [{ text: "a", layer: "api" }],
    });
    await app.request(
      `/api/agent-requirement/${project.id}/spec-tabs/approve`,
      { method: "POST" },
    );

    vi.restoreAllMocks(); // no session: only the API key authenticates below
    await seedApiKey(member.user.id);
    const res = await app.request(
      `/api/requirement-set/${project.id}/spec-tabs`,
      {
        headers: { "x-api-key": "kaneo_test_key" },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      approvedAt: string;
      items: Array<Record<string, unknown>>;
    };
    expect(body.status).toBe("approved");
    expect(body.items).toEqual([
      {
        key: "REQ-SPEC-TABS-1",
        status: "active",
        layer: "api",
        story: null,
        updatedAt: expect.any(String),
      },
    ]);

    const missing = await app.request(
      `/api/requirement-set/${project.id}/nope`,
      { headers: { "x-api-key": "k" } },
    );
    expect(missing.status).toBe(404);
  });

  it("[REQ-SPEC-TABS-14] MCP tools write as the agent (actorId, draft) and cannot approve", async () => {
    const { app, project, columns } = await setup();
    const task = await seedTask(project.id, columns.todo.id, 1);

    const put = await mcpToolCall(app, "agent_requirements_put", {
      projectId: project.id,
      feature: "spec-tabs",
      title: "Spec tabs",
      items: [{ text: "agent wrote this" }],
      ...identity,
    });
    expect(put.isError, put.content[0]?.text).toBeUndefined();
    expect(toolJson<{ items: Array<{ key: string }> }>(put).items[0]?.key).toBe(
      "REQ-SPEC-TABS-1",
    );
    const set = await getSet(app, project.id, "spec-tabs");
    expect(set.actorId).toEqual(expect.any(String));
    expect(set.updatedBy).toBeNull();

    // Approve, then overwrite via MCP: back to draft, with an entry saying so.
    await app.request(
      `/api/agent-requirement/${project.id}/spec-tabs/approve`,
      { method: "POST" },
    );
    await mcpToolCall(app, "agent_requirements_put", {
      projectId: project.id,
      feature: "spec-tabs",
      title: "Spec tabs",
      items: [{ key: "REQ-SPEC-TABS-1", text: "agent changed this" }],
      ...identity,
    });
    const reverted = await getSet(app, project.id, "spec-tabs");
    expect(reverted.status).toBe("draft");
    const entries = await entriesFor(project.id);
    expect(entries.some((e) => e.summary.includes("draft") && e.actorId)).toBe(
      true,
    );

    const design = await mcpToolCall(app, "agent_design_put", {
      projectId: project.id,
      feature: "spec-tabs",
      title: "D",
      body: "# d",
      requirementKeys: ["REQ-SPEC-TABS-1"],
      ...identity,
    });
    expect(design.isError, design.content[0]?.text).toBeUndefined();

    const link = await mcpToolCall(app, "agent_task_link", {
      projectId: project.id,
      taskId: task.id,
      requirementKeys: ["REQ-SPEC-TABS-1"],
      designFeatures: ["spec-tabs"],
      ...identity,
    });
    expect(
      toolJson<{ requirements: string[]; designs: string[] }>(link),
    ).toMatchObject({
      requirements: ["REQ-SPEC-TABS-1"],
      designs: ["spec-tabs"],
    });

    const coverage = await mcpToolCall(app, "agent_requirement_coverage_put", {
      projectId: project.id,
      feature: "spec-tabs",
      repo: "r",
      entries: [{ key: "REQ-SPEC-TABS-1", testPath: "t.test.ts" }],
      ...identity,
    });
    expect(toolJson<{ reported: number }>(coverage).reported).toBe(1);

    routeFetchInto(app);
    const read = await mcpToolCall(app, "agent_requirements_get", {
      projectId: project.id,
      feature: "spec-tabs",
    });
    expect(
      toolJson<{ items: Array<{ covered: boolean; tasks: unknown[] }> }>(read)
        .items[0],
    ).toMatchObject({
      covered: true,
      tasks: [1],
    });

    // No approve tool exists on the MCP surface: the call is rejected before any handler runs.
    await expect(
      mcpToolCall(app, "agent_requirements_approve", {
        projectId: project.id,
        feature: "spec-tabs",
      }),
    ).rejects.toThrow(/not found/);
  });
});
