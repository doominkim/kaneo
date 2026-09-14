import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import db from "../../database";
import {
  agentRequirementItemTable,
  agentRequirementSetTable,
} from "../../database/schema-agent-layer";

async function listSets(projectId: string) {
  const rows = await db
    .select({
      id: agentRequirementSetTable.id,
      feature: agentRequirementSetTable.feature,
      title: agentRequirementSetTable.title,
      status: agentRequirementSetTable.status,
      approvedAt: agentRequirementSetTable.approvedAt,
      sourceSlug: agentRequirementSetTable.sourceSlug,
      createdAt: agentRequirementSetTable.createdAt,
      updatedAt: agentRequirementSetTable.updatedAt,
      reviewedAt: agentRequirementSetTable.reviewedAt,
      revisedAt: agentRequirementSetTable.revisedAt,
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
    .where(
      and(
        eq(agentRequirementSetTable.projectId, projectId),
        isNull(agentRequirementSetTable.deletedAt),
      ),
    )
    .groupBy(agentRequirementSetTable.id)
    .orderBy(desc(agentRequirementSetTable.updatedAt));
  return rows.map((row) => ({ ...row, reviewed: row.reviewedAt !== null }));
}

export default listSets;
