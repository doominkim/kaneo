import { and, eq, getTableColumns, inArray, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  agentRequirementItemTable,
  agentRequirementSetTable,
} from "../../database/schema-agent-layer";

export type Author = { updatedBy: string } | { actorId: string };

export function authorColumns(author: Author) {
  return "updatedBy" in author
    ? { updatedBy: author.updatedBy, actorId: null }
    : { updatedBy: null, actorId: author.actorId };
}

/**
 * What every save of a requirement set or design writes (agent-autoapply):
 * the document applies at once, and the review marker follows the author. A
 * person's save counts as their review; an agent's save clears any earlier
 * review, because the content a person saw is no longer the content stored.
 *
 * An API-key save is attributed to the key's owner (`updatedBy`) but is not a
 * review: a key carries its owner's permissions, not proof that anyone read
 * the content, so it clears the marker exactly like an agent's save.
 */
export function appliedColumns(author: Author, now: Date, viaApiKey = false) {
  const userId = "updatedBy" in author ? author.updatedBy : null;
  const reviewer = viaApiKey ? null : userId;
  return {
    status: "approved",
    approvedAt: now,
    approvedBy: userId,
    reviewedAt: reviewer ? now : null,
    reviewedBy: reviewer,
  };
}

/** Who appends the timeline entries for a write: the human, or the agent on their behalf. */
export type EntryAuthor = {
  userId: string;
  provider?: string;
  model?: string;
  sessionId?: string | null;
};

/** A soft-deleted set is not found: every read and write path goes through here. */
export async function findSet(projectId: string, feature: string) {
  const [set] = await db
    .select()
    .from(agentRequirementSetTable)
    .where(
      and(
        eq(agentRequirementSetTable.projectId, projectId),
        eq(agentRequirementSetTable.feature, feature),
        isNull(agentRequirementSetTable.deletedAt),
      ),
    )
    .limit(1);
  return set ?? null;
}

export async function requireSet(projectId: string, feature: string) {
  const set = await findSet(projectId, feature);
  if (!set) {
    throw new HTTPException(404, { message: "Requirement set not found" });
  }
  return set;
}

/**
 * The project's requirement item ids whose set is not soft-deleted, as a
 * subquery. Replace-style link writes delete only among these: a link to a
 * deleted set's item is hidden from every read, so no payload can name it, and
 * it must still be there when the set is restored.
 */
export function liveItemIds(projectId: string) {
  return db
    .select({ id: agentRequirementItemTable.id })
    .from(agentRequirementItemTable)
    .innerJoin(
      agentRequirementSetTable,
      and(
        eq(agentRequirementSetTable.id, agentRequirementItemTable.setId),
        isNull(agentRequirementSetTable.deletedAt),
      ),
    )
    .where(eq(agentRequirementItemTable.projectId, projectId));
}

/**
 * Resolve keys to item rows inside one project; unknown keys are a 400, not a
 * silent drop. Items of a soft-deleted set count as unknown, so nothing new
 * can be linked to a document nobody can see.
 */
export async function resolveItemsByKey(projectId: string, keys: string[]) {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return [];
  const rows = await db
    .select(getTableColumns(agentRequirementItemTable))
    .from(agentRequirementItemTable)
    .innerJoin(
      agentRequirementSetTable,
      and(
        eq(agentRequirementSetTable.id, agentRequirementItemTable.setId),
        isNull(agentRequirementSetTable.deletedAt),
      ),
    )
    .where(
      and(
        eq(agentRequirementItemTable.projectId, projectId),
        inArray(agentRequirementItemTable.key, unique),
      ),
    );
  const found = new Set(rows.map((row) => row.key));
  const missing = unique.filter((key) => !found.has(key));
  if (missing.length) {
    throw new HTTPException(400, {
      message: `Unknown requirement keys: ${missing.join(", ")}`,
    });
  }
  return rows;
}
