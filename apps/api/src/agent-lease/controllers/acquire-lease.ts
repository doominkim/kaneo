import { eq, lt } from "drizzle-orm";
import resolveActor from "../../agent-entry/controllers/resolve-actor";
import db from "../../database";
import {
  agentActorTable,
  agentLeaseTable,
} from "../../database/schema-agent-layer";

type AcquireInput = {
  workspaceId: string;
  userId: string;
  taskId: string;
  provider: string;
  model: string;
  sessionId: string;
  ttlMinutes: number;
};

/**
 * Claim a task, or report who already holds it.
 *
 * Atomicity matters here: two sessions asking at the same moment must not both
 * be told yes. The unique constraint on task_id plus a conditional upsert does
 * that in one statement — a read-then-write would race.
 *
 * The conditional is `expires_at < now()`: a live claim is left alone, an
 * expired one is taken over. That is why the TTL is mandatory; without it a
 * crashed session would hold a task forever with no way to reclaim it.
 */
async function acquireLease(input: AcquireInput) {
  const actor = await resolveActor(
    input.workspaceId,
    input.userId,
    input.provider,
    input.model,
  );
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.ttlMinutes * 60_000);

  const [row] = await db
    .insert(agentLeaseTable)
    .values({
      workspaceId: input.workspaceId,
      taskId: input.taskId,
      actorId: actor?.id ?? "",
      sessionId: input.sessionId,
      acquiredAt: now,
      expiresAt,
    })
    .onConflictDoUpdate({
      target: agentLeaseTable.taskId,
      set: {
        actorId: actor?.id ?? "",
        sessionId: input.sessionId,
        acquiredAt: now,
        expiresAt,
      },
      where: lt(agentLeaseTable.expiresAt, now),
    })
    .returning();

  if (row) {
    return {
      acquired: true,
      lease: {
        id: row.id,
        taskId: row.taskId,
        sessionId: row.sessionId,
        acquiredAt: row.acquiredAt,
        expiresAt: row.expiresAt,
        actor: actor
          ? {
              id: actor.id,
              provider: actor.provider,
              model: actor.model,
              onBehalfOf: actor.onBehalfOf,
            }
          : null,
      },
    };
  }

  // Refused. Return the current holder so the caller can say who has it
  // instead of just failing.
  const [held] = await db
    .select()
    .from(agentLeaseTable)
    .leftJoin(agentActorTable, eq(agentLeaseTable.actorId, agentActorTable.id))
    .where(eq(agentLeaseTable.taskId, input.taskId))
    .limit(1);

  if (!held) {
    return { acquired: false, lease: null };
  }

  const holder = held.agent_actor;
  return {
    acquired: false,
    lease: {
      id: held.agent_lease.id,
      taskId: held.agent_lease.taskId,
      sessionId: held.agent_lease.sessionId,
      acquiredAt: held.agent_lease.acquiredAt,
      expiresAt: held.agent_lease.expiresAt,
      actor: holder
        ? {
            id: holder.id,
            provider: holder.provider,
            model: holder.model,
            onBehalfOf: holder.onBehalfOf,
          }
        : null,
    },
  };
}

export default acquireLease;
