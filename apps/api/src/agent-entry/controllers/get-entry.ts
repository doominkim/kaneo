import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { userTable } from "../../database/schema";
import {
  agentActorTable,
  agentEntryTable,
} from "../../database/schema-agent-layer";
import {
  type EntryRefs,
  type EntryUsage,
  shapeAuthorship,
} from "./entry-fields";

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
    .select({
      entry: agentEntryTable,
      actor: agentActorTable,
      author: { id: userTable.id, name: userTable.name },
    })
    .from(agentEntryTable)
    .leftJoin(agentActorTable, eq(agentEntryTable.actorId, agentActorTable.id))
    .leftJoin(userTable, eq(agentEntryTable.createdBy, userTable.id))
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

  const entry = row.entry;

  return {
    ...entry,
    refs: (entry.refs as EntryRefs | null) ?? null,
    coreChanged: (entry.coreChanged as string[] | null) ?? null,
    usage: (entry.usage as EntryUsage | null) ?? null,
    ...shapeAuthorship(row.actor, row.author),
  };
}

export default getEntry;
