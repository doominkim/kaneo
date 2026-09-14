import { and, eq, isNotNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { loadActor } from "../../agent-entry/actor-response";
import db from "../../database";
import { agentTermTable } from "../../database/schema-agent-layer";
import { loadReviewer, toTermRecord } from "./term-record";

/**
 * Undo a soft delete. Only the two delete columns are cleared, so the term
 * comes back with the confidence, review and domain it had. A term that is
 * not deleted is "not found", so a double restore reports it did nothing.
 */
async function restoreTerm(workspaceId: string, termId: string) {
  const [restored] = await db
    .update(agentTermTable)
    .set({ deletedAt: null, deletedBy: null })
    .where(
      and(
        eq(agentTermTable.id, termId),
        eq(agentTermTable.workspaceId, workspaceId),
        isNotNull(agentTermTable.deletedAt),
      ),
    )
    .returning();

  if (!restored) {
    throw new HTTPException(404, { message: "Term not found" });
  }

  const [actor, reviewer] = await Promise.all([
    loadActor(restored.actorId),
    loadReviewer(restored.reviewerId),
  ]);
  return toTermRecord(restored, actor, reviewer);
}

export default restoreTerm;
