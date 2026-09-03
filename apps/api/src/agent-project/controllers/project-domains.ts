import { asc, eq } from "drizzle-orm";
import db from "../../database";
import {
  agentDomainTable,
  agentProjectDomainTable,
} from "../../database/schema-agent-layer";

export type LinkedDomain = { id: string; slug: string; title: string };

/**
 * The project's linked domain pages, title-ordered. Read independently of
 * the settings row: the link table references `project` directly, so links
 * and settings can exist without each other.
 */
export async function listProjectDomains(
  projectId: string,
): Promise<LinkedDomain[]> {
  return db
    .select({
      id: agentDomainTable.id,
      slug: agentDomainTable.slug,
      title: agentDomainTable.title,
    })
    .from(agentProjectDomainTable)
    .innerJoin(
      agentDomainTable,
      eq(agentProjectDomainTable.domainId, agentDomainTable.id),
    )
    .where(eq(agentProjectDomainTable.projectId, projectId))
    .orderBy(asc(agentDomainTable.title), asc(agentDomainTable.id));
}
