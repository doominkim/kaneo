import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { agentTermTable } from "../../apps/api/src/database/schema-agent-layer";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

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

describe("API integration: agent terms", () => {
  beforeEach(async () => {
    await resetTestDatabase();
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
      accessCount: 0,
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
        },
        {
          workspaceId: member.workspace.id,
          canonical: "Claim",
          aliases: ["Lease"],
          notToConfuseWith: [],
          anchors: [],
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
        })
        .returning();
      await db.insert(agentTermTable).values({
        workspaceId: member.workspace.id,
        canonical: "Journal",
        aliases: [],
        notToConfuseWith: [],
        anchors: [],
        state: "retired",
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
      });
      expect(payload.lastVerifiedAt).not.toBeNull();

      const [persisted] = await db
        .select()
        .from(agentTermTable)
        .where(eq(agentTermTable.id, term.id));
      expect(persisted?.confidence).toBe("confirmed");
      expect(persisted?.lastVerifiedAt).not.toBeNull();
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
        })
      ).json()) as Term;

      expect(payload.confidence).toBe("disputed");
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
});
