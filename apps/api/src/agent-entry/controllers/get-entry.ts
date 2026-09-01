import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  agentActorTable,
  agentEntryTable,
} from "../../database/schema-agent-layer";

/** Full record including `body` and `decision`. Fetched one at a time by design. */
async function getEntry(entryId: string) {
  const [row] = await db
    .select()
    .from(agentEntryTable)
    .leftJoin(agentActorTable, eq(agentEntryTable.actorId, agentActorTable.id))
    .where(eq(agentEntryTable.id, entryId))
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
