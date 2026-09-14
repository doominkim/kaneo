import { randomUUID } from "node:crypto";
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
  agentRequirementSetTable,
  agentTaskDesignTable,
  agentTaskRequirementTable,
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
  title: string;
  body: string;
  status: string;
  approvedAt: string | null;
  approvedBy: string | null;
  reviewed: boolean;
  reviewedAt: string | null;
  reviewedBy: string | null;
  revisedAt: string;
  nextSeq: number;
  updatedBy: string | null;
  actorId: string | null;
  items: Item[];
};
type Stale = {
  stale: boolean;
  causes: Array<{ kind: string; key: string }>;
};
type Design = {
  id: string;
  body: string;
  status: string;
  approvedAt: string | null;
  approvedBy: string | null;
  reviewed: boolean;
  reviewedBy: string | null;
  revisedAt: string;
  stale: Stale;
  requirements: Array<{ key: string; changedSinceRevision: boolean }>;
  tasks: Array<{ id: string }>;
};
type TaskLinks = {
  requirements: Array<{
    key: string;
    acknowledgedAt: string | null;
    acknowledgedByAgent: boolean;
    reviewed: boolean;
  }>;
  designs: Array<{
    feature: string;
    acknowledgedByAgent: boolean;
    reviewed: boolean;
  }>;
  stale: Stale;
};
type Revision = {
  id: string;
  title: string;
  createdAt: string;
  revertedFromId: string | null;
  createdBy: string | null;
  author: { userId: string; name: string } | null;
  actor: { model: string } | null;
};

const identity = { provider: "anthropic", model: "claude-opus-5" };
const viaKey = { "x-api-key": "kaneo_test_key" };
const json = (body: unknown, method = "PUT") => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const wait = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function setup(role = "member") {
  const member = await createWorkspaceMember({ role });
  const { project, columns } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });
  mockAuthenticatedSession(member.user);
  const { app } = createApp();
  return { member, project, columns, app };
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

