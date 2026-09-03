import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { agentTermTable } from "../../database/schema-agent-layer";

/**
 * Hard delete, for `proposed` terms only.
 *
 * A proposal that was never reviewed has not been relied on by anyone, so
 * removing it loses nothing; a `confirmed` (or `disputed`) term may already be
 * cited by sessions and must go through retirement instead, which leaves a
 * tombstone (`state=retired`, `supersededBy`) that a later resolve can still
 * answer with. That is why the refusal is a 409 and not a 403: the caller has
 * the right, the row is in the wrong state.
 *
 * A term another term points at via `supersededBy` is refused for the same
 * reason — deleting it would leave a dangling pointer on the survivor.
 *
 * Scoped by workspace: a term id from another workspace is "not found".
 */
async function deleteTerm(workspaceId: string, termId: string) {
  const [term] = await db
    .select({
      id: agentTermTable.id,
      canonical: agentTermTable.canonical,
      confidence: agentTermTable.confidence,
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

  if (term.confidence !== "proposed") {
    throw new HTTPException(409, {
      message: `Only proposed terms can be deleted; this one is ${term.confidence}. Retire it instead so a tombstone remains.`,
    });
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
