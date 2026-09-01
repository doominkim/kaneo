import { and, eq } from "drizzle-orm";
import db from "../../database";
import { agentLeaseTable } from "../../database/schema-agent-layer";

/**
 * Release is a row delete — the durable record of what happened lives in the
 * ledger, not here. This table only answers "who is holding what right now".
 *
 * Scoped to the holding session so one agent cannot drop another's claim.
 */
async function releaseLease(taskId: string, sessionId: string) {
  const deleted = await db
    .delete(agentLeaseTable)
    .where(
      and(
        eq(agentLeaseTable.taskId, taskId),
        eq(agentLeaseTable.sessionId, sessionId),
      ),
    )
    .returning({ id: agentLeaseTable.id });

  return { released: deleted.length > 0 };
}

export default releaseLease;
