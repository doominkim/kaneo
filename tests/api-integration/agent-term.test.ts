import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  agentActorTable,
  agentDomainTable,
  agentEntryTable,
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

type Term = {
  id: string;
  canonical: string;
  definition: string | null;
  aliases: string[];
  notToConfuseWith: string[];
  anchors: unknown;
  confidence: string;
  state: string;
  supersededBy: string | null;
  domainId: string | null;
  actorId: string | null;
  actor: {
    id: string;
    provider: string;
    model: string;
    onBehalfOf: string | null;
  } | null;
  reviewerId: string | null;
  reviewer: { userId: string; name: string } | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
};

type TermList = { terms: Term[] };
type Resolution = {
  match: "canonical" | "alias" | "none";
  term: Term | null;
  ambiguous: Term[];
};

function propose(
  app: ReturnType<typeof createApp>["app"],
  body: Record<string, unknown>,
) {
  return app.request("/api/agent-term", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function confirm(
  app: ReturnType<typeof createApp>["app"],
  workspaceId: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/agent-term/${workspaceId}/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function resolve(
  app: ReturnType<typeof createApp>["app"],
  workspaceId: string,
  term: string,
  projectId?: string,
) {
  const query = new URLSearchParams({ term });
  if (projectId) query.set("projectId", projectId);
  return app.request(`/api/agent-term/${workspaceId}/resolve?${query}`);
}

/**
 * A real ledger entry: an agent proposal has to cite one and the FK is
 * enforced, so a made-up id would fail on the constraint rather than on the
 * rule under test. The project exists only to hang the entry on.
 */
async function seedSourceEntry(workspaceId: string) {
  const { project } = await createProjectFixture({ workspaceId });
  const [entry] = await db
    .insert(agentEntryTable)
    .values({
      workspaceId,
      projectId: project.id,
      summary: "Investigated how a claim is held",
    })
    .returning();
  return { project, entry };
}

describe("API integration: agent terms", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects unauthenticated proposals", async () => {
    mockAnonymousSession();
    const { app } = createApp();

    const response = await propose(app, {
      workspaceId: "workspace-missing",
      canonical: "Lease",
    });

    expect(response.status).toBe(401);
  });

  it("proposes a term as proposed/active and persists it", async () => {
    const member = await createWorkspaceMember();

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await propose(app, {
      workspaceId: member.workspace.id,
      canonical: "Ledger",
      definition: "The append-only agent work record",
      aliases: ["agent_entry", "work log"],
      notToConfuseWith: ["Activity"],
      anchors: [{ kind: "db", table: "agent_entry" }],
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as Term;

    expect(payload).toMatchObject({
      canonical: "Ledger",
      definition: "The append-only agent work record",
      aliases: ["agent_entry", "work log"],
      notToConfuseWith: ["Activity"],
      confidence: "proposed",
      state: "active",
      supersededBy: null,
      domainId: null,
      // No provider/model on the request: a person proposed this.
      actorId: null,
      actor: null,
      // Proposing is not reviewing, even when a person does it.
      reviewerId: null,
      reviewer: null,
      reviewedAt: null,
      rejectReason: null,
      lastVerifiedAt: null,
    });
    expect(payload.anchors).toEqual([{ kind: "db", table: "agent_entry" }]);

    const [persisted] = await db
      .select()
      .from(agentTermTable)
      .where(eq(agentTermTable.id, payload.id));

    expect(persisted).toMatchObject({
      workspaceId: member.workspace.id,
      canonical: "Ledger",
      confidence: "proposed",
      state: "active",
      ownerId: member.user.id,
      actorId: null,
      accessCount: 0,
    });
  });

  it("records the proposing model when an agent proposes, and keeps it through list, resolve and review", async () => {
    // Admin, because the review step at the end needs workspace:update.
    const member = await createWorkspaceMember({ role: "admin" });
    const { entry } = await seedSourceEntry(member.workspace.id);
    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    // agent_term_propose reaches the API over HTTP rather than in-process, so
    // its fetch is routed back into this app instance.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        return app.request(`${url.pathname}${url.search}`, init);
      }),
    );
    const proposed = toolJson<Term>(
      await mcpToolCall(app, "agent_term_propose", {
        workspaceId: member.workspace.id,
        canonical: "Lease",
        definition: "A soft claim on a task",
        aliases: ["agent_lease"],
        provider: "anthropic",
        model: "claude-fable-5-1",
        sourceEntryId: entry.id,
      }),
    );

    const expectedActor = {
      id: expect.any(String),
      provider: "anthropic",
      model: "claude-fable-5-1",
      onBehalfOf: member.user.id,
    };
    expect(proposed).toMatchObject({
      canonical: "Lease",
      confidence: "proposed",
      actorId: expect.any(String),
      actor: expectedActor,
    });

    // The actor row is resolved server-side as (workspace, caller, model),
    // exactly as the ledger does it — the caller never names an actor id.
    const [actor] = await db
      .select()
      .from(agentActorTable)
      .where(eq(agentActorTable.id, proposed.actorId as string));
    expect(actor).toMatchObject({
      workspaceId: member.workspace.id,
      onBehalfOf: member.user.id,
      provider: "anthropic",
      model: "claude-fable-5-1",
    });
    // `ownerId` is NOT cleared: the proposal still happened on a human's
    // authority, and the reviewer needs both halves.
    const [row] = await db
      .select()
      .from(agentTermTable)
      .where(eq(agentTermTable.id, proposed.id));
    expect(row).toMatchObject({
      ownerId: member.user.id,
      actorId: proposed.actorId,
    });

    const listed = (await (
      await app.request(`/api/agent-term/${member.workspace.id}`)
    ).json()) as TermList;
    expect(listed.terms[0]).toMatchObject({
      actorId: proposed.actorId,
      actor: expectedActor,
    });

    // A review records the outcome without erasing who proposed it, and adds
    // the person who ruled on it.
    const reviewed = (await (
      await confirm(app, member.workspace.id, {
        termId: proposed.id,
        confidence: "confirmed",
      })
    ).json()) as Term;
    expect(reviewed).toMatchObject({
      confidence: "confirmed",
      actorId: proposed.actorId,
      actor: expectedActor,
      reviewerId: member.user.id,
      reviewer: { userId: member.user.id, name: member.user.name },
    });
    expect(reviewed.reviewedAt).not.toBeNull();

    // Only now does it resolve, and both halves survive the round trip.
    const resolved = (await (
      await resolve(app, member.workspace.id, "agent_lease")
    ).json()) as Resolution;
    expect(resolved.match).toBe("alias");
    expect(resolved.term).toMatchObject({
      actorId: proposed.actorId,
      actor: expectedActor,
      reviewer: { userId: member.user.id, name: member.user.name },
    });
  });

  it("defaults the optional list fields to empty arrays", async () => {
    const member = await createWorkspaceMember();

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const payload = (await (
      await propose(app, {
        workspaceId: member.workspace.id,
        canonical: "Lease",
      })
    ).json()) as Term;

    expect(payload).toMatchObject({
      canonical: "Lease",
      definition: null,
      aliases: [],
      notToConfuseWith: [],
      confidence: "proposed",
    });
    expect(payload.anchors).toEqual([]);
  });

  describe("domain filing", () => {
    async function seedDomain(workspaceId: string, slug: string) {
      const [row] = await db
        .insert(agentDomainTable)
        .values({ workspaceId, slug, title: slug })
        .returning();
      return row;
    }

    it("files a term under a workspace page on propose, and refuses a foreign page", async () => {
      const member = await createWorkspaceMember();
      const other = await createWorkspaceMember({ userName: "Other" });
      const page = await seedDomain(member.workspace.id, "billing");
      const foreign = await seedDomain(other.workspace.id, "foreign");

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const denied = await propose(app, {
        workspaceId: member.workspace.id,
        canonical: "Refund",
        domainId: foreign.id,
      });
      expect(denied.status).toBe(400);
      await expect(denied.text()).resolves.toBe(
        "domainId does not belong to this workspace",
      );
      expect(await db.select().from(agentTermTable)).toEqual([]);

      const filed = await propose(app, {
        workspaceId: member.workspace.id,
        canonical: "Refund",
        domainId: page.id,
      });
      expect(filed.status).toBe(200);
      expect(((await filed.json()) as Term).domainId).toBe(page.id);

      // Deleting the page unfiles the term rather than deleting it.
      await db.delete(agentDomainTable).where(eq(agentDomainTable.id, page.id));
      const [row] = await db.select().from(agentTermTable);
      expect(row).toMatchObject({ canonical: "Refund", domainId: null });
    });

    it("PATCH /domain files and unfiles for workspace:update only, workspace-scoped", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      const other = await createWorkspaceMember({ userName: "Other" });
      const page = await seedDomain(admin.workspace.id, "billing");
      const foreign = await seedDomain(other.workspace.id, "foreign");
      const [term] = await db
        .insert(agentTermTable)
        .values({ workspaceId: admin.workspace.id, canonical: "Refund" })
        .returning();
      const [theirs] = await db
        .insert(agentTermTable)
        .values({ workspaceId: other.workspace.id, canonical: "Theirs" })
        .returning();
      const patch = (
        app: ReturnType<typeof createApp>["app"],
        termId: string,
        domainId: string | null,
      ) =>
        app.request(`/api/agent-term/${admin.workspace.id}/${termId}/domain`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ domainId }),
        });

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
      expect((await patch(asMember, term.id, page.id)).status).toBe(403);

      mockAuthenticatedSession(admin.user);
      const asAdmin = createApp().app;
      expect((await patch(asAdmin, term.id, foreign.id)).status).toBe(400);
      expect((await patch(asAdmin, "nope", page.id)).status).toBe(404);
      expect((await patch(asAdmin, theirs.id, page.id)).status).toBe(404);

      const filed = await patch(asAdmin, term.id, page.id);
      expect(filed.status).toBe(200);
      expect((await filed.json()) as Term).toMatchObject({
        id: term.id,
        domainId: page.id,
        confidence: "proposed",
      });
      const unfiled = await patch(asAdmin, term.id, null);
      expect(((await unfiled.json()) as Term).domainId).toBeNull();

      const [foreignRow] = await db
        .select()
        .from(agentTermTable)
        .where(eq(agentTermTable.id, theirs.id));
      expect(foreignRow?.domainId).toBeNull();
    });
  });

  it("rejects a duplicate canonical name in the same workspace", async () => {
    const member = await createWorkspaceMember();

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    await propose(app, {
      workspaceId: member.workspace.id,
      canonical: "Ledger",
    });
    const duplicate = await propose(app, {
      workspaceId: member.workspace.id,
      canonical: "Ledger",
    });

    expect(duplicate.status).toBe(409);
    await expect(duplicate.text()).resolves.toBe("Term already exists: Ledger");

    const rows = await db
      .select()
      .from(agentTermTable)
      .where(eq(agentTermTable.workspaceId, member.workspace.id));
    expect(rows).toHaveLength(1);
  });

  it("rejects proposals from users outside the workspace", async () => {
    const member = await createWorkspaceMember();
    const outsiderId = `user-${randomUUID()}`;
    const [outsider] = await db
      .insert(schema.userTable)
      .values({
        id: outsiderId,
        email: `${outsiderId}@example.com`,
        emailVerified: true,
        name: "Term Outsider",
      })
      .returning();

    mockAuthenticatedSession(outsider);
    const { app } = createApp();

    const response = await propose(app, {
      workspaceId: member.workspace.id,
      canonical: "Forbidden",
    });

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe(
      "You don't have access to this workspace",
    );

    const rows = await db
      .select()
      .from(agentTermTable)
      .where(eq(agentTermTable.canonical, "Forbidden"));
    expect(rows).toHaveLength(0);
  });

  it("blocks a viewer from proposing (task:update required)", async () => {
    const member = await createWorkspaceMember({ role: "viewer" });

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const response = await propose(app, {
      workspaceId: member.workspace.id,
      canonical: "Blocked",
    });

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe("Insufficient permissions");
  });

  describe("listing", () => {
    async function seedTerms(workspaceId: string) {
      await db.insert(agentTermTable).values([
        {
          workspaceId,
          canonical: "Zeta",
          aliases: [],
          notToConfuseWith: [],
          anchors: [],
          confidence: "proposed",
          state: "active",
        },
        {
          workspaceId,
          canonical: "Alpha",
          aliases: [],
          notToConfuseWith: [],
          anchors: [],
          confidence: "confirmed",
          state: "active",
        },
        {
          workspaceId,
          canonical: "Mid",
          aliases: [],
          notToConfuseWith: [],
          anchors: [],
          confidence: "proposed",
          state: "retired",
        },
      ]);
    }

    it("returns workspace terms alphabetically", async () => {
      const member = await createWorkspaceMember();
      await seedTerms(member.workspace.id);

      const otherWorkspace = await createWorkspaceMember();
      await db.insert(agentTermTable).values({
        workspaceId: otherWorkspace.workspace.id,
        canonical: "Aardvark",
        aliases: [],
        notToConfuseWith: [],
        anchors: [],
      });

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(
        `/api/agent-term/${member.workspace.id}`,
      );
      expect(response.status).toBe(200);

      const payload = (await response.json()) as TermList;
      expect(payload.terms.map((term) => term.canonical)).toEqual([
        "Alpha",
        "Mid",
        "Zeta",
      ]);
    });

    it("filters by confidence and state and honours limit", async () => {
      const member = await createWorkspaceMember();
      await seedTerms(member.workspace.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const proposed = (await (
        await app.request(
          `/api/agent-term/${member.workspace.id}?confidence=proposed`,
        )
      ).json()) as TermList;
      expect(proposed.terms.map((term) => term.canonical)).toEqual([
        "Mid",
        "Zeta",
      ]);

      const retired = (await (
        await app.request(
          `/api/agent-term/${member.workspace.id}?state=retired`,
        )
      ).json()) as TermList;
      expect(retired.terms.map((term) => term.canonical)).toEqual(["Mid"]);

      const limited = (await (
        await app.request(`/api/agent-term/${member.workspace.id}?limit=1`)
      ).json()) as TermList;
      expect(limited.terms).toHaveLength(1);
      expect(limited.terms[0]?.canonical).toBe("Alpha");
    });

    it("filters by domainId, by the `none` sentinel, and combines with confidence", async () => {
      const member = await createWorkspaceMember();
      const ws = member.workspace.id;
      const [billing] = await db
        .insert(agentDomainTable)
        .values({ workspaceId: ws, slug: "billing", title: "Billing" })
        .returning();
      const [ops] = await db
        .insert(agentDomainTable)
        .values({ workspaceId: ws, slug: "ops", title: "Ops" })
        .returning();
      await db.insert(agentTermTable).values([
        { workspaceId: ws, canonical: "Filed", domainId: billing.id },
        {
          workspaceId: ws,
          canonical: "FiledConfirmed",
          domainId: billing.id,
          confidence: "confirmed",
        },
        { workspaceId: ws, canonical: "Elsewhere", domainId: ops.id },
        { workspaceId: ws, canonical: "Loose" },
        {
          workspaceId: ws,
          canonical: "LooseConfirmed",
          confidence: "confirmed",
        },
      ]);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();
      const list = async (query: string) => {
        const response = await app.request(
          `/api/agent-term/${ws}${query ? `?${query}` : ""}`,
        );
        expect(response.status, await response.clone().text()).toBe(200);
        return ((await response.json()) as TermList).terms.map(
          (term) => term.canonical,
        );
      };

      await expect(list("")).resolves.toEqual([
        "Elsewhere",
        "Filed",
        "FiledConfirmed",
        "Loose",
        "LooseConfirmed",
      ]);
      await expect(list(`domainId=${billing.id}`)).resolves.toEqual([
        "Filed",
        "FiledConfirmed",
      ]);
      await expect(list("domainId=none")).resolves.toEqual([
        "Loose",
        "LooseConfirmed",
      ]);
      // Empty is unspecified, the same as omitting it.
      await expect(list("domainId=")).resolves.toEqual([
        "Elsewhere",
        "Filed",
        "FiledConfirmed",
        "Loose",
        "LooseConfirmed",
      ]);
      await expect(
        list(`domainId=${billing.id}&confidence=confirmed`),
      ).resolves.toEqual(["FiledConfirmed"]);
      await expect(list("domainId=none&confidence=proposed")).resolves.toEqual([
        "Loose",
      ]);
    });

    it("rejects a domainId that is unknown or from another workspace", async () => {
      const member = await createWorkspaceMember();
      const other = await createWorkspaceMember({ userName: "Other" });
      const [foreign] = await db
        .insert(agentDomainTable)
        .values({
          workspaceId: other.workspace.id,
          slug: "foreign",
          title: "Foreign",
        })
        .returning();

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      for (const domainId of [foreign.id, "no-such-page"]) {
        const response = await app.request(
          `/api/agent-term/${member.workspace.id}?domainId=${domainId}`,
        );
        expect(response.status).toBe(400);
        await expect(response.text()).resolves.toBe(
          "domainId does not belong to this workspace",
        );
      }
    });

    it("rejects an unknown confidence filter", async () => {
      const member = await createWorkspaceMember();

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(
        `/api/agent-term/${member.workspace.id}?confidence=maybe`,
      );

      expect(response.status).toBe(400);
    });

    it("rejects listing for users outside the workspace", async () => {
      const member = await createWorkspaceMember();
      const outsider = await createWorkspaceMember();

      mockAuthenticatedSession(outsider.user);
      const { app } = createApp();

      const response = await app.request(
        `/api/agent-term/${member.workspace.id}`,
      );

      expect(response.status).toBe(403);
      await expect(response.text()).resolves.toBe(
        "You don't have access to this workspace",
      );
    });
  });

  describe("resolving", () => {
    it("matches a canonical name case-insensitively and counts the access", async () => {
      const member = await createWorkspaceMember();
      const [term] = await db
        .insert(agentTermTable)
        .values({
          workspaceId: member.workspace.id,
          canonical: "Ledger",
          definition: "the append-only record",
          aliases: ["agent_entry"],
          notToConfuseWith: ["Activity"],
          anchors: [],
          confidence: "confirmed",
        })
        .returning();

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(
        `/api/agent-term/${member.workspace.id}/resolve?term=${encodeURIComponent(
          "  lEDGER  ",
        )}`,
      );

      expect(response.status).toBe(200);
      const payload = (await response.json()) as Resolution;

      expect(payload.match).toBe("canonical");
      expect(payload.term).toMatchObject({
        id: term.id,
        canonical: "Ledger",
        aliases: ["agent_entry"],
        notToConfuseWith: ["Activity"],
      });
      expect(payload.ambiguous).toEqual([]);

      const [persisted] = await db
        .select()
        .from(agentTermTable)
        .where(eq(agentTermTable.id, term.id));
      expect(persisted?.accessCount).toBe(1);
      expect(persisted?.lastAccessedAt).not.toBeNull();
    });

    it("matches an alias exactly", async () => {
      const member = await createWorkspaceMember();
      const [term] = await db
        .insert(agentTermTable)
        .values({
          workspaceId: member.workspace.id,
          canonical: "Ledger",
          aliases: ["agent_entry"],
          notToConfuseWith: [],
          anchors: [],
          confidence: "confirmed",
        })
        .returning();

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const payload = (await (
        await app.request(
          `/api/agent-term/${member.workspace.id}/resolve?term=agent_entry`,
        )
      ).json()) as Resolution;

      expect(payload.match).toBe("alias");
      expect(payload.term?.id).toBe(term.id);
      expect(payload.ambiguous).toEqual([]);
    });

    // agent-term/schema.ts documents aliases as "matched against canonical names
    // and aliases exactly (case- and space-normalised)", so the alias branch
    // must not be a case-sensitive jsonb containment.
    it("matches an alias case-insensitively as documented", async () => {
      const member = await createWorkspaceMember();
      const [term] = await db
        .insert(agentTermTable)
        .values({
          workspaceId: member.workspace.id,
          canonical: "Ledger",
          aliases: ["Agent_Entry"],
          notToConfuseWith: [],
          anchors: [],
          confidence: "confirmed",
        })
        .returning();

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const payload = (await (
        await app.request(
          `/api/agent-term/${member.workspace.id}/resolve?term=agent_entry`,
        )
      ).json()) as Resolution;

      expect(payload.match).toBe("alias");
      expect(payload.term?.id).toBe(term.id);
    });

    it("returns match=none for an unknown term", async () => {
      const member = await createWorkspaceMember();

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(
        `/api/agent-term/${member.workspace.id}/resolve?term=nothing-here`,
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        match: "none",
        term: null,
        ambiguous: [],
      });
    });

    it("does not resolve across workspaces", async () => {
      const member = await createWorkspaceMember();
      const otherWorkspace = await createWorkspaceMember();
      await db.insert(agentTermTable).values({
        workspaceId: otherWorkspace.workspace.id,
        canonical: "Ledger",
        aliases: [],
        notToConfuseWith: [],
        anchors: [],
        // Confirmed, so the miss proves the workspace scope rather than the
        // review gate.
        confidence: "confirmed",
      });

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const payload = (await (
        await app.request(
          `/api/agent-term/${member.workspace.id}/resolve?term=Ledger`,
        )
      ).json()) as Resolution;

      expect(payload.match).toBe("none");
    });

    it("reports every candidate when one input matches several terms", async () => {
      const member = await createWorkspaceMember();
      await db.insert(agentTermTable).values([
        {
          workspaceId: member.workspace.id,
          canonical: "Lease",
          aliases: [],
          notToConfuseWith: [],
          anchors: [],
          confidence: "confirmed",
        },
        {
          workspaceId: member.workspace.id,
          canonical: "Claim",
          aliases: ["Lease"],
          notToConfuseWith: [],
          anchors: [],
          confidence: "confirmed",
        },
      ]);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const payload = (await (
        await app.request(
          `/api/agent-term/${member.workspace.id}/resolve?term=Lease`,
        )
      ).json()) as Resolution;

      expect(payload.match).toBe("canonical");
      expect(payload.term?.canonical).toBe("Lease");
      expect(payload.ambiguous.map((term) => term.canonical).sort()).toEqual([
        "Claim",
        "Lease",
      ]);
    });

    it("still returns a retired term as a tombstone", async () => {
      const member = await createWorkspaceMember();
      const [superseding] = await db
        .insert(agentTermTable)
        .values({
          workspaceId: member.workspace.id,
          canonical: "Ledger",
          aliases: [],
          notToConfuseWith: [],
          anchors: [],
          confidence: "confirmed",
        })
        .returning();
      await db.insert(agentTermTable).values({
        workspaceId: member.workspace.id,
        canonical: "Journal",
        aliases: [],
        notToConfuseWith: [],
        anchors: [],
        state: "retired",
        // A tombstone still has to have been confirmed; `state` and
        // `confidence` are independent axes.
        confidence: "confirmed",
        supersededBy: superseding.id,
      });

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const payload = (await (
        await app.request(
          `/api/agent-term/${member.workspace.id}/resolve?term=Journal`,
        )
      ).json()) as Resolution;

      expect(payload.match).toBe("canonical");
      expect(payload.term).toMatchObject({
        canonical: "Journal",
        state: "retired",
        supersededBy: superseding.id,
      });
    });

    it("rejects an empty term query", async () => {
      const member = await createWorkspaceMember();

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(
        `/api/agent-term/${member.workspace.id}/resolve?term=`,
      );

      expect(response.status).toBe(400);
    });

    /**
     * A projectId nobody can match used to narrow the answer to the unfiled
     * terms and return 200, so a typo read exactly like "this workspace has
     * never defined that word". The scope is either real or the request is
     * wrong; there is no third answer worth returning.
     */
    it("rejects an unknown projectId and one from another workspace", async () => {
      const member = await createWorkspaceMember();
      const other = await createWorkspaceMember();
      const foreign = await createProjectFixture({
        workspaceId: other.workspace.id,
      });
      await db.insert(agentTermTable).values({
        workspaceId: member.workspace.id,
        canonical: "Ledger",
        confidence: "confirmed",
      });

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const unknown = await resolve(
        app,
        member.workspace.id,
        "Ledger",
        "project-missing",
      );
      expect(unknown.status).toBe(400);
      await expect(unknown.text()).resolves.toBe(
        "projectId does not belong to this workspace",
      );

      const crossWorkspace = await resolve(
        app,
        member.workspace.id,
        "Ledger",
        foreign.project.id,
      );
      expect(crossWorkspace.status).toBe(400);

      // Nothing was counted as a retrieval: the lookup never ran.
      const [term] = await db
        .select()
        .from(agentTermTable)
        .where(eq(agentTermTable.workspaceId, member.workspace.id));
      expect(term?.accessCount).toBe(0);
    });

    it("treats an empty projectId as no narrowing at all", async () => {
      const member = await createWorkspaceMember();
      await db.insert(agentTermTable).values({
        workspaceId: member.workspace.id,
        canonical: "Ledger",
        confidence: "confirmed",
      });

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await app.request(
        `/api/agent-term/${member.workspace.id}/resolve?term=Ledger&projectId=`,
      );

      expect(response.status).toBe(200);
      expect(((await response.json()) as Resolution).match).toBe("canonical");
    });

    it("resolves with a projectId that does belong to the workspace", async () => {
      const member = await createWorkspaceMember();
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      await db.insert(agentTermTable).values({
        workspaceId: member.workspace.id,
        canonical: "Ledger",
        confidence: "confirmed",
      });

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await resolve(
        app,
        member.workspace.id,
        "Ledger",
        project.id,
      );

      expect(response.status).toBe(200);
      expect(((await response.json()) as Resolution).match).toBe("canonical");
    });

    it("rejects resolving for users outside the workspace", async () => {
      const member = await createWorkspaceMember();
      const outsider = await createWorkspaceMember();

      mockAuthenticatedSession(outsider.user);
      const { app } = createApp();

      const response = await app.request(
        `/api/agent-term/${member.workspace.id}/resolve?term=Ledger`,
      );

      expect(response.status).toBe(403);
      await expect(response.text()).resolves.toBe(
        "You don't have access to this workspace",
      );
    });
  });

  describe("confirming", () => {
    async function seedProposedTerm(workspaceId: string) {
      const [term] = await db
        .insert(agentTermTable)
        .values({
          workspaceId,
          canonical: "Ledger",
          aliases: [],
          notToConfuseWith: [],
          anchors: [],
          confidence: "proposed",
        })
        .returning();
      return term;
    }

    it("blocks a member without workspace:update", async () => {
      const member = await createWorkspaceMember({ role: "member" });
      const term = await seedProposedTerm(member.workspace.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await confirm(app, member.workspace.id, {
        termId: term.id,
        confidence: "confirmed",
      });

      expect(response.status).toBe(403);
      await expect(response.text()).resolves.toBe("Insufficient permissions");

      const [persisted] = await db
        .select()
        .from(agentTermTable)
        .where(eq(agentTermTable.id, term.id));
      expect(persisted?.confidence).toBe("proposed");
    });

    it("confirms for an admin and stamps lastVerifiedAt", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const term = await seedProposedTerm(member.workspace.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await confirm(app, member.workspace.id, {
        termId: term.id,
        confidence: "confirmed",
      });

      expect(response.status).toBe(200);
      const payload = (await response.json()) as Term;

      expect(payload).toMatchObject({
        id: term.id,
        canonical: "Ledger",
        confidence: "confirmed",
        // The reviewer comes from the session, never from the body.
        reviewerId: member.user.id,
        reviewer: { userId: member.user.id, name: member.user.name },
      });
      expect(payload.lastVerifiedAt).not.toBeNull();
      expect(payload.reviewedAt).not.toBeNull();

      const [persisted] = await db
        .select()
        .from(agentTermTable)
        .where(eq(agentTermTable.id, term.id));
      expect(persisted?.confidence).toBe("confirmed");
      expect(persisted?.lastVerifiedAt).not.toBeNull();
      expect(persisted?.reviewerId).toBe(member.user.id);
      expect(persisted?.reviewedAt).not.toBeNull();
    });

    it("records a disputed review outcome", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const term = await seedProposedTerm(member.workspace.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const payload = (await (
        await confirm(app, member.workspace.id, {
          termId: term.id,
          confidence: "disputed",
          rejectReason: "The team uses this name for two different things",
        })
      ).json()) as Term;

      expect(payload.confidence).toBe("disputed");
      expect(payload.rejectReason).toBe(
        "The team uses this name for two different things",
      );
    });

    it("rejects a confidence value outside the review vocabulary", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const term = await seedProposedTerm(member.workspace.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await confirm(app, member.workspace.id, {
        termId: term.id,
        confidence: "proposed",
      });

      expect(response.status).toBe(400);
    });

    it("returns 404 for an unknown term", async () => {
      const member = await createWorkspaceMember({ role: "admin" });

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await confirm(app, member.workspace.id, {
        termId: "term-does-not-exist",
        confidence: "confirmed",
      });

      expect(response.status).toBe(404);
      await expect(response.text()).resolves.toBe("Term not found");
    });

    it("returns 404 for a term that belongs to another workspace", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const otherWorkspace = await createWorkspaceMember();
      const foreignTerm = await seedProposedTerm(otherWorkspace.workspace.id);

      mockAuthenticatedSession(member.user);
      const { app } = createApp();

      const response = await confirm(app, member.workspace.id, {
        termId: foreignTerm.id,
        confidence: "confirmed",
      });

      expect(response.status).toBe(404);

      const [persisted] = await db
        .select()
        .from(agentTermTable)
        .where(eq(agentTermTable.id, foreignTerm.id));
      expect(persisted?.confidence).toBe("proposed");
    });
  });

  /**
   * The gate itself: a term is invisible to resolve until a person has ruled on
   * it. Everything here is about what a later session can read back, which is
   * the loop the gate exists to break — a model proposes an inferred
   * definition, the next session resolves it, and the guess returns wearing the
   * authority of a record.
   */
  describe("the human review gate", () => {
    async function admin() {
      const member = await createWorkspaceMember({ role: "admin" });
      mockAuthenticatedSession(member.user);
      return { member, app: createApp().app };
    }

    it("hides a proposed term from resolve, reveals it once confirmed, and hides it again when disputed", async () => {
      const { member, app } = await admin();

      const proposed = (await (
        await propose(app, {
          workspaceId: member.workspace.id,
          canonical: "Ledger",
          definition: "The append-only agent work record",
          aliases: ["agent_entry"],
        })
      ).json()) as Term;

      // (a) Proposed: the word exists, but resolve will not vouch for it, by
      // canonical name or by alias.
      for (const input of ["Ledger", "agent_entry"]) {
        const payload = (await (
          await resolve(app, member.workspace.id, input)
        ).json()) as Resolution;
        expect(payload, input).toEqual({
          match: "none",
          term: null,
          ambiguous: [],
        });
      }

      // (b) Confirmed: now it answers.
      await confirm(app, member.workspace.id, {
        termId: proposed.id,
        confidence: "confirmed",
      });
      const confirmed = (await (
        await resolve(app, member.workspace.id, "Ledger")
      ).json()) as Resolution;
      expect(confirmed.match).toBe("canonical");
      expect(confirmed.term).toMatchObject({
        id: proposed.id,
        confidence: "confirmed",
        reviewerId: member.user.id,
        rejectReason: null,
      });

      // (c) Disputed: rejected is not a weaker yes. It goes back to silence.
      await confirm(app, member.workspace.id, {
        termId: proposed.id,
        confidence: "disputed",
        rejectReason: "Two different things are called this",
      });
      const disputed = (await (
        await resolve(app, member.workspace.id, "Ledger")
      ).json()) as Resolution;
      expect(disputed.match).toBe("none");
      expect(disputed.term).toBeNull();
    });

    it("(d) refuses a disputed review with no reason, and (e) replays that reason on the next proposal of the same name", async () => {
      const { member, app } = await admin();
      const term = (await (
        await propose(app, {
          workspaceId: member.workspace.id,
          canonical: "Ledger",
        })
      ).json()) as Term;

      const unexplained = await confirm(app, member.workspace.id, {
        termId: term.id,
        confidence: "disputed",
      });
      expect(unexplained.status).toBe(400);
      await expect(unexplained.text()).resolves.toBe(
        "rejectReason: rejectReason is required when the outcome is disputed",
      );
      const [untouched] = await db
        .select()
        .from(agentTermTable)
        .where(eq(agentTermTable.id, term.id));
      expect(untouched).toMatchObject({
        confidence: "proposed",
        reviewerId: null,
        rejectReason: null,
      });

      const rejected = (await (
        await confirm(app, member.workspace.id, {
          termId: term.id,
          confidence: "disputed",
          rejectReason: "Two different things are called this",
        })
      ).json()) as Term;
      expect(rejected).toMatchObject({
        confidence: "disputed",
        rejectReason: "Two different things are called this",
        reviewerId: member.user.id,
        reviewer: { userId: member.user.id, name: member.user.name },
      });

      // The whole point of storing the reason: the next caller is answered
      // with the verdict instead of re-proposing the same word.
      const again = await propose(app, {
        workspaceId: member.workspace.id,
        canonical: "Ledger",
      });
      expect(again.status).toBe(409);
      await expect(again.text()).resolves.toBe(
        "Term already exists and was rejected: Ledger — Two different things are called this",
      );
    });

    it("names a rejection with no stored reason without inventing one, and clears the reason on a later confirm", async () => {
      const { member, app } = await admin();
      const [term] = await db
        .insert(agentTermTable)
        .values({
          workspaceId: member.workspace.id,
          canonical: "Ledger",
          // A row disputed before the reason column existed.
          confidence: "disputed",
        })
        .returning();

      const conflict = await propose(app, {
        workspaceId: member.workspace.id,
        canonical: "Ledger",
      });
      expect(conflict.status).toBe(409);
      await expect(conflict.text()).resolves.toBe(
        "Term already exists and was rejected: Ledger",
      );

      // A reason sent with `confirmed` is stripped rather than refused, and a
      // stored one is cleared: it would otherwise be replayed as the verdict on
      // a term that is now accepted.
      const accepted = (await (
        await confirm(app, member.workspace.id, {
          termId: term.id,
          confidence: "confirmed",
          rejectReason: "ignored",
        })
      ).json()) as Term;
      expect(accepted).toMatchObject({
        confidence: "confirmed",
        rejectReason: null,
      });
      expect(
        await (
          await propose(app, {
            workspaceId: member.workspace.id,
            canonical: "Ledger",
          })
        ).text(),
      ).toBe("Term already exists: Ledger");
    });

    it("(f) narrows to the project's linked domain pages, keeping the unfiled workspace-wide terms", async () => {
      const { member, app } = await admin();
      const { project } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      const [linked] = await db
        .insert(agentDomainTable)
        .values({
          workspaceId: member.workspace.id,
          slug: "billing",
          title: "Billing",
        })
        .returning();
      const [unlinked] = await db
        .insert(agentDomainTable)
        .values({
          workspaceId: member.workspace.id,
          slug: "shipping",
          title: "Shipping",
        })
        .returning();
      await db
        .insert(agentProjectDomainTable)
        .values({ projectId: project.id, domainId: linked.id });

      await db.insert(agentTermTable).values([
        {
          workspaceId: member.workspace.id,
          canonical: "Filed",
          aliases: ["scope-probe"],
          confidence: "confirmed",
          domainId: linked.id,
        },
        {
          workspaceId: member.workspace.id,
          canonical: "Elsewhere",
          aliases: ["scope-probe"],
          confidence: "confirmed",
          domainId: unlinked.id,
        },
        {
          workspaceId: member.workspace.id,
          canonical: "Unfiled",
          aliases: ["scope-probe"],
          confidence: "confirmed",
          domainId: null,
        },
      ]);

      // Without projectId the whole workspace answers, so all three collide.
      const wide = (await (
        await resolve(app, member.workspace.id, "scope-probe")
      ).json()) as Resolution;
      expect(wide.ambiguous.map((t) => t.canonical).sort()).toEqual([
        "Elsewhere",
        "Filed",
        "Unfiled",
      ]);

      // With it, the page this project never linked drops out; the unfiled term
      // stays, because nobody filed it means it applies everywhere.
      const narrowed = (await (
        await resolve(app, member.workspace.id, "scope-probe", project.id)
      ).json()) as Resolution;
      expect(narrowed.ambiguous.map((t) => t.canonical).sort()).toEqual([
        "Filed",
        "Unfiled",
      ]);

      // A term filed under an unlinked page is not merely deprioritised.
      const direct = (await (
        await resolve(app, member.workspace.id, "Elsewhere", project.id)
      ).json()) as Resolution;
      expect(direct.match).toBe("none");
    });

    it("(g) ignores confidence and reviewer fields sent on a proposal", async () => {
      const { member, app } = await admin();

      const payload = (await (
        await propose(app, {
          workspaceId: member.workspace.id,
          canonical: "Ledger",
          confidence: "confirmed",
          reviewerId: member.user.id,
          reviewedAt: new Date().toISOString(),
          state: "retired",
        })
      ).json()) as Term;

      expect(payload).toMatchObject({
        confidence: "proposed",
        state: "active",
        reviewerId: null,
        reviewer: null,
        reviewedAt: null,
      });
      const [persisted] = await db
        .select()
        .from(agentTermTable)
        .where(eq(agentTermTable.id, payload.id));
      expect(persisted).toMatchObject({
        confidence: "proposed",
        state: "active",
        reviewerId: null,
        reviewedAt: null,
      });
      // The claim in the body bought nothing: it still does not resolve.
      const resolved = (await (
        await resolve(app, member.workspace.id, "Ledger")
      ).json()) as Resolution;
      expect(resolved.match).toBe("none");
    });

    it("(h) refuses an agent proposal that cites no ledger entry, and accepts one that does", async () => {
      const { member, app } = await admin();
      const { entry } = await seedSourceEntry(member.workspace.id);

      const uncited = await propose(app, {
        workspaceId: member.workspace.id,
        canonical: "Ledger",
        provider: "anthropic",
        model: "claude-fable-5-1",
      });
      expect(uncited.status).toBe(400);
      await expect(uncited.text()).resolves.toBe(
        "sourceEntryId: sourceEntryId is required when provider and model are given",
      );
      expect(await db.select().from(agentTermTable)).toEqual([]);

      // A person proposing is unaffected: the conversation that produced the
      // term is the source, and there is no entry to point at.
      const human = await propose(app, {
        workspaceId: member.workspace.id,
        canonical: "Lease",
      });
      expect(human.status).toBe(200);

      const cited = await propose(app, {
        workspaceId: member.workspace.id,
        canonical: "Ledger",
        provider: "anthropic",
        model: "claude-fable-5-1",
        sourceEntryId: entry.id,
      });
      expect(cited.status).toBe(200);
      expect((await cited.json()) as Term).toMatchObject({
        confidence: "proposed",
        actorId: expect.any(String),
      });
    });

    /**
     * Half a pair is neither kind of proposal. It used to slip past the
     * citation rule — `provider` alone was not an agent proposal, so nothing
     * required `sourceEntryId` — and stored a row with no actor and no source.
     */
    it("refuses provider without model and model without provider", async () => {
      const { member, app } = await admin();

      const providerOnly = await propose(app, {
        workspaceId: member.workspace.id,
        canonical: "OnlyProvider",
        provider: "anthropic",
      });
      expect(providerOnly.status).toBe(400);
      await expect(providerOnly.text()).resolves.toBe(
        "model: provider and model must be given together",
      );

      const modelOnly = await propose(app, {
        workspaceId: member.workspace.id,
        canonical: "OnlyModel",
        model: "claude-fable-5-1",
      });
      expect(modelOnly.status).toBe(400);
      await expect(modelOnly.text()).resolves.toBe(
        "provider: provider and model must be given together",
      );

      expect(await db.select().from(agentTermTable)).toEqual([]);
    });

    it("refuses a blank rejectReason and stores a trimmed one", async () => {
      const { member, app } = await admin();
      const blankTerm = (await (
        await propose(app, {
          workspaceId: member.workspace.id,
          canonical: "Ledger",
        })
      ).json()) as Term;

      const blank = await confirm(app, member.workspace.id, {
        termId: blankTerm.id,
        confidence: "disputed",
        rejectReason: "   ",
      });
      expect(blank.status).toBe(400);
      await expect(blank.text()).resolves.toBe(
        "rejectReason: rejectReason cannot be blank",
      );
      const [untouched] = await db
        .select()
        .from(agentTermTable)
        .where(eq(agentTermTable.id, blankTerm.id));
      expect(untouched).toMatchObject({
        confidence: "proposed",
        rejectReason: null,
      });

      // Padding is the caller's, not the reviewer's verdict: the stored reason
      // is what gets replayed in the 409, so it is trimmed at the edge.
      const rejected = (await (
        await confirm(app, member.workspace.id, {
          termId: blankTerm.id,
          confidence: "disputed",
          rejectReason: "  Two different things are called this  ",
        })
      ).json()) as Term;
      expect(rejected.rejectReason).toBe(
        "Two different things are called this",
      );

      const again = await propose(app, {
        workspaceId: member.workspace.id,
        canonical: "Ledger",
      });
      expect(again.status).toBe(409);
      await expect(again.text()).resolves.toBe(
        "Term already exists and was rejected: Ledger — Two different things are called this",
      );
    });
  });

  describe("deleting", () => {
    function remove(
      app: ReturnType<typeof createApp>["app"],
      workspaceId: string,
      termId: string,
    ) {
      return app.request(`/api/agent-term/${workspaceId}/${termId}`, {
        method: "DELETE",
      });
    }

    async function seedTerm(
      workspaceId: string,
      overrides: Partial<typeof agentTermTable.$inferInsert> = {},
    ) {
      const [term] = await db
        .insert(agentTermTable)
        .values({
          workspaceId,
          canonical: `Term ${randomUUID()}`,
          aliases: [],
          notToConfuseWith: [],
          anchors: [],
          confidence: "proposed",
          ...overrides,
        })
        .returning();
      return term;
    }

    async function stillThere(termId: string) {
      const [row] = await db
        .select({ id: agentTermTable.id })
        .from(agentTermTable)
        .where(eq(agentTermTable.id, termId));
      return row !== undefined;
    }

    it("hard-deletes a term for workspace:update", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      const term = await seedTerm(admin.workspace.id, { canonical: "Draft" });

      mockAuthenticatedSession(admin.user);
      const { app } = createApp();

      const response = await remove(app, admin.workspace.id, term.id);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        id: term.id,
        canonical: "Draft",
      });
      expect(await stillThere(term.id)).toBe(false);

      // Gone means gone: a second delete is "not found".
      expect((await remove(app, admin.workspace.id, term.id)).status).toBe(404);
    });

    it("deletes a confirmed or disputed term too — confidence does not gate it", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      const confirmed = await seedTerm(admin.workspace.id, {
        canonical: "Reviewed",
        confidence: "confirmed",
      });
      const disputed = await seedTerm(admin.workspace.id, {
        confidence: "disputed",
      });
      const retired = await seedTerm(admin.workspace.id, {
        confidence: "confirmed",
        state: "retired",
      });

      mockAuthenticatedSession(admin.user);
      const { app } = createApp();

      const response = await remove(app, admin.workspace.id, confirmed.id);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        id: confirmed.id,
        canonical: "Reviewed",
      });
      expect((await remove(app, admin.workspace.id, disputed.id)).status).toBe(
        200,
      );
      expect((await remove(app, admin.workspace.id, retired.id)).status).toBe(
        200,
      );

      expect(await stillThere(confirmed.id)).toBe(false);
      expect(await stillThere(disputed.id)).toBe(false);
      expect(await stillThere(retired.id)).toBe(false);
    });

    it("refuses a term another term supersedes to", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      const replacement = await seedTerm(admin.workspace.id, {
        canonical: "Ledger",
      });
      await seedTerm(admin.workspace.id, {
        canonical: "Work log",
        state: "retired",
        supersededBy: replacement.id,
      });

      mockAuthenticatedSession(admin.user);
      const { app } = createApp();

      const response = await remove(app, admin.workspace.id, replacement.id);
      expect(response.status).toBe(409);
      await expect(response.text()).resolves.toBe(
        'Term is referenced as the replacement of "Work log" and cannot be deleted',
      );
      expect(await stillThere(replacement.id)).toBe(true);
    });

    it("blocks a viewer and a member (workspace:update required)", async () => {
      for (const role of ["viewer", "member"]) {
        const caller = await createWorkspaceMember({ role });
        const term = await seedTerm(caller.workspace.id);

        mockAuthenticatedSession(caller.user);
        const { app } = createApp();

        const response = await remove(app, caller.workspace.id, term.id);
        expect(response.status, role).toBe(403);
        await expect(response.text()).resolves.toBe("Insufficient permissions");
        expect(await stillThere(term.id)).toBe(true);
      }
    });

    it("reports a term from another workspace as not found and leaves it", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      const other = await createWorkspaceMember({ role: "admin" });
      const foreign = await seedTerm(other.workspace.id);

      mockAuthenticatedSession(admin.user);
      const { app } = createApp();

      const response = await remove(app, admin.workspace.id, foreign.id);
      expect(response.status).toBe(404);
      expect(await stillThere(foreign.id)).toBe(true);
    });

    it("rejects unauthenticated and outside-workspace callers", async () => {
      const admin = await createWorkspaceMember({ role: "admin" });
      const term = await seedTerm(admin.workspace.id);

      mockAnonymousSession();
      expect(
        (await remove(createApp().app, admin.workspace.id, term.id)).status,
      ).toBe(401);

      const outsider = await createWorkspaceMember({ role: "admin" });
      mockAuthenticatedSession(outsider.user);
      expect(
        (await remove(createApp().app, admin.workspace.id, term.id)).status,
      ).toBe(403);

      expect(await stillThere(term.id)).toBe(true);
    });
  });
});
