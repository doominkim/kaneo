import { and, eq } from "drizzle-orm";
import db from "../../database";
import { agentActorTable } from "../../database/schema-agent-layer";

/**
 * Find or create the actor row for a (workspace, human, model) triple.
 *
 * Identity is deliberately NOT per session: session-scoped rows would grow
 * without bound. The session id is recorded on the entry and the lease instead,
 * so one person can run several concurrent sessions of the same model and they
 * stay distinguishable there.
 */
async function resolveActor(
  workspaceId: string,
  onBehalfOf: string,
  provider: string,
  model: string,
) {
  const [existing] = await db
    .select()
    .from(agentActorTable)
    .where(
      and(
        eq(agentActorTable.workspaceId, workspaceId),
        eq(agentActorTable.onBehalfOf, onBehalfOf),
        eq(agentActorTable.model, model),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(agentActorTable)
      .set({ lastSeenAt: new Date() })
      .where(eq(agentActorTable.id, existing.id));
    return existing;
  }

  const [created] = await db
    .insert(agentActorTable)
    .values({ workspaceId, onBehalfOf, provider, model })
    .returning();
  return created;
}

export default resolveActor;
