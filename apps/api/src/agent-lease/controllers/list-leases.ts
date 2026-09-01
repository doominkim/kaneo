import { and, eq, gt } from "drizzle-orm";
import db from "../../database";
import { taskTable } from "../../database/schema";
import {
  agentActorTable,
  agentLeaseTable,
} from "../../database/schema-agent-layer";

/**
 * Live claims for a project — "who is working on what right now".
 *
 * Expired rows are filtered rather than deleted: a sweeper would be one more
 * moving part, and the filter is what makes correctness independent of it.
 * Joins through task because a lease belongs to a task, not to a project.
 */
async function listLeases(projectId: string) {
  const rows = await db
    .select({
      id: agentLeaseTable.id,
      taskId: agentLeaseTable.taskId,
      sessionId: agentLeaseTable.sessionId,
      acquiredAt: agentLeaseTable.acquiredAt,
      expiresAt: agentLeaseTable.expiresAt,
      actorId: agentActorTable.id,
      actorProvider: agentActorTable.provider,
      actorModel: agentActorTable.model,
      actorOnBehalfOf: agentActorTable.onBehalfOf,
    })
    .from(agentLeaseTable)
    .innerJoin(taskTable, eq(agentLeaseTable.taskId, taskTable.id))
    .leftJoin(agentActorTable, eq(agentLeaseTable.actorId, agentActorTable.id))
    .where(
      and(
        eq(taskTable.projectId, projectId),
        gt(agentLeaseTable.expiresAt, new Date()),
      ),
    );

  return {
    leases: rows.map((r) => ({
      id: r.id,
      taskId: r.taskId,
      sessionId: r.sessionId,
      acquiredAt: r.acquiredAt,
      expiresAt: r.expiresAt,
      actor: r.actorId
        ? {
            id: r.actorId,
            provider: r.actorProvider ?? "",
            model: r.actorModel ?? "",
            onBehalfOf: r.actorOnBehalfOf ?? null,
          }
        : null,
    })),
  };
}

export default listLeases;
