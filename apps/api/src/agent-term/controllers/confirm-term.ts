import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { loadActor } from "../../agent-entry/actor-response";
import db from "../../database";
import { agentTermTable } from "../../database/schema-agent-layer";
import { toTermRecord } from "./term-record";

/**
 * Human review outcome. This is the only path from `proposed` to `confirmed`.
 *
 * Also stamps `lastVerifiedAt`, which the re-verification schedule reads: a term
 * that keeps surviving review earns a longer interval, one that keeps changing
 * gets checked more often.
 *
 * `actorId` is deliberately left alone: it records who PROPOSED the term, and
 * a review does not change that. Clearing it here would erase the one fact the
 * reviewer weighed the proposal by.
 */
async function confirmTerm(
  workspaceId: string,
  termId: string,
  confidence: "confirmed" | "disputed",
) {
  const [updated] = await db
    .update(agentTermTable)
    .set({ confidence, lastVerifiedAt: new Date() })
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

  return toTermRecord(updated, await loadActor(updated.actorId));
}

export default confirmTerm;
