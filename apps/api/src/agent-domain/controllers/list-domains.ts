import { asc, eq, sql } from "drizzle-orm";
import db from "../../database";
import { agentDomainTable } from "../../database/schema-agent-layer";

/**
 * Every page of the workspace as a flat list; the client builds the tree.
 * Flat because a workspace sidebar needs all of it anyway, and one ordered
 * list is cheaper to ship and to diff than nested JSON.
 *
 * `childCount` is a correlated count rather than a join so the query stays a
 * single index scan per row; the client uses it to draw the expander.
 */
async function listDomains(workspaceId: string) {
  const rows = await db
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
    );

  return { domains: rows };
}

export default listDomains;
