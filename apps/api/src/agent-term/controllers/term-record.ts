import { eq } from "drizzle-orm";
import type { ActorResponse } from "../../agent-entry/actor-response";
import db, { schema } from "../../database";
import type { AgentTerm } from "../../database/schema-agent-layer";

export type TermReviewer = { userId: string; name: string } | null;

/**
 * The public term shape, in one place.
 *
 * Four controllers (propose, confirm, list, resolve) all answer with a term,
 * and they used to carry four copies of this projection. A field added to one
 * copy and not the others is a silent contract break, so they share this one.
 *
 * `anchors`/`aliases`/`notToConfuseWith` are jsonb, which Drizzle types as
 * `unknown`; this is the only place they are cast.
 *
 * `actor` is the model that proposed; `reviewer` is the person who ruled on it.
 * Both ride along because a reader judges a term by the pair, not by either
 * alone.
 */
export function toTermRecord(
  row: AgentTerm,
  actor: ActorResponse | null,
  reviewer: TermReviewer = null,
) {
  return {
    id: row.id,
    canonical: row.canonical,
    definition: row.definition,
    aliases: (row.aliases as string[] | null) ?? [],
    notToConfuseWith: (row.notToConfuseWith as string[] | null) ?? [],
    anchors: row.anchors ?? [],
    confidence: row.confidence,
    state: row.state,
    supersededBy: row.supersededBy,
    domainId: row.domainId,
    actorId: row.actorId,
    actor,
    reviewerId: row.reviewerId,
    reviewer,
    reviewedAt: row.reviewedAt,
    rejectReason: row.rejectReason,
    lastVerifiedAt: row.lastVerifiedAt,
    createdAt: row.createdAt,
  };
}

/**
 * One-row lookup for the write paths, which get their row back from
 * `returning()` and so have no join to lift from. Local to agent-term on
 * purpose: the domain module has the same helper for its own author field, and
 * sharing one would tie the lexicon's shape to the page's.
 */
export async function loadReviewer(
  reviewerId: string | null,
): Promise<TermReviewer> {
  if (!reviewerId) return null;
  const [user] = await db
    .select({ id: schema.userTable.id, name: schema.userTable.name })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, reviewerId))
    .limit(1);
  return user ? { userId: user.id, name: user.name } : null;
}

/** Lifts the joined reviewer columns into the nested block. */
export function liftReviewer(row: {
  reviewerUserId: string | null;
  reviewerName: string | null;
}): TermReviewer {
  return row.reviewerUserId && row.reviewerName
    ? { userId: row.reviewerUserId, name: row.reviewerName }
    : null;
}

export type TermRecord = ReturnType<typeof toTermRecord>;
