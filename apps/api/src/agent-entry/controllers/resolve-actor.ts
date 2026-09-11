import db from "../../database";
import { agentActorTable } from "../../database/schema-agent-layer";

/**
 * Find or create the actor row for a (workspace, human, provider, model) tuple.
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
  const [actor] = await db
    .insert(agentActorTable)
    .values({ workspaceId, onBehalfOf, provider, model })
    .onConflictDoUpdate({
      target: [
        agentActorTable.workspaceId,
        agentActorTable.onBehalfOf,
        agentActorTable.provider,
        agentActorTable.model,
      ],
      set: { lastSeenAt: new Date() },
    })
    .returning();
  return actor;
}

export default resolveActor;
