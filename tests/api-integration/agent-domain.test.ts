import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  agentActorTable,
  agentDocumentTable,
  agentDomainTable,
  agentProjectDomainTable,
  agentTermTable,
} from "../../apps/api/src/database/schema-agent-layer";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";
import { mcpToolCall, toolJson } from "./helpers/mcp";

type App = ReturnType<typeof createApp>["app"];

type DomainNode = {
  id: string;
  parentId: string | null;
  slug: string;
  title: string;
  position: number;
  updatedAt: string;
  childCount: number;
};

type Domain = {
  id: string;
  workspaceId: string;
  parentId: string | null;
  slug: string;
  title: string;
  body: string;
  position: number;
  updatedBy: string | null;
  actorId: string | null;
  author: { userId: string; name: string } | null;
  actor: { id: string; provider: string; model: string } | null;
  createdAt: string;
  updatedAt: string;
};

type Ref = { id: string; slug: string; title: string };

type DomainPage = Domain & {
  ancestors: Ref[];
  children: Ref[];
  terms: Array<{ id: string; canonical: string; confidence: string }>;
  projects: Array<{ id: string; name: string; slug: string }>;
  documents: Array<{ id: string; projectId: string; slug: string }>;
};

const json = (body: unknown) => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const tree = (app: App, ws: string) => app.request(`/api/agent-domain/${ws}`);
const create = (app: App, ws: string, body: Record<string, unknown>) =>
  app.request(`/api/agent-domain/${ws}`, { method: "POST", ...json(body) });
const get = (app: App, ws: string, id: string) =>
  app.request(`/api/agent-domain/${ws}/${id}`);
const update = (app: App, ws: string, id: string, body: unknown) =>
  app.request(`/api/agent-domain/${ws}/${id}`, {
    method: "PUT",
    ...json(body),
  });
const move = (app: App, ws: string, id: string, body: unknown) =>
  app.request(`/api/agent-domain/${ws}/${id}/move`, {
    method: "POST",
    ...json(body),
  });
const remove = (app: App, ws: string, id: string) =>
  app.request(`/api/agent-domain/${ws}/${id}`, { method: "DELETE" });

async function created(app: App, ws: string, body: Record<string, unknown>) {
  const response = await create(app, ws, body);
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as Domain;
}