function putSet(app: App, projectId: string, feature: string, body: unknown) {
  return app.request(
    `/api/agent-requirement/${projectId}/${feature}`,
    json(body),
  );
}
function putDesign(
  app: App,
  projectId: string,
  feature: string,
  body: unknown,
) {
  return app.request(`/api/agent-design/${projectId}/${feature}`, json(body));
}
function post(app: App, path: string, headers: Record<string, string> = {}) {
  return app.request(path, { method: "POST", headers });
}
function del(app: App, path: string, headers: Record<string, string> = {}) {
  return app.request(path, { method: "DELETE", headers });
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
async function badges(app: App, projectId: string) {
  const res = await app.request(`/api/agent-task-link/${projectId}`);
  expect(res.status).toBe(200);
  return (
    (await res.json()) as {
      tasks: Array<{
        taskId: string;
        requirementKeys: string[];
        designFeatures: string[];
        stale: boolean;
      }>;
    }
  ).tasks;
}
async function revisions(
  app: App,
  kind: "agent-requirement" | "agent-design",
  projectId: string,
  feature: string,
) {
  const res = await app.request(
    `/api/${kind}/${projectId}/${feature}/revisions`,
  );
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { revisions: Revision[] }).revisions;
}
/** Move an item's clock to "now", strictly after whatever was created before the call. */
async function bumpItem(key: string) {
  await wait();
  await db
    .update(agentRequirementItemTable)
    .set({ updatedAt: new Date() })
    .where(eq(agentRequirementItemTable.key, key));
  await wait();
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
/**
 * A real apikey row: workspace access checks the key's owner, not just the
 * mocked verifier. Once seeded, a bearer token also verifies as this key, so
 * MCP calls must come before it.
 */
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
    expect(set.status).toBe("approved");
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

  it("[REQ-SPEC-TABS-9] editing an item moves updatedAt and keeps the previous text on the timeline", async () => {
    const { app, project } = await setup();
    await putSet(app, project.id, "spec-tabs", {
      title: "T",
      items: [{ text: "before" }],
    });
    const before = await getSet(app, project.id, "spec-tabs");
    await wait();

    const edited = await putSet(app, project.id, "spec-tabs", {
      title: "T",
      items: [{ key: "REQ-SPEC-TABS-1", text: "after" }],
    });
    const after = (await edited.json()) as SetDetail;
    expect(after.status).toBe("approved");
    expect(
      new Date(String(after.items[0]?.updatedAt)).getTime(),
    ).toBeGreaterThan(new Date(String(before.items[0]?.updatedAt)).getTime());

    const entries = await entriesFor(project.id);
    const edit = entries.find((e) => e.summary.includes("REQ-SPEC-TABS-1"));
    expect(edit?.body).toContain("before");

    // Unchanged text does not move the clock or write an entry.
    const untouched = await putSet(app, project.id, "spec-tabs", {
      title: "T",
      items: [{ key: "REQ-SPEC-TABS-1", text: "after" }],
    });
    const same = (await untouched.json()) as SetDetail;
    expect(same.items[0]?.updatedAt).toBe(after.items[0]?.updatedAt);
    expect((await entriesFor(project.id)).length).toBe(entries.length);
  });

  it("[REQ-AGENT-AUTOAPPLY-28] [REQ-SPEC-TABS-5] a design maps to items and goes stale when a covered requirement changes after its last revision", async () => {
    const { app, project } = await setup();
    await putSet(app, project.id, "spec-tabs", {
      title: "T",
      items: [{ text: "a" }, { text: "b" }],
    });

    const unknown = await putDesign(app, project.id, "spec-tabs", {
      title: "D",
      body: "# d",
      requirementKeys: ["REQ-SPEC-TABS-9"],
    });
    expect(unknown.status).toBe(400);

    const put = await putDesign(app, project.id, "spec-tabs", {
      title: "D",
      body: "# d",
      requirementKeys: ["REQ-SPEC-TABS-1", "REQ-SPEC-TABS-2"],
    });
    expect(put.status).toBe(200);
    let design = (await put.json()) as Design;
    expect(design.requirements).toEqual([
      expect.objectContaining({
        key: "REQ-SPEC-TABS-1",
        changedSinceRevision: false,
      }),
      expect.objectContaining({
        key: "REQ-SPEC-TABS-2",
        changedSinceRevision: false,
      }),
    ]);
    expect(design.stale).toEqual({ stale: false, causes: [] });

    await bumpItem("REQ-SPEC-TABS-2");
    design = await getDesign(app, project.id, "spec-tabs");
    expect(design.stale.stale).toBe(true);
    expect(design.stale.causes).toEqual([
      expect.objectContaining({ kind: "requirement", key: "REQ-SPEC-TABS-2" }),
    ]);
    expect(
      design.requirements.map((r) => [r.key, r.changedSinceRevision]),
    ).toEqual([
      ["REQ-SPEC-TABS-1", false],
      ["REQ-SPEC-TABS-2", true],
    ]);

    const list = await app.request(`/api/agent-design/${project.id}`);
    const { designs } = (await list.json()) as {
      designs: Array<{ feature: string; stale: { stale: boolean } }>;
    };
    expect(designs[0]?.stale.stale).toBe(true);

    // The requirement item shows the design it went into.
    const set = await getSet(app, project.id, "spec-tabs");
    expect(set.items[0]?.designs.map((d) => d.feature)).toEqual(["spec-tabs"]);
  });

  it("[REQ-AGENT-AUTOAPPLY-30] [REQ-AGENT-AUTOAPPLY-31] [REQ-SPEC-TABS-7] [REQ-SPEC-TABS-10] creating a design leaves linked tasks alone, a content revision flags them, and acknowledging clears stale", async () => {
    const { app, project, columns } = await setup();
    const task = await seedTask(project.id, columns.todo.id, 1);
    const linkUrl = `/api/agent-task-link/${project.id}/${task.id}`;
    await putSet(app, project.id, "spec-tabs", {
      title: "T",
      items: [{ text: "a" }, { text: "b" }],
    });

    // The task is linked to a requirement before any design exists; creating
    // the design is not a change to it.
    expect(
      (
        await app.request(
          linkUrl,
          json({ requirementKeys: ["REQ-SPEC-TABS-1"] }),
        )
      ).status,
    ).toBe(200);
    await wait();
    expect(
      (
        await putDesign(app, project.id, "spec-tabs", {
          title: "D",
          body: "d",
          requirementKeys: ["REQ-SPEC-TABS-1"],
        })
      ).status,
    ).toBe(200);
    expect((await getLinks(app, project.id, task.id)).stale.stale).toBe(false);
    await wait();

    const linked = await app.request(
      linkUrl,
      json({
        requirementKeys: ["REQ-SPEC-TABS-1"],
        designFeatures: ["spec-tabs"],
      }),
    );
    expect(linked.status).toBe(200);
    let links = (await linked.json()) as TaskLinks;
    expect(links.requirements.map((r) => r.key)).toEqual(["REQ-SPEC-TABS-1"]);
    expect(links.designs.map((d) => d.feature)).toEqual(["spec-tabs"]);
    expect(links.stale).toEqual({ stale: false, causes: [] });

    await bumpItem("REQ-SPEC-TABS-1");
    links = await getLinks(app, project.id, task.id);
    expect(links.stale.causes).toEqual([
      expect.objectContaining({ kind: "requirement", key: "REQ-SPEC-TABS-1" }),
    ]);
    expect(await badges(app, project.id)).toEqual([
      {
        taskId: task.id,
        requirementKeys: ["REQ-SPEC-TABS-1"],
        designFeatures: ["spec-tabs"],
        stale: true,
      },
    ]);

    // A person's acknowledgement clears stale and counts as reviewed.
    const acknowledge = () =>
      post(app, `/api/agent-task-link/${project.id}/${task.id}/acknowledge`);
    expect((await acknowledge()).status).toBe(200);
    links = await getLinks(app, project.id, task.id);
    expect(links.stale.stale).toBe(false);
    expect(links.requirements[0]).toMatchObject({
      acknowledgedAt: expect.any(String),
      acknowledgedByAgent: false,
      reviewed: true,
    });

    // An identical design save is not a revision.
    await wait();
    await putDesign(app, project.id, "spec-tabs", {
      title: "D",
      body: "d",
      requirementKeys: ["REQ-SPEC-TABS-1"],
    });
    expect((await getLinks(app, project.id, task.id)).stale.stale).toBe(false);

    // A body change is.
    await wait();
    await putDesign(app, project.id, "spec-tabs", {
      title: "D",
      body: "d2",
      requirementKeys: ["REQ-SPEC-TABS-1"],
    });
    expect((await getLinks(app, project.id, task.id)).stale.causes).toEqual([
      expect.objectContaining({ kind: "design", key: "spec-tabs" }),
    ]);

    // So is a change to the covered requirement keys alone.
    expect((await acknowledge()).status).toBe(200);
    expect((await getLinks(app, project.id, task.id)).stale.stale).toBe(false);
    await wait();
    await putDesign(app, project.id, "spec-tabs", {
      title: "D",
      body: "d2",
      requirementKeys: ["REQ-SPEC-TABS-1", "REQ-SPEC-TABS-2"],
    });
    expect((await getLinks(app, project.id, task.id)).stale.causes).toEqual([
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

    vi.restoreAllMocks(); // no session: only the API key authenticates below
    await seedApiKey(member.user.id);
    const res = await app.request(
      `/api/requirement-set/${project.id}/spec-tabs`,
      {
        headers: viaKey,
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      approvedAt: string;
      items: Array<Record<string, unknown>>;
    };
    expect(body.status).toBe("approved");
    expect(body.approvedAt).toEqual(expect.any(String));
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

  it("[REQ-AGENT-AUTOAPPLY-1] [REQ-AGENT-AUTOAPPLY-2] [REQ-AGENT-AUTOAPPLY-6] MCP writes apply at once as the agent and stay unreviewed, and an agent save clears a person's review", async () => {
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
    expect(set).toMatchObject({
      status: "approved",
      approvedBy: null,
      actorId: expect.any(String),
      updatedBy: null,
      reviewed: false,
      reviewedAt: null,
      reviewedBy: null,
    });
    expect(set.approvedAt).toEqual(expect.any(String));

    // A person reviews it; the agent's next save clears the mark again.
    expect(
      (await post(app, `/api/agent-requirement/${project.id}/spec-tabs/review`))
        .status,
    ).toBe(200);
    expect((await getSet(app, project.id, "spec-tabs")).reviewed).toBe(true);
    await mcpToolCall(app, "agent_requirements_put", {
      projectId: project.id,
      feature: "spec-tabs",
      title: "Spec tabs",
      items: [{ key: "REQ-SPEC-TABS-1", text: "agent changed this" }],
      ...identity,
    });
    const rewritten = await getSet(app, project.id, "spec-tabs");
    expect(rewritten).toMatchObject({
      status: "approved",
      reviewed: false,
      reviewedBy: null,
    });
    const entries = await entriesFor(project.id);
    expect(entries.some((e) => e.summary.includes("draft"))).toBe(false);

    const design = await mcpToolCall(app, "agent_design_put", {
      projectId: project.id,
      feature: "spec-tabs",
      title: "D",
      body: "# d",
      requirementKeys: ["REQ-SPEC-TABS-1"],
      ...identity,
    });
    expect(design.isError, design.content[0]?.text).toBeUndefined();
    expect(await getDesign(app, project.id, "spec-tabs")).toMatchObject({
      status: "approved",
      approvedBy: null,
      reviewed: false,
      reviewedBy: null,
    });

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

  describe("agent-autoapply", () => {
    it("[REQ-AGENT-AUTOAPPLY-1] [REQ-AGENT-AUTOAPPLY-2] [REQ-AGENT-AUTOAPPLY-7] a person's save applies at once and is that person's review; the approve routes are gone", async () => {
      const { app, project, member } = await setup();
      const created = await putSet(app, project.id, "spec-tabs", {
        title: "T",
        body: "# scope",
        items: [{ text: "a" }],
      });
      const set = (await created.json()) as SetDetail;
      expect(set).toMatchObject({
        status: "approved",
        approvedBy: member.user.id,
        reviewed: true,
        reviewedBy: member.user.id,
        updatedBy: member.user.id,
      });
      expect(set.approvedAt).toEqual(expect.any(String));
      expect(set.reviewedAt).toEqual(expect.any(String));

      await wait();
      const again = (await (
        await putSet(app, project.id, "spec-tabs", {
          title: "T2",
          body: "# scope",
          items: [],
        })
      ).json()) as SetDetail;
      expect(new Date(String(again.approvedAt)).getTime()).toBeGreaterThan(
        new Date(String(set.approvedAt)).getTime(),
      );

      const design = (await (
        await putDesign(app, project.id, "spec-tabs", {
          title: "D",
          body: "d",
          requirementKeys: ["REQ-SPEC-TABS-1"],
        })
      ).json()) as Design;
      expect(design).toMatchObject({
        status: "approved",
        approvedBy: member.user.id,
        reviewed: true,
        reviewedBy: member.user.id,
      });
      expect(design.approvedAt).toEqual(expect.any(String));

      for (const kind of ["agent-requirement", "agent-design"]) {
        const gone = await post(
          app,
          `/api/${kind}/${project.id}/spec-tabs/approve`,
        );
        expect(gone.status, kind).toBe(404);
      }
    });

    it("[REQ-AGENT-AUTOAPPLY-9] reviewing a set or design is a human action: a session marks it without a timeline entry, an API key is refused", async () => {
      const { app, project, member } = await setup();
      await mcpToolCall(app, "agent_requirements_put", {
        projectId: project.id,
        feature: "spec-tabs",
        title: "T",
        items: [{ text: "a" }],
        ...identity,
      });
      await mcpToolCall(app, "agent_design_put", {
        projectId: project.id,
        feature: "spec-tabs",
        title: "D",
        body: "d",
        ...identity,
      });
      expect((await getSet(app, project.id, "spec-tabs")).reviewed).toBe(false);
      const entriesBefore = (await entriesFor(project.id)).length;
      const reviewPaths = [
        `/api/agent-requirement/${project.id}/spec-tabs/review`,
        `/api/agent-design/${project.id}/spec-tabs/review`,
      ];

      await seedApiKey(member.user.id);
      for (const path of reviewPaths) {
        expect((await post(app, path, viaKey)).status, path).toBe(403);
      }
      expect((await getSet(app, project.id, "spec-tabs")).reviewed).toBe(false);
      expect((await getDesign(app, project.id, "spec-tabs")).reviewed).toBe(
        false,
      );

      for (const path of reviewPaths) {
        const reviewed = await post(app, path);
        expect(reviewed.status, path).toBe(200);
        expect(await reviewed.json()).toMatchObject({
          feature: "spec-tabs",
          reviewedAt: expect.any(String),
          reviewedBy: member.user.id,
        });
      }
      expect(await getSet(app, project.id, "spec-tabs")).toMatchObject({
        reviewed: true,
        reviewedBy: member.user.id,
      });
      expect(await getDesign(app, project.id, "spec-tabs")).toMatchObject({
        reviewed: true,
        reviewedBy: member.user.id,
      });
      expect((await entriesFor(project.id)).length).toBe(entriesBefore);
      expect(
        (await post(app, `/api/agent-requirement/${project.id}/nope/review`))
          .status,
      ).toBe(404);
    });

    it("[REQ-AGENT-AUTOAPPLY-12] [REQ-AGENT-AUTOAPPLY-14] [REQ-AGENT-AUTOAPPLY-15] [REQ-AGENT-AUTOAPPLY-17] deleting a set and a design keeps every row and link, hides them from reads, and restore brings them back", async () => {
      const { app, project, columns, member: admin } = await setup("admin");
      const task = await seedTask(project.id, columns.todo.id, 1);
      const setPath = `/api/agent-requirement/${project.id}/alpha`;
      const designPath = `/api/agent-design/${project.id}/alpha`;
      const linkPath = `/api/agent-task-link/${project.id}/${task.id}`;
      await putSet(app, project.id, "alpha", {
        title: "Alpha",
        items: [{ text: "a1" }],
      });
      await putDesign(app, project.id, "alpha", {
        title: "Alpha design",
        body: "d",
        requirementKeys: ["REQ-ALPHA-1"],
      });
      await wait();
      await app.request(
        linkPath,
        json({ requirementKeys: ["REQ-ALPHA-1"], designFeatures: ["alpha"] }),
      );
      const before = await getSet(app, project.id, "alpha");
      const features = async (query = "") =>
        (
          (await (
            await app.request(`/api/agent-feature/${project.id}${query}`)
          ).json()) as {
            features: Array<{
              feature: string;
              requirements: Record<string, unknown> | null;
              design: Record<string, unknown> | null;
            }>;
          }
        ).features;

      // project:update is required.
      const member = await addMember(project.workspaceId, "member");
      mockAuthenticatedSession(member);
      expect((await del(createApp().app, setPath)).status).toBe(403);
      mockAuthenticatedSession(admin.user);

      const deleted = await del(app, setPath);
      expect(deleted.status, await deleted.clone().text()).toBe(200);
      expect(await deleted.json()).toMatchObject({
        id: before.id,
        feature: "alpha",
        deletedAt: expect.any(String),
        deletedBy: admin.user.id,
      });

      // The row and the task link rows stay.
      const [row] = await db
        .select()
        .from(agentRequirementSetTable)
        .where(eq(agentRequirementSetTable.id, before.id));
      expect(row).toMatchObject({ title: "Alpha", deletedBy: admin.user.id });
      expect(row?.deletedAt).not.toBeNull();
      expect(
        await db
          .select()
          .from(agentTaskRequirementTable)
          .where(eq(agentTaskRequirementTable.taskId, task.id)),
      ).toHaveLength(1);

      // Every read skips it: get, list, spec-check, design coverage, task links, features.
      expect((await app.request(setPath)).status).toBe(404);
      expect(
        (
          (await (
            await app.request(`/api/agent-requirement/${project.id}`)
          ).json()) as { sets: unknown[] }
        ).sets,
      ).toEqual([]);
      expect(
        (await app.request(`/api/requirement-set/${project.id}/alpha`)).status,
      ).toBe(404);
      expect((await getDesign(app, project.id, "alpha")).requirements).toEqual(
        [],
      );
      let links = await getLinks(app, project.id, task.id);
      expect(links.requirements).toEqual([]);
      expect(links.designs.map((d) => d.feature)).toEqual(["alpha"]);
      expect(await badges(app, project.id)).toEqual([
        expect.objectContaining({ requirementKeys: [] }),
      ]);
      expect(await features()).toEqual([
        expect.objectContaining({ feature: "alpha", requirements: null }),
      ]);
      // Writes cannot reach it either, and deleting twice finds nothing.
      expect(
        (await putSet(app, project.id, "alpha", { title: "Alpha", items: [] }))
          .status,
      ).toBe(409);
      expect(
        (
          await app.request(
            linkPath,
            json({ requirementKeys: ["REQ-ALPHA-1"] }),
          )
        ).status,
      ).toBe(400);
      // Replacing the visible links leaves the hidden ones in place.
      expect(
        (
          await app.request(
            linkPath,
            json({ requirementKeys: [], designFeatures: ["alpha"] }),
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await putDesign(app, project.id, "alpha", {
            title: "Alpha design",
            body: "d",
            requirementKeys: [],
          })
        ).status,
      ).toBe(200);
      expect((await del(app, setPath)).status).toBe(404);

      expect((await del(app, designPath)).status).toBe(200);
      expect((await app.request(designPath)).status).toBe(404);
      links = await getLinks(app, project.id, task.id);
      expect([links.requirements, links.designs]).toEqual([[], []]);
      expect(await badges(app, project.id)).toEqual([]);
      expect(await features()).toEqual([]);
      expect(
        await db
          .select()
          .from(agentTaskDesignTable)
          .where(eq(agentTaskDesignTable.taskId, task.id)),
      ).toHaveLength(1);
      expect(await features("?deleted=true")).toEqual([
        expect.objectContaining({
          feature: "alpha",
          requirements: expect.objectContaining({
            deletedAt: expect.any(String),
            deletedBy: admin.user.id,
          }),
          design: expect.objectContaining({
            deletedAt: expect.any(String),
            deletedBy: admin.user.id,
          }),
        }),
      ]);

      const restoredSet = await post(app, `${setPath}/restore`);
      expect(restoredSet.status, await restoredSet.clone().text()).toBe(200);
      expect(await restoredSet.json()).toMatchObject({
        id: before.id,
        title: before.title,
        reviewed: before.reviewed,
        revisedAt: before.revisedAt,
      });
      expect((await post(app, `${designPath}/restore`)).status).toBe(200);
      expect((await post(app, `${setPath}/restore`)).status).toBe(404);

      links = await getLinks(app, project.id, task.id);
      expect(links.requirements.map((r) => r.key)).toEqual(["REQ-ALPHA-1"]);
      expect(links.designs.map((d) => d.feature)).toEqual(["alpha"]);
      expect(await badges(app, project.id)).toEqual([
        {
          taskId: task.id,
          requirementKeys: ["REQ-ALPHA-1"],
          designFeatures: ["alpha"],
          stale: false,
        },
      ]);
      expect(
        (await getDesign(app, project.id, "alpha")).requirements.map(
          (r) => r.key,
        ),
      ).toEqual(["REQ-ALPHA-1"]);
      expect(await features()).toEqual([
        expect.objectContaining({
          feature: "alpha",
          requirements: expect.objectContaining({ deletedAt: null }),
          design: expect.objectContaining({ deletedAt: null }),
        }),
      ]);

      // Each delete and restore left one entry, authored by the person.
      const lifecycle = (await entriesFor(project.id)).filter((e) =>
        /문서 (삭제|복구)$/.test(e.summary),
      );
      expect(lifecycle.map((e) => e.summary).sort()).toEqual([
        "[design:alpha] 설계 문서 복구",
        "[design:alpha] 설계 문서 삭제",
        "[requirements:alpha] 요구사항 문서 복구",
        "[requirements:alpha] 요구사항 문서 삭제",
      ]);
      expect(
        lifecycle.every(
          (e) => e.createdBy === admin.user.id && e.actorId === null,
        ),
      ).toBe(true);
    });

    it("[REQ-AGENT-AUTOAPPLY-16] an API key cannot delete, restore or revert a set or design, even for a project:update holder", async () => {
      const { app, project, member: admin } = await setup("admin");
      await putSet(app, project.id, "spec-tabs", {
        title: "T",
        body: "# one",
        items: [],
      });
      await putDesign(app, project.id, "spec-tabs", {
        title: "D",
        body: "d",
      });
      const [revision] = await revisions(
        app,
        "agent-requirement",
        project.id,
        "spec-tabs",
      );
      const setPath = `/api/agent-requirement/${project.id}/spec-tabs`;

      await seedApiKey(admin.user.id);
      for (const kind of ["agent-requirement", "agent-design"]) {
        const refused = await del(
          app,
          `/api/${kind}/${project.id}/spec-tabs`,
          viaKey,
        );
        expect(refused.status, kind).toBe(403);
      }
      expect(
        (await post(app, `${setPath}/revisions/${revision?.id}/revert`, viaKey))
          .status,
      ).toBe(403);
      expect((await getSet(app, project.id, "spec-tabs")).title).toBe("T");

      expect((await del(app, setPath)).status).toBe(200);
      expect((await post(app, `${setPath}/restore`, viaKey)).status).toBe(403);
      const [row] = await db
        .select()
        .from(agentRequirementSetTable)
        .where(eq(agentRequirementSetTable.projectId, project.id));
      expect(row?.deletedAt).not.toBeNull();
    });

    it("[REQ-AGENT-AUTOAPPLY-24] only a save that changes content leaves a revision, with its author and time", async () => {
      const { app, project, member } = await setup();
      const first = (await (
        await putSet(app, project.id, "spec-tabs", {
          title: "T",
          body: "# one",
          items: [{ text: "a" }],
        })
      ).json()) as SetDetail;
      let list = await revisions(
        app,
        "agent-requirement",
        project.id,
        "spec-tabs",
      );
      expect(list).toEqual([
        {
          id: expect.any(String),
          title: "T",
          createdAt: first.revisedAt,
          revertedFromId: null,
          createdBy: member.user.id,
          author: { userId: member.user.id, name: member.user.name },
          actor: null,
        },
      ]);

      // Same title and body with only an item edited: no revision, no clock move.
      await wait();
      const itemsOnly = (await (
        await putSet(app, project.id, "spec-tabs", {
          title: "T",
          body: "# one",
          items: [{ key: "REQ-SPEC-TABS-1", text: "a2" }],
        })
      ).json()) as SetDetail;
      expect(itemsOnly.revisedAt).toBe(first.revisedAt);
      expect(
        await revisions(app, "agent-requirement", project.id, "spec-tabs"),
      ).toHaveLength(1);

      // A title change is one; an agent's body change is another, newest first.
      await wait();
      await putSet(app, project.id, "spec-tabs", {
        title: "T2",
        body: "# one",
        items: [],
      });
      await wait();
      await mcpToolCall(app, "agent_requirements_put", {
        projectId: project.id,
        feature: "spec-tabs",
        title: "T2",
        body: "# two",
        ...identity,
      });
      list = await revisions(app, "agent-requirement", project.id, "spec-tabs");
      expect(list.map((r) => r.title)).toEqual(["T2", "T2", "T"]);
      expect(list[0]).toMatchObject({
        createdBy: null,
        author: null,
        actor: { model: "claude-opus-5" },
      });
      const detail = await app.request(
        `/api/agent-requirement/${project.id}/spec-tabs/revisions/${list[2]?.id}`,
      );
      expect(detail.status).toBe(200);
      expect(await detail.json()).toMatchObject({
        id: list[2]?.id,
        title: "T",
        body: "# one",
        requirementKeys: null,
      });

      // A design's content includes the requirement keys it covers.
      await putSet(app, project.id, "spec-tabs", {
        title: "T2",
        body: "# two",
        items: [{ text: "b" }],
      });
      const design = {
        title: "D",
        body: "d",
        requirementKeys: ["REQ-SPEC-TABS-1"],
      };
      await putDesign(app, project.id, "spec-tabs", design);
      await putDesign(app, project.id, "spec-tabs", design);
      expect(
        await revisions(app, "agent-design", project.id, "spec-tabs"),
      ).toHaveLength(1);
      await wait();
      await putDesign(app, project.id, "spec-tabs", {
        ...design,
        requirementKeys: ["REQ-SPEC-TABS-2", "REQ-SPEC-TABS-1"],
      });
      const designRevisions = await revisions(
        app,
        "agent-design",
        project.id,
        "spec-tabs",
      );
      expect(designRevisions).toHaveLength(2);
      const newest = await app.request(
        `/api/agent-design/${project.id}/spec-tabs/revisions/${designRevisions[0]?.id}`,
      );
      expect(await newest.json()).toMatchObject({
        body: "d",
        requirementKeys: ["REQ-SPEC-TABS-1", "REQ-SPEC-TABS-2"],
      });
      // A set's revision is not reachable through the design.
      expect(
        (
          await app.request(
            `/api/agent-design/${project.id}/spec-tabs/revisions/${list[0]?.id}`,
          )
        ).status,
      ).toBe(404);
    });

    it("[REQ-AGENT-AUTOAPPLY-26] [REQ-AGENT-AUTOAPPLY-27] [REQ-AGENT-AUTOAPPLY-29] a person's revert is a normal save: it records its source revision and makes the design stale again", async () => {
      const { app, project, member } = await setup();
      const first = (await (
        await putSet(app, project.id, "spec-tabs", {
          title: "T",
          body: "## A\n\n1. 시스템은 x 한다. `api`\n",
        })
      ).json()) as SetDetail;
      const [original] = await revisions(
        app,
        "agent-requirement",
        project.id,
        "spec-tabs",
      );
      await putDesign(app, project.id, "spec-tabs", {
        title: "D",
        body: "d",
        requirementKeys: ["REQ-SPEC-TABS-1"],
      });
      await wait();

      // An agent rewrites the criterion: the design is stale on that key.
      await mcpToolCall(app, "agent_requirements_put", {
        projectId: project.id,
        feature: "spec-tabs",
        title: "T",
        body: first.body.replace("x 한다", "y 한다"),
        ...identity,
      });
      expect(
        (await getDesign(app, project.id, "spec-tabs")).stale.causes,
      ).toEqual([
        expect.objectContaining({
          kind: "requirement",
          key: "REQ-SPEC-TABS-1",
        }),
      ]);

      // Revising the design clears it.
      await wait();
      await putDesign(app, project.id, "spec-tabs", {
        title: "D",
        body: "d, updated for y",
        requirementKeys: ["REQ-SPEC-TABS-1"],
      });
      expect((await getDesign(app, project.id, "spec-tabs")).stale).toEqual({
        stale: false,
        causes: [],
      });
      await wait();

      const setPath = `/api/agent-requirement/${project.id}/spec-tabs`;
      const reverted = await post(
        app,
        `${setPath}/revisions/${original?.id}/revert`,
      );
      expect(reverted.status, await reverted.clone().text()).toBe(200);
      const set = (await reverted.json()) as SetDetail;
      expect(set.body).toBe(first.body);
      expect(set.items[0]?.text).toBe("시스템은 x 한다.");
      expect(set).toMatchObject({
        updatedBy: member.user.id,
        reviewed: true,
        reviewedBy: member.user.id,
      });
      let list = await revisions(
        app,
        "agent-requirement",
        project.id,
        "spec-tabs",
      );
      expect(list).toHaveLength(3);
      expect(list[0]).toMatchObject({
        revertedFromId: original?.id,
        createdBy: member.user.id,
      });
      expect(
        (await getDesign(app, project.id, "spec-tabs")).stale.causes,
      ).toEqual([
        expect.objectContaining({
          kind: "requirement",
          key: "REQ-SPEC-TABS-1",
        }),
      ]);

      // Reverting to what is already there is an identical save.
      expect(
        (await post(app, `${setPath}/revisions/${list[0]?.id}/revert`)).status,
      ).toBe(200);
      list = await revisions(app, "agent-requirement", project.id, "spec-tabs");
      expect(list).toHaveLength(3);
      expect((await post(app, `${setPath}/revisions/nope/revert`)).status).toBe(
        404,
      );

      // A design reverts the same way.
      const designRevisions = await revisions(
        app,
        "agent-design",
        project.id,
        "spec-tabs",
      );
      const firstDesign = designRevisions.at(-1);
      const designReverted = await post(
        app,
        `/api/agent-design/${project.id}/spec-tabs/revisions/${firstDesign?.id}/revert`,
      );
      expect(designReverted.status, await designReverted.clone().text()).toBe(
        200,
      );
      expect(((await designReverted.json()) as Design).body).toBe("d");
      expect(
        (await revisions(app, "agent-design", project.id, "spec-tabs"))[0],
      ).toMatchObject({ revertedFromId: firstDesign?.id });
    });
  });
});
