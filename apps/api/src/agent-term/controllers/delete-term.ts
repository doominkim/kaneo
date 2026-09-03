import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { agentTermTable } from "../../database/schema-agent-layer";

/**
 * Hard delete, for any term the caller can reach.
 *
 * Confidence and state do not gate this: a workspace:update holder owns the
 * lexicon and may drop an entry outright rather than retire it. Retirement
 * stays available for the case where a tombstone is wanted, but it is a choice,
 * not a precondition.
 *
 * The one refusal is a term another term points at via `supersededBy` —
 * deleting it would leave a dangling pointer on the survivor. That is a 409 and
 * not a 403: the caller has the right, the row is in the wrong state.
 *
 * Scoped by workspace: a term id from another workspace is "not found".
 */
async function deleteTerm(workspaceId: string, termId: string) {
  const [term] = await db
    .select({
      id: agentTermTable.id,
      canonical: agentTermTable.canonical,
    })
    .from(agentTermTable)
    .where(
      and(
        eq(agentTermTable.id, termId),
        eq(agentTermTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!term) {
    throw new HTTPException(404, { message: "Term not found" });
  }

  const [referrer] = await db
    .select({ id: agentTermTable.id, canonical: agentTermTable.canonical })
    .from(agentTermTable)
    .where(
      and(
        eq(agentTermTable.workspaceId, workspaceId),
        eq(agentTermTable.supersededBy, termId),
      ),
    )
    .limit(1);

  if (referrer) {
    throw new HTTPException(409, {
      message: `Term is referenced as the replacement of "${referrer.canonical}" and cannot be deleted`,
    });
  }

  await db.delete(agentTermTable).where(eq(agentTermTable.id, termId));

  return { id: term.id, canonical: term.canonical };
}

export default deleteTerm;
