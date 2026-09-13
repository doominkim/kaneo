import { count, desc, eq, sql } from "drizzle-orm";
import db from "../../database";
import {
  agentRequirementItemTable,
  agentRequirementSetTable,
} from "../../database/schema-agent-layer";

async function listSets(projectId: string) {
  return db
    .select({
      id: agentRequirementSetTable.id,
      feature: agentRequirementSetTable.feature,
      title: agentRequirementSetTable.title,
      status: agentRequirementSetTable.status,
      approvedAt: agentRequirementSetTable.approvedAt,
      sourceSlug: agentRequirementSetTable.sourceSlug,
      createdAt: agentRequirementSetTable.createdAt,
      updatedAt: agentRequirementSetTable.updatedAt,
      itemCount: count(agentRequirementItemTable.id),
      activeCount:
        sql<number>`count(*) filter (where ${agentRequirementItemTable.status} = 'active')`.mapWith(
          Number,
        ),
    })
    .from(agentRequirementSetTable)
    .leftJoin(
      agentRequirementItemTable,
      eq(agentRequirementItemTable.setId, agentRequirementSetTable.id),
    )
    .where(eq(agentRequirementSetTable.projectId, projectId))
    .groupBy(agentRequirementSetTable.id)
    .orderBy(desc(agentRequirementSetTable.updatedAt));
}

export default listSets;
