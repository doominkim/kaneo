import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { loadActor } from "../../agent-entry/actor-response";
import db from "../../database";
import { agentTermTable } from "../../database/schema-agent-layer";
import { loadReviewer, toTermRecord } from "./term-record";

/**
 * Human review outcome. This is the only path from `proposed` to `confirmed`,
 * and the only thing that makes a term resolvable at all.
 *
 * The reviewer is recorded as a `user`, never as an actor: the MCP tool set
 * exposes no confirm, so a model cannot rule on its own proposal. Who signed
 * off is what `confidence` means in practice.
 *
 * `rejectReason` is kept only while the verdict is `disputed`. Confirming
 * clears it, because a stale reason on an accepted term would be replayed at
 * the next proposal of the same word and contradict the current verdict.
 *
 * Also stamps `lastVerifiedAt`, which the re-verification schedule reads: a term
 * that keeps surviving review earns a longer interval, one that keeps changing
 * gets checked more often. `reviewedAt` is separate because that schedule will
 * re-stamp `lastVerifiedAt` without a person having looked again.
 *
 * `actorId` is deliberately left alone: it records who PROPOSED the term, and
 * a review does not change that. Clearing it here would erase the one fact the
 * reviewer weighed the proposal by.
 */
async function confirmTerm(
  workspaceId: string,
  termId: string,
  confidence: "confirmed" | "disputed",
  reviewerId: string,
  rejectReason: string | null,
) {
  const now = new Date();
  const [updated] = await db
    .update(agentTermTable)
    .set({
      confidence,
      rejectReason: confidence === "disputed" ? rejectReason : null,
      reviewerId,
      reviewedAt: now,
      lastVerifiedAt: now,
    })
    .where(
      and(
        eq(agentTermTable.id, termId),
        eq(agentTermTable.workspaceId, workspaceId),
      ),
    )
    .returning();

  if (!updated) {
    throw new HTTPException(404, { message: "Term not found" });
  }

  const [actor, reviewer] = await Promise.all([
    loadActor(updated.actorId),
    loadReviewer(updated.reviewerId),
  ]);
  return toTermRecord(updated, actor, reviewer);
}

export default confirmTerm;
