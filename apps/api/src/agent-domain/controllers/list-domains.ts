import { asc, eq, sql } from "drizzle-orm";
import db from "../../database";
import {
  agentDomainTable,
  agentTermTable,
} from "../../database/schema-agent-layer";

type KnowledgeCounts = {
  proposedCount: number;
  confirmedCount: number;
  disputedCount: number;
};

const noCounts = (): KnowledgeCounts => ({
  proposedCount: 0,
  confirmedCount: 0,
  disputedCount: 0,
});

/**
 * Every page of the workspace as a flat list; the client builds the tree.
 * Flat because a workspace sidebar needs all of it anyway, and one ordered
 * list is cheaper to ship and to diff than nested JSON.
 *
 * `childCount` is a correlated count rather than a join so the query stays a
 * single index scan per row; the client uses it to draw the expander.
 *
 * The knowledge counts are NOT three more correlated subqueries. Three would
 * probe `agent_term_domainId_idx` three times per page to read the same rows,
 * and they still could not produce the unfiled bucket: `domain_id IS NULL`
 * belongs to no row, and a workspace with no pages at all returns no rows to
 * hang it on. One grouped pass over the workspace's terms answers both — the
 * NULL group is the unfiled bucket — and it runs alongside the tree query.
 */
async function listDomains(workspaceId: string) {
  const [rows, counts] = await Promise.all([
    db
      .select({
        id: agentDomainTable.id,
        parentId: agentDomainTable.parentId,
        slug: agentDomainTable.slug,
        title: agentDomainTable.title,
        position: agentDomainTable.position,
        updatedAt: agentDomainTable.updatedAt,
        // Written out rather than interpolated: on a single-table select
        // drizzle renders the outer column unqualified ("id"), which the
        // subquery's alias would capture, so every count came back 0.
        childCount: sql<number>`(
        select count(*) from agent_domain as child
        where child.parent_id = agent_domain.id
      )`.mapWith(Number),
      })
      .from(agentDomainTable)
      .where(eq(agentDomainTable.workspaceId, workspaceId))
      .orderBy(
        sql`${agentDomainTable.parentId} asc nulls first`,
        asc(agentDomainTable.position),
        asc(agentDomainTable.title),
      ),
    db
      .select({
        domainId: agentTermTable.domainId,
        proposedCount:
          sql<number>`count(*) filter (where ${agentTermTable.confidence} = 'proposed')`.mapWith(
            Number,
          ),
        confirmedCount:
          sql<number>`count(*) filter (where ${agentTermTable.confidence} = 'confirmed')`.mapWith(
            Number,
          ),
        disputedCount:
          sql<number>`count(*) filter (where ${agentTermTable.confidence} = 'disputed')`.mapWith(
            Number,
          ),
      })
      .from(agentTermTable)
      .where(eq(agentTermTable.workspaceId, workspaceId))
      .groupBy(agentTermTable.domainId),
  ]);

  const filed = new Map<string, KnowledgeCounts>();
  let unfiled = noCounts();
  for (const row of counts) {
    const bucket: KnowledgeCounts = {
      proposedCount: row.proposedCount,
      confirmedCount: row.confirmedCount,
      disputedCount: row.disputedCount,
    };
    if (row.domainId === null) unfiled = bucket;
    else filed.set(row.domainId, bucket);
  }

  return {
    domains: rows.map((row) => ({
      ...row,
      ...(filed.get(row.id) ?? noCounts()),
    })),
    unfiled,
  };
}

export default listDomains;