async function addUser(workspaceId: string, role: string) {
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

async function seedDomain(
  workspaceId: string,
  slug: string,
  overrides: Partial<typeof agentDomainTable.$inferInsert> = {},
) {
  const [row] = await db
    .insert(agentDomainTable)
    .values({ workspaceId, slug, title: slug, ...overrides })
    .returning();
  return row;
}

describe("API integration: agent domain pages", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rejects anonymous callers and users outside the workspace", async () => {
    const member = await createWorkspaceMember();
    const page = await seedDomain(member.workspace.id, "billing");

    mockAnonymousSession();
    const anon = createApp().app;
    expect((await tree(anon, member.workspace.id)).status).toBe(401);
    expect(
      (await create(anon, member.workspace.id, { slug: "x", title: "x" }))
        .status,
    ).toBe(401);

    const outsider = await createWorkspaceMember({ userName: "Outsider" });
    mockAuthenticatedSession(outsider.user);
    const app = createApp().app;
    for (const response of [
      await tree(app, member.workspace.id),
      await create(app, member.workspace.id, { slug: "x", title: "x" }),
      await get(app, member.workspace.id, page.id),
      await update(app, member.workspace.id, page.id, { title: "x" }),
      await move(app, member.workspace.id, page.id, { parentId: null }),
      await remove(app, member.workspace.id, page.id),
    ]) {
      expect(response.status).toBe(403);
    }
  });

  it("creates root and child pages and lists them as an ordered flat tree", async () => {
    const member = await createWorkspaceMember();
    const ws = member.workspace.id;
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    expect(await (await tree(app, ws)).json()).toEqual({ domains: [] });

    const billing = await created(app, ws, {
      slug: "billing",
      title: "Billing",
      body: "# Billing\n",
    });
    expect(billing).toMatchObject({
      workspaceId: ws,
      parentId: null,
      slug: "billing",
      title: "Billing",
      body: "# Billing\n",
      position: 0,
      updatedBy: member.user.id,
      actorId: null,
      author: { userId: member.user.id, name: member.user.name },
      actor: null,
    });

    const ops = await created(app, ws, { slug: "ops", title: "Ops" });
    expect(ops.position).toBe(1);
    expect(ops.body).toBe("");

    const refunds = await created(app, ws, {
      parentId: billing.id,
      slug: "refunds",
      title: "Refunds",
    });
    expect(refunds).toMatchObject({ parentId: billing.id, position: 0 });
    const invoices = await created(app, ws, {
      parentId: billing.id,
      slug: "invoices",
      title: "Invoices",
    });
    expect(invoices.position).toBe(1);

    const { domains } = (await (await tree(app, ws)).json()) as {
      domains: DomainNode[];
    };
    // Roots first (by position), then children grouped by parent.
    expect(domains.map((d) => [d.slug, d.parentId, d.childCount])).toEqual([
      ["billing", null, 2],
      ["ops", null, 0],
      ["refunds", billing.id, 0],
      ["invoices", billing.id, 0],
    ]);
    expect(domains[0]).not.toHaveProperty("body");
  });

  it("rejects a parent outside the workspace and a duplicate slug at the same level, but allows it elsewhere", async () => {
    const member = await createWorkspaceMember();
    const other = await createWorkspaceMember({ userName: "Other" });
    const ws = member.workspace.id;
    const foreign = await seedDomain(other.workspace.id, "foreign");
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const badParent = await create(app, ws, {
      parentId: foreign.id,
      slug: "x",
      title: "x",
    });
    expect(badParent.status).toBe(400);
    await expect(badParent.text()).resolves.toBe(
      "parentId does not belong to this workspace",
    );
    const unknownParent = await create(app, ws, {
      parentId: "nope",
      slug: "x",
      title: "x",
    });
    expect(unknownParent.status).toBe(400);

    const root = await created(app, ws, { slug: "billing", title: "Billing" });
    const dupRoot = await create(app, ws, { slug: "billing", title: "Again" });
    expect(dupRoot.status).toBe(409);
    await expect(dupRoot.text()).resolves.toContain('slug "billing"');

    // Same slug is fine one level down, and in another workspace.
    await created(app, ws, {
      parentId: root.id,
      slug: "billing",
      title: "Nested",
    });
    const dupChild = await create(app, ws, {
      parentId: root.id,
      slug: "billing",
      title: "Again",
    });
    expect(dupChild.status).toBe(409);

    mockAuthenticatedSession(other.user);
    const otherApp = createApp().app;
    await created(otherApp, other.workspace.id, {
      slug: "billing",
      title: "Theirs",
    });

    expect(await db.select().from(agentDomainTable)).toHaveLength(4);
  });

  it("validates slug, title and the 200KB body budget", async () => {
    const member = await createWorkspaceMember();
    const ws = member.workspace.id;
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    for (const bad of [
      { slug: "Bad_Slug", title: "T" },
      { slug: "-x", title: "T" },
      { slug: "a".repeat(65), title: "T" },
      { slug: "ok", title: "" },
      { slug: "ok", title: "a".repeat(201) },
      { slug: "ok", title: "T", body: "x".repeat(200 * 1024 + 1) },
      { slug: "ok", title: "T", body: "가".repeat(70 * 1024) },
    ]) {
      const response = await create(app, ws, bad);
      expect(response.status, JSON.stringify(bad).slice(0, 60)).toBe(400);
    }
    const atLimit = await create(app, ws, {
      slug: "a".repeat(64),
      title: "T",
      body: "x".repeat(200 * 1024),
    });
    expect(atLimit.status).toBe(200);

    const page = (await atLimit.json()) as Domain;
    const empty = await update(app, ws, page.id, {});
    expect(empty.status).toBe(400);
  });

  it("returns a page with author, ancestors, children and the linked terms, projects and documents", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const ws = admin.workspace.id;
    const { project } = await createProjectFixture({
      workspaceId: ws,
      name: "Billing v2",
    });
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const billing = await created(app, ws, {
      slug: "billing",
      title: "Billing",
    });
    const refunds = await created(app, ws, {
      parentId: billing.id,
      slug: "refunds",
      title: "Refunds",
    });
    const partial = await created(app, ws, {
      parentId: refunds.id,
      slug: "partial",
      title: "Partial",
    });
    const chargeback = await created(app, ws, {
      parentId: refunds.id,
      slug: "chargeback",
      title: "Chargeback",
    });

    // Link a term (propose with domainId), a document (PUT with domainId) and
    // a project (settings domainIds) — all through the public API.
    const term = await app.request("/api/agent-term", {
      method: "POST",
      ...json({ workspaceId: ws, canonical: "Refund", domainId: refunds.id }),
    });
    expect(term.status, await term.clone().text()).toBe(200);
    const doc = await app.request(
      `/api/agent-document/${project.id}/refund-flow`,
      {
        method: "PUT",
        ...json({ title: "Refund flow", body: "…", domainId: refunds.id }),
      },
    );
    expect(doc.status, await doc.clone().text()).toBe(200);
    const settings = await app.request(`/api/agent-project/${project.id}`, {
      method: "PUT",
      ...json({
        corePaths: [],
        activeTaskThreshold: 20,
        doneArchiveDays: 30,
        domainIds: [refunds.id],
      }),
    });
    expect(settings.status, await settings.clone().text()).toBe(200);

    const response = await get(app, ws, refunds.id);
    expect(response.status).toBe(200);
    const page = (await response.json()) as DomainPage;
    expect(page).toMatchObject({
      id: refunds.id,
      parentId: billing.id,
      slug: "refunds",
      author: { userId: admin.user.id, name: admin.user.name },
      actor: null,
    });
    expect(page.ancestors).toEqual([
      { id: billing.id, slug: "billing", title: "Billing" },
    ]);
    expect(page.children.map((c) => c.slug)).toEqual(["partial", "chargeback"]);
    expect(page.terms).toEqual([
      expect.objectContaining({ canonical: "Refund", confidence: "proposed" }),
    ]);
    expect(page.projects).toEqual([
      { id: project.id, name: "Billing v2", slug: project.slug },
    ]);
    expect(page.documents).toEqual([
      expect.objectContaining({ projectId: project.id, slug: "refund-flow" }),
    ]);

    // The grandchild sees the whole lineage, root first.
    const deep = (await (await get(app, ws, partial.id)).json()) as DomainPage;
    expect(deep.ancestors.map((a) => a.slug)).toEqual(["billing", "refunds"]);
    expect(deep.children).toEqual([]);
    expect(deep.terms).toEqual([]);
    void chargeback;
  });

  it("edits title and body as the human author and clears a previous agent author", async () => {
    const member = await createWorkspaceMember();
    const ws = member.workspace.id;
    const [actor] = await db
      .insert(agentActorTable)
      .values({
        workspaceId: ws,
        provider: "anthropic",
        model: "claude-opus-5",
      })
      .returning();
    const seeded = await seedDomain(ws, "billing", {
      title: "Agent draft",
      body: "agent body",
      actorId: actor.id,
      updatedAt: new Date(Date.UTC(2026, 0, 1)),
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const before = (await (await get(app, ws, seeded.id)).json()) as DomainPage;
    expect(before).toMatchObject({
      author: null,
      actor: { id: actor.id, model: "claude-opus-5" },
    });

    const titleOnly = await update(app, ws, seeded.id, { title: "Billing" });
    expect(titleOnly.status).toBe(200);
    const afterTitle = (await titleOnly.json()) as Domain;
    expect(afterTitle).toMatchObject({
      title: "Billing",
      body: "agent body",
      updatedBy: member.user.id,
      actorId: null,
      author: { userId: member.user.id },
      actor: null,
    });
    expect(new Date(afterTitle.updatedAt).getTime()).toBeGreaterThan(
      seeded.updatedAt.getTime(),
    );

    const bodyOnly = await update(app, ws, seeded.id, { body: "# Human\n" });
    expect(((await bodyOnly.json()) as Domain).body).toBe("# Human\n");

    const [row] = await db
      .select()
      .from(agentDomainTable)
      .where(eq(agentDomainTable.id, seeded.id));
    expect(row).toMatchObject({
      title: "Billing",
      body: "# Human\n",
      updatedBy: member.user.id,
      actorId: null,
    });
  });

  it("moves pages: reparent, reorder, to root; refuses cycles, self, foreign parents and slug clashes", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const other = await createWorkspaceMember({ userName: "Other" });
    const ws = admin.workspace.id;
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const a = await created(app, ws, { slug: "a", title: "A" });
    const b = await created(app, ws, { parentId: a.id, slug: "b", title: "B" });
    const c = await created(app, ws, { parentId: b.id, slug: "c", title: "C" });
    const root2 = await created(app, ws, { slug: "r", title: "R" });
    const foreign = await seedDomain(other.workspace.id, "f");

    const self = await move(app, ws, a.id, { parentId: a.id });
    expect(self.status).toBe(400);
    await expect(self.text()).resolves.toBe("A page cannot be its own parent");

    const cycle = await move(app, ws, a.id, { parentId: c.id });
    expect(cycle.status).toBe(400);
    await expect(cycle.text()).resolves.toBe(
      "A page cannot be moved under its own descendant",
    );
    const cycleDirect = await move(app, ws, a.id, { parentId: b.id });
    expect(cycleDirect.status).toBe(400);

    const foreignParent = await move(app, ws, a.id, { parentId: foreign.id });
    expect(foreignParent.status).toBe(400);
    await expect(foreignParent.text()).resolves.toBe(
      "parentId does not belong to this workspace",
    );

    // Slug clash at the target level: another root is already "a".
    const aClone = await created(app, ws, {
      parentId: root2.id,
      slug: "a",
      title: "A again",
    });
    const clash = await move(app, ws, aClone.id, { parentId: null });
    expect(clash.status).toBe(409);

    // Legal moves: c under a, then to root with a position.
    const reparent = await move(app, ws, c.id, { parentId: a.id, position: 5 });
    expect(reparent.status).toBe(200);
    expect(await reparent.json()).toMatchObject({
      parentId: a.id,
      position: 5,
    });
    const toRoot = await move(app, ws, c.id, { parentId: null });
    expect(await toRoot.json()).toMatchObject({ parentId: null, position: 5 });

    // Moving does not change authorship.
    const [row] = await db
      .select()
      .from(agentDomainTable)
      .where(eq(agentDomainTable.id, c.id));
    expect(row?.updatedBy).toBe(admin.user.id);

    const missing = await move(app, ws, "nope", { parentId: null });
    expect(missing.status).toBe(404);
    const foreignPage = await move(app, ws, foreign.id, { parentId: null });
    expect(foreignPage.status).toBe(404);
  });

  it("refuses to delete a page with children or links, listing the counts, then deletes once clear", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const ws = admin.workspace.id;
    const { project } = await createProjectFixture({ workspaceId: ws });
    mockAuthenticatedSession(admin.user);
    const { app } = createApp();

    const parent = await created(app, ws, { slug: "p", title: "P" });
    const child = await created(app, ws, {
      parentId: parent.id,
      slug: "c",
      title: "C",
    });
    const [term] = await db
      .insert(agentTermTable)
      .values({ workspaceId: ws, canonical: "T", domainId: parent.id })
      .returning();
    await db.insert(agentTermTable).values({
      workspaceId: ws,
      canonical: "T2",
      domainId: parent.id,
    });
    const [doc] = await db
      .insert(agentDocumentTable)
      .values({
        workspaceId: ws,
        projectId: project.id,
        slug: "d",
        title: "D",
        body: "",
        domainId: parent.id,
      })
      .returning();
    await db
      .insert(agentProjectDomainTable)
      .values({ projectId: project.id, domainId: parent.id });

    const blocked = await remove(app, ws, parent.id);
    expect(blocked.status).toBe(409);
    await expect(blocked.text()).resolves.toBe(
      "Domain still has 1 child page, 2 terms, 1 document, 1 project; move or unlink them first",
    );

    // Clear each link, checking the message shrinks accordingly.
    await move(app, ws, child.id, { parentId: null });
    await db.delete(agentTermTable).where(eq(agentTermTable.id, term.id));
    await db
      .update(agentTermTable)
      .set({ domainId: null })
      .where(eq(agentTermTable.canonical, "T2"));
    await db
      .update(agentDocumentTable)
      .set({ domainId: null })
      .where(eq(agentDocumentTable.id, doc.id));
    const stillProject = await remove(app, ws, parent.id);
    expect(stillProject.status).toBe(409);
    await expect(stillProject.text()).resolves.toBe(
      "Domain still has 1 project; move or unlink them first",
    );
    await db
      .delete(agentProjectDomainTable)
      .where(eq(agentProjectDomainTable.domainId, parent.id));

    const deleted = await remove(app, ws, parent.id);
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ id: parent.id, slug: "p" });
    expect((await get(app, ws, parent.id)).status).toBe(404);
    expect((await remove(app, ws, parent.id)).status).toBe(404);
    // The promoted child survives.
    expect((await get(app, ws, child.id)).status).toBe(200);
  });

  it("gates writes by permission: viewer reads only, member creates and edits, admin moves and deletes", async () => {
    const admin = await createWorkspaceMember({ role: "admin" });
    const ws = admin.workspace.id;
    const member = await addUser(ws, "member");
    const viewer = await addUser(ws, "viewer");
    const page = await seedDomain(ws, "p", { updatedBy: admin.user.id });

    mockAuthenticatedSession(viewer);
    const asViewer = createApp().app;
    expect((await tree(asViewer, ws)).status).toBe(200);
    expect((await get(asViewer, ws, page.id)).status).toBe(200);
    for (const denied of [
      await create(asViewer, ws, { slug: "v", title: "V" }),
      await update(asViewer, ws, page.id, { title: "V" }),
      await move(asViewer, ws, page.id, { parentId: null }),
      await remove(asViewer, ws, page.id),
    ]) {
      expect(denied.status).toBe(403);
      await expect(denied.text()).resolves.toBe("Insufficient permissions");
    }

    mockAuthenticatedSession(member);
    const asMember = createApp().app;
    const made = await create(asMember, ws, { slug: "m", title: "M" });
    expect(made.status).toBe(200);
    expect((await update(asMember, ws, page.id, { title: "M" })).status).toBe(
      200,
    );
    expect((await move(asMember, ws, page.id, { parentId: null })).status).toBe(
      403,
    );
    expect((await remove(asMember, ws, page.id)).status).toBe(403);

    mockAuthenticatedSession(admin.user);
    const asAdmin = createApp().app;
    const madeId = ((await made.json()) as Domain).id;
    expect(
      (await move(asAdmin, ws, madeId, { parentId: page.id })).status,
    ).toBe(200);
    expect((await remove(asAdmin, ws, madeId)).status).toBe(200);
  });

  it("scopes ids to the workspace in the path: a foreign page reads as 404", async () => {
    // Admin so the workspace:update gate on delete is passed and the 404
    // from the lookup is what shows.
    const member = await createWorkspaceMember({ role: "admin" });
    const other = await createWorkspaceMember({ userName: "Other" });
    const theirs = await seedDomain(other.workspace.id, "theirs");
    // The member is also a member of the other workspace, so access to both
    // is granted; only the path/id mismatch must block.
    await db.insert(schema.workspaceUserTable).values({
      workspaceId: other.workspace.id,
      userId: member.user.id,
      role: "admin",
      joinedAt: new Date(),
    });
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    expect((await get(app, member.workspace.id, theirs.id)).status).toBe(404);
    expect(
      (await update(app, member.workspace.id, theirs.id, { title: "x" }))
        .status,
    ).toBe(404);
    expect((await remove(app, member.workspace.id, theirs.id)).status).toBe(
      404,
    );
    // …and through the right workspace it works.
    expect((await get(app, other.workspace.id, theirs.id)).status).toBe(200);
    expect(await db.select().from(agentDomainTable)).toHaveLength(1);
  });

  it("survives a parent deleted by raw SQL by promoting the child, and cascades on workspace delete", async () => {
    const member = await createWorkspaceMember();
    const ws = member.workspace.id;
    const parent = await seedDomain(ws, "p");
    const child = await seedDomain(ws, "c", { parentId: parent.id });

    await db.delete(agentDomainTable).where(eq(agentDomainTable.id, parent.id));
    const [promoted] = await db
      .select()
      .from(agentDomainTable)
      .where(eq(agentDomainTable.id, child.id));
    expect(promoted?.parentId).toBeNull();

    await db
      .delete(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, ws));
    expect(await db.select().from(agentDomainTable)).toEqual([]);
  });

  describe("MCP path (agent_domain_put / agent_domain_get / agent_domain_list)", () => {
    const identity = { provider: "anthropic", model: "claude-opus-5" };

    function routeFetchInto(app: App) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input));
          return app.request(`${url.pathname}${url.search}`, init);
        }),
      );
    }

    it("creates and updates pages attributed to an agent actor, then reads them back by slugPath", async () => {
      const member = await createWorkspaceMember();
      const ws = member.workspace.id;
      mockAuthenticatedSession(member.user);
      const { app } = createApp();
      routeFetchInto(app);

      const root = toolJson<Domain>(
        await mcpToolCall(app, "agent_domain_put", {
          workspaceId: ws,
          slug: "billing",
          title: "Billing",
          body: "# Billing\n",
          ...identity,
        }),
      );
      expect(root).toEqual({
        id: expect.any(String),
        parentId: null,
        slug: "billing",
        title: "Billing",
        actorId: expect.any(String),
        updatedAt: expect.any(String),
      });
      const child = toolJson<Domain>(
        await mcpToolCall(app, "agent_domain_put", {
          workspaceId: ws,
          parentId: root.id,
          slug: "refunds",
          title: "Refunds",
          body: "가".repeat(4000),
          ...identity,
        }),
      );
      expect(child.parentId).toBe(root.id);

      const [row] = await db
        .select()
        .from(agentDomainTable)
        .where(eq(agentDomainTable.id, child.id));
      expect(row).toMatchObject({ updatedBy: null, actorId: child.actorId });
      const [actor] = await db
        .select()
        .from(agentActorTable)
        .where(eq(agentActorTable.id, child.actorId as string));
      expect(actor).toMatchObject({
        workspaceId: ws,
        onBehalfOf: member.user.id,
        model: "claude-opus-5",
      });

      // Update in place: same row, new body, still the agent.
      const updated = toolJson<Domain>(
        await mcpToolCall(app, "agent_domain_put", {
          workspaceId: ws,
          domainId: root.id,
          title: "Billing (v2)",
          body: "# Billing v2\n",
          ...identity,
        }),
      );
      expect(updated.id).toBe(root.id);
      expect(updated.title).toBe("Billing (v2)");

      // Human overwrite through HTTP clears the agent author.
      await update(app, ws, root.id, { body: "# Human\n" });
      const [human] = await db
        .select()
        .from(agentDomainTable)
        .where(eq(agentDomainTable.id, root.id));
      expect(human).toMatchObject({ updatedBy: member.user.id, actorId: null });

      const list = toolJson<{ domains: Array<{ slug: string }> }>(
        await mcpToolCall(app, "agent_domain_list", { workspaceId: ws }),
      );
      expect(list.domains.map((d) => d.slug)).toEqual(["billing", "refunds"]);

      const page = toolJson<Record<string, unknown>>(
        await mcpToolCall(app, "agent_domain_get", {
          workspaceId: ws,
          slugPath: "billing/refunds",
        }),
      );
      expect(page).toMatchObject({
        id: child.id,
        path: "billing/refunds",
        author: null,
        actor: "claude-opus-5",
        bodyBytes: 12_000,
        nextOffset: 8190,
        truncated: true,
        linksTotal: { children: 0, terms: 0, projects: 0, documents: 0 },
      });
      const rest = toolJson<Record<string, unknown>>(
        await mcpToolCall(app, "agent_domain_get", {
          workspaceId: ws,
          domainId: child.id,
          offset: page.nextOffset,
        }),
      );
      expect(`${page.body}${rest.body}`).toBe("가".repeat(4000));

      const missing = await mcpToolCall(app, "agent_domain_get", {
        workspaceId: ws,
        slugPath: "billing/nope",
      });
      expect(missing.isError).toBe(true);
      expect(toolJson(missing)).toEqual({
        error: "404 No page at billing/nope",
      });
    });

    it("enforces workspace access and task:update on the in-process path", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      const ws = admin.workspace.id;
      const args = {
        workspaceId: ws,
        slug: "blocked",
        title: "Blocked",
        body: "x",
        ...identity,
      };

      const outsider = await createWorkspaceMember({ userName: "Outsider" });
      mockAuthenticatedSession(outsider.user);
      const denied = await mcpToolCall(
        createApp().app,
        "agent_domain_put",
        args,
      );
      expect(toolJson(denied)).toEqual({
        error: "403 You don't have access to this workspace",
      });

      const viewer = await addUser(ws, "viewer");
      mockAuthenticatedSession(viewer);
      const forbidden = await mcpToolCall(
        createApp().app,
        "agent_domain_put",
        args,
      );
      expect(toolJson(forbidden)).toEqual({
        error: "403 Insufficient permissions",
      });
      expect(await db.select().from(agentActorTable)).toEqual([]);

      mockAuthenticatedSession(admin.user);
      const dup = createApp().app;
      await mcpToolCall(dup, "agent_domain_put", args);
      const conflict = await mcpToolCall(dup, "agent_domain_put", args);
      expect(conflict.isError).toBe(true);
      expect(toolJson(conflict).error).toContain("409");
      expect(await db.select().from(agentDomainTable)).toHaveLength(1);
    });
  });

  it("documents the routes and the page component", async () => {
    const { app } = createApp();
    const spec = (await (await app.request("/api/openapi")).json()) as {
      paths: Record<string, Record<string, { operationId?: string }>>;
      components: {
        schemas: Record<string, { properties?: Record<string, unknown> }>;
      };
    };
    expect(spec.paths["/agent-domain/{workspaceId}"]?.get?.operationId).toBe(
      "listAgentDomains",
    );
    expect(spec.paths["/agent-domain/{workspaceId}"]?.post?.operationId).toBe(
      "createAgentDomain",
    );
    const page = spec.paths["/agent-domain/{workspaceId}/{domainId}"];
    expect(page?.get?.operationId).toBe("getAgentDomain");
    expect(page?.put?.operationId).toBe("updateAgentDomain");
    expect(page?.delete?.operationId).toBe("deleteAgentDomain");
    expect(
      spec.paths["/agent-domain/{workspaceId}/{domainId}/move"]?.post
        ?.operationId,
    ).toBe("moveAgentDomain");
    expect(
      spec.paths["/agent-term/{workspaceId}/{termId}/domain"]?.patch
        ?.operationId,
    ).toBe("setAgentTermDomain");
    // The page schema extends the registered `AgentDomain` component, so the
    // generator emits it as allOf [$ref, {properties}]; check by content.
    const pageSchema = JSON.stringify(spec.components.schemas.AgentDomainPage);
    for (const key of [
      "ancestors",
      "children",
      "terms",
      "projects",
      "documents",
    ]) {
      expect(pageSchema, key).toContain(`"${key}"`);
    }
    expect(
      Object.keys(spec.components.schemas.AgentDomain?.properties ?? {}),
    ).toEqual(
      expect.arrayContaining(["author", "actor", "updatedBy", "actorId"]),
    );
  });
});
