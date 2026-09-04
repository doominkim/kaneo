import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import { actorSelection, liftActor } from "../../agent-entry/actor-response";
import db from "../../database";
import { projectTable, userTable } from "../../database/schema";
import {
  agentActorTable,
  agentProjectDomainTable,
  agentTermTable,
} from "../../database/schema-agent-layer";
import { liftReviewer, toTermRecord } from "./term-record";

/**
 * A `projectId` that names no project in this workspace is bad input, not an
 * empty scope. Left unchecked the narrowing silently degrades to "unfiled
 * terms only", so one typo makes every filed term read as absent and the
 * caller has no way to tell that from a genuine miss. Mirrors
 * `assertDomainsInWorkspace`, but stays local: the lexicon's scope check is
 * not the domain module's link check.
 */
async function assertProjectInWorkspace(
  workspaceId: string,
  projectId: string,
) {
  const [row] = await db
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        eq(projectTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new HTTPException(400, {
      message: "projectId does not belong to this workspace",
    });
  }
}

/**
 * Deterministic lookup. The same input always returns the same answer.
 *
 * No embedding, no ranking, no model judgement — that is the entire point.
 * A similarity search would hand back "five documents that look related" and
 * the caller would have to infer again, which is the failure this layer exists
 * to remove.
 *
 * Only `confirmed` terms are returned. A resolve is read as settled fact by
 * whoever asks, so answering with an unreviewed `proposed` row closes a loop
 * the layer exists to break: a model proposes a definition it inferred, the
 * next session resolves it, and the guess comes back indistinguishable from
 * something a person decided. `disputed` is withheld for the same reason from
 * the other side — it was looked at and rejected. Absence is the honest answer:
 * a caller that gets `match: "none"` goes and reads the code, which is what it
 * should have done about an unsettled word anyway.
 *
 * `retired` rows are NOT filtered out: a tombstone carries real information
 * ("this is dead, look at X instead"). Hiding it invites the same dead concept
 * to be proposed again six months later. It still has to be confirmed — a
 * tombstone is a claim about the vocabulary like any other.
 *
 * The proposing actor and the reviewing person ride along on every returned
 * term, including the `ambiguous` list: when a human has to disambiguate,
 * "who proposed each of these and who accepted it" is part of what they are
 * deciding on.
 */
async function resolveTerm(
  workspaceId: string,
  term: string,
  projectId?: string,
) {
  const normalized = term.trim();
  const reviewerUser = alias(userTable, "reviewer_user");

  const conditions = [
    eq(agentTermTable.workspaceId, workspaceId),
    eq(agentTermTable.confidence, "confirmed"),
    or(
      sql`lower(${agentTermTable.canonical}) = lower(${normalized})`,
      // Aliases are matched the same way as the canonical name (case- and
      // whitespace-insensitive), which jsonb containment cannot express.
      sql`exists (
        select 1
        from jsonb_array_elements_text(coalesce(${agentTermTable.aliases}, '[]'::jsonb)) as alias(value)
        where lower(trim(alias.value)) = lower(${normalized})
      )`,
    ),
  ];

  // Scope, when asked for, is derived rather than stored: a term names its
  // domain page, and a project names the pages it touches. An unfiled term
  // (`domainId` NULL) is workspace-wide vocabulary and answers everywhere —
  // narrowing it would hide the terms nobody has filed yet.
  //
  // An empty `projectId` means unspecified, the same as omitting it: a caller
  // building the query string from an unset value asked for no narrowing, and
  // refusing that would only punish the string concatenation.
  if (projectId) {
    await assertProjectInWorkspace(workspaceId, projectId);
    conditions.push(
      or(
        isNull(agentTermTable.domainId),
        inArray(
          agentTermTable.domainId,
          db
            .select({ domainId: agentProjectDomainTable.domainId })
            .from(agentProjectDomainTable)
            .where(eq(agentProjectDomainTable.projectId, projectId)),
        ),
      ),
    );
  }

  const rows = await db
    .select({
      term: agentTermTable,
      ...actorSelection,
      reviewerUserId: reviewerUser.id,
      reviewerName: reviewerUser.name,
    })
    .from(agentTermTable)
    .leftJoin(agentActorTable, eq(agentTermTable.actorId, agentActorTable.id))
    .leftJoin(reviewerUser, eq(agentTermTable.reviewerId, reviewerUser.id))
    .where(and(...conditions));

  if (rows.length === 0) {
    return { match: "none" as const, term: null, ambiguous: [] };
  }

  const canonicalHit = rows.find(
    (r) => r.term.canonical.toLowerCase() === normalized.toLowerCase(),
  );
  const hit = canonicalHit ?? rows[0];

  // Retrieval counters feed the decay model that ships later. They are written
  // from day one because adding them afterwards leaves no history to decay against.
  if (hit) {
    await db
      .update(agentTermTable)
      .set({
        lastAccessedAt: new Date(),
        accessCount: sql`${agentTermTable.accessCount} + 1`,
      })
      .where(eq(agentTermTable.id, hit.term.id));
  }

  const shape = (row: (typeof rows)[number]) =>
    toTermRecord(row.term, liftActor(row), liftReviewer(row));

  return {
    match: canonicalHit ? ("canonical" as const) : ("alias" as const),
    term: hit ? shape(hit) : null,
    // More than one match means a human must decide. The layer does not guess.
    ambiguous: rows.length > 1 ? rows.map(shape) : [],
  };
}

export default resolveTerm;
