import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { agentTermTable } from "../../database/schema-agent-layer";

/**
 * Soft delete, for any term the caller can reach (agent-autoapply): terms
 * apply on proposal, so a wrong one is hidden and restorable rather than
 * erased. The row keeps every field and gains `deletedAt`/`deletedBy`; list,
 * resolve and the domain counts then skip it.
 *
 * Confidence and state do not gate this: a workspace:update holder owns the
 * lexicon. The one refusal is a term a live term points at via
 * `supersededBy` — hiding it would leave the survivor naming a term nobody can
 * read. That is a 409 and not a 403: the caller has the right, the row is in
 * the wrong state.
 *
 * The term's row is locked before the referrer check. Restoring a referrer
 * locks this row too (see `restoreTerm`), so the two cannot interleave into a
 * live referrer naming a deleted term.
 *
 * Scoped by workspace: a term id from another workspace is "not found", and
 * so is one that is already deleted.
 */
async function deleteTerm(workspaceId: string, termId: string, userId: string) {
  return db.transaction(async (tx) => {
    const [term] = await tx
      .select({ id: agentTermTable.id })
      .from(agentTermTable)
      .where(
        and(
          eq(agentTermTable.id, termId),
          eq(agentTermTable.workspaceId, workspaceId),
          isNull(agentTermTable.deletedAt),
        ),
      )
      .limit(1)
      .for("update");

    if (!term) {
      throw new HTTPException(404, { message: "Term not found" });
    }

    const [referrer] = await tx
      .select({ id: agentTermTable.id, canonical: agentTermTable.canonical })
      .from(agentTermTable)
      .where(
        and(
          eq(agentTermTable.workspaceId, workspaceId),
          eq(agentTermTable.supersededBy, termId),
          isNull(agentTermTable.deletedAt),
        ),
      )
      .limit(1);

    if (referrer) {
      throw new HTTPException(409, {
        message: `Term is referenced as the replacement of "${referrer.canonical}" and cannot be deleted`,
      });
    }

    const [deleted] = await tx
      .update(agentTermTable)
      .set({ deletedAt: new Date(), deletedBy: userId })
      .where(
        and(
          eq(agentTermTable.id, termId),
          eq(agentTermTable.workspaceId, workspaceId),
          isNull(agentTermTable.deletedAt),
        ),
      )
      .returning({
        id: agentTermTable.id,
        canonical: agentTermTable.canonical,
      });

    if (!deleted) {
      throw new HTTPException(404, { message: "Term not found" });
    }
    return deleted;
  });
}

export default deleteTerm;
