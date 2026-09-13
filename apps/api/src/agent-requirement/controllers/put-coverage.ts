import { and, eq, inArray } from "drizzle-orm";
import db from "../../database";
import {
  agentRequirementCoverageTable,
  agentRequirementItemTable,
} from "../../database/schema-agent-layer";
import { requireSet, resolveItemsByKey } from "./shared";

/**
 * spec-check's report for one repo. Replaces that repo's rows for the set's
 * items, so a test that stopped citing a key disappears from coverage.
 */
async function putCoverage(input: {
  projectId: string;
  feature: string;
  repo: string;
  entries: Array<{ key: string; testPath: string; testName?: string | null }>;
  actorId?: string | null;
}) {
  const set = await requireSet(input.projectId, input.feature);
  const items = await resolveItemsByKey(
    input.projectId,
    input.entries.map((entry) => entry.key),
  );
  const idByKey = new Map(items.map((item) => [item.key, item.id]));

  await db.transaction(async (tx) => {
    const setItemIds = (
      await tx
        .select({ id: agentRequirementItemTable.id })
        .from(agentRequirementItemTable)
        .where(eq(agentRequirementItemTable.setId, set.id))
    ).map((row) => row.id);
    if (setItemIds.length) {
      await tx
        .delete(agentRequirementCoverageTable)
        .where(
          and(
            inArray(agentRequirementCoverageTable.itemId, setItemIds),
            eq(agentRequirementCoverageTable.repo, input.repo),
          ),
        );
    }
    for (const entry of input.entries) {
      const itemId = idByKey.get(entry.key);
      if (!itemId) continue;
      await tx
        .insert(agentRequirementCoverageTable)
        .values({
          itemId,
          repo: input.repo,
          testPath: entry.testPath,
          testName: entry.testName ?? null,
          actorId: input.actorId ?? null,
        })
        .onConflictDoUpdate({
          target: [
            agentRequirementCoverageTable.itemId,
            agentRequirementCoverageTable.repo,
            agentRequirementCoverageTable.testPath,
          ],
          set: {
            testName: entry.testName ?? null,
            actorId: input.actorId ?? null,
            reportedAt: new Date(),
          },
        });
    }
  });

  return {
    feature: input.feature,
    repo: input.repo,
    reported: input.entries.length,
  };
}

export default putCoverage;
