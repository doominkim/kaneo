import { and, eq, inArray } from "drizzle-orm";
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

/** Who appends the timeline entries for a write: the human, or the agent on their behalf. */
export type EntryAuthor = {
  userId: string;
  provider?: string;
  model?: string;
  sessionId?: string | null;
};

export async function findSet(projectId: string, feature: string) {
  const [set] = await db
    .select()
    .from(agentRequirementSetTable)
    .where(
      and(
        eq(agentRequirementSetTable.projectId, projectId),
        eq(agentRequirementSetTable.feature, feature),
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

/** Resolve keys to item rows inside one project; unknown keys are a 400, not a silent drop. */
export async function resolveItemsByKey(projectId: string, keys: string[]) {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return [];
  const rows = await db
    .select()
    .from(agentRequirementItemTable)
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
