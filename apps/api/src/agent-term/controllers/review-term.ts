import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { loadActor } from "../../agent-entry/actor-response";
import db from "../../database";
import { agentTermTable } from "../../database/schema-agent-layer";
import { loadReviewer, toTermRecord } from "./term-record";

/**
 * A person has read the item (agent-autoapply), the same act as reviewing an
 * ADR or a requirement document: only the review marker moves. Confidence,
 * the reject reason and `lastVerifiedAt` stay as they are, because reading an
 * item is not a verdict on it; that is what `confirm` is for.
 */
async function reviewTerm(workspaceId: string, termId: string, userId: string) {
  const [updated] = await db
    .update(agentTermTable)
    .set({ reviewerId: userId, reviewedAt: new Date() })
    .where(
      and(
        eq(agentTermTable.id, termId),
        eq(agentTermTable.workspaceId, workspaceId),
        isNull(agentTermTable.deletedAt),
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

export default reviewTerm;
