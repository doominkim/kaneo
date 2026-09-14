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
 *
 * A term whose `supersededBy` names a deleted term is a 409: it would come
 * back pointing readers at a replacement nobody can read, which is the state
 * delete refuses to create from the other side. Restore the replacement
 * first. Both rows are locked, and delete locks the replacement before it
 * looks for live referrers, so a concurrent delete of the replacement and
 * restore of this term cannot both succeed.
 */
async function restoreTerm(workspaceId: string, termId: string) {
  const restored = await db.transaction(async (tx) => {
    const [target] = await tx
      .select({ supersededBy: agentTermTable.supersededBy })
      .from(agentTermTable)
      .where(
        and(
          eq(agentTermTable.id, termId),
          eq(agentTermTable.workspaceId, workspaceId),
          isNotNull(agentTermTable.deletedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!target) {
      throw new HTTPException(404, { message: "Term not found" });
    }

    if (target.supersededBy) {
      const [replacement] = await tx
        .select({
          canonical: agentTermTable.canonical,
          deletedAt: agentTermTable.deletedAt,
        })
        .from(agentTermTable)
        .where(
          and(
            eq(agentTermTable.id, target.supersededBy),
            eq(agentTermTable.workspaceId, workspaceId),
          ),
        )
        .limit(1)
        .for("update");
      if (replacement?.deletedAt) {
        throw new HTTPException(409, {
          message: `Term is superseded by "${replacement.canonical}", which is deleted; restore that term first`,
        });
      }
    }

    const [row] = await tx
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
    return row;
  });

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
