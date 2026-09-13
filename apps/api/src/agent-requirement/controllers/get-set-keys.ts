import { asc, eq } from "drizzle-orm";
import db from "../../database";
import { agentRequirementItemTable } from "../../database/schema-agent-layer";
import { requireSet } from "./shared";

/**
 * The light shape spec-check reads over REST with an API key (REQ-SPEC-TABS-15):
 * just the keys and their clocks — enough to know what must be covered and
 * whether the set the tests were written against is still the approved one.
 */
async function getSetKeys(projectId: string, feature: string) {
  const set = await requireSet(projectId, feature);
  const items = await db
    .select({
      key: agentRequirementItemTable.key,
      status: agentRequirementItemTable.status,
      layer: agentRequirementItemTable.layer,
      updatedAt: agentRequirementItemTable.updatedAt,
    })
    .from(agentRequirementItemTable)
    .where(eq(agentRequirementItemTable.setId, set.id))
    .orderBy(asc(agentRequirementItemTable.seq));
  return {
    feature: set.feature,
    title: set.title,
    status: set.status,
    approvedAt: set.approvedAt,
    updatedAt: set.updatedAt,
    items,
  };
}

export default getSetKeys;
