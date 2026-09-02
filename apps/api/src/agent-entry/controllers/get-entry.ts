import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  agentActorTable,
  agentEntryTable,
} from "../../database/schema-agent-layer";

/**
 * Full record including `body` and `decision`. Fetched one at a time by design.
 *
 * Scoped by project as well as id: the route's `{projectId}` is what the
 * workspace-access middleware authorized, so an entry outside that project must
 * be invisible here, or authorizing against one's own project would unlock
 * every entry in the instance.
 */
async function getEntry(projectId: string, entryId: string) {
  const [row] = await db
    .select()
    .from(agentEntryTable)
    .leftJoin(agentActorTable, eq(agentEntryTable.actorId, agentActorTable.id))
    .where(
      and(
        eq(agentEntryTable.id, entryId),
        eq(agentEntryTable.projectId, projectId),
      ),
    )
    .limit(1);

  if (!row) {
    throw new HTTPException(404, { message: "Entry not found" });
  }

  const entry = row.agent_entry;
  const actor = row.agent_actor;

  return {
    ...entry,
    coreChanged: (entry.coreChanged as string[] | null) ?? null,
    actor: actor
      ? {
          id: actor.id,
          provider: actor.provider,
          model: actor.model,
          onBehalfOf: actor.onBehalfOf,
        }
      : null,
  };
}

export default getEntry;
