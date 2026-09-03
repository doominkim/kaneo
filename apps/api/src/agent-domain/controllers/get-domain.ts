import { and, asc, desc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { actorSelection, liftActor } from "../../agent-entry/actor-response";
import db, { schema } from "../../database";
import {
  agentActorTable,
  agentDocumentTable,
  agentDomainTable,
  agentProjectDomainTable,
  agentTermTable,
} from "../../database/schema-agent-layer";
import { loadAncestors } from "./domain-lookup";
import { toDomainRecord } from "./domain-record";

/**
 * The page with everything linked to it, in one call. The links are
 * aggregated here rather than stored on the page: a term or document names
 * its domain, and the page view is a query over that, so nothing can drift.
 */
async function getDomain(workspaceId: string, domainId: string) {
  const [row] = await db
    .select({
      domain: agentDomainTable,
      authorId: schema.userTable.id,
      authorName: schema.userTable.name,
      ...actorSelection,
    })
    .from(agentDomainTable)
    .leftJoin(
      schema.userTable,
      eq(agentDomainTable.updatedBy, schema.userTable.id),
    )
    .leftJoin(agentActorTable, eq(agentDomainTable.actorId, agentActorTable.id))
    .where(
      and(
        eq(agentDomainTable.id, domainId),
        eq(agentDomainTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!row) {
    throw new HTTPException(404, { message: "Domain not found" });
  }

  const [ancestors, children, terms, projects, documents] = await Promise.all([
    loadAncestors(workspaceId, row.domain.parentId),
    db
      .select({
        id: agentDomainTable.id,
        slug: agentDomainTable.slug,
        title: agentDomainTable.title,
      })
      .from(agentDomainTable)
      .where(eq(agentDomainTable.parentId, domainId))
      .orderBy(asc(agentDomainTable.position), asc(agentDomainTable.title)),
    db
      .select({
        id: agentTermTable.id,
        canonical: agentTermTable.canonical,
        confidence: agentTermTable.confidence,
        state: agentTermTable.state,
      })
      .from(agentTermTable)
      .where(eq(agentTermTable.domainId, domainId))
      .orderBy(asc(agentTermTable.canonical)),
    db
      .select({
        id: schema.projectTable.id,
        name: schema.projectTable.name,
        slug: schema.projectTable.slug,
      })
      .from(agentProjectDomainTable)
      .innerJoin(
        schema.projectTable,
        eq(agentProjectDomainTable.projectId, schema.projectTable.id),
      )
      .where(eq(agentProjectDomainTable.domainId, domainId))
      .orderBy(asc(schema.projectTable.name)),
    db
      .select({
        id: agentDocumentTable.id,
        projectId: agentDocumentTable.projectId,
        slug: agentDocumentTable.slug,
        title: agentDocumentTable.title,
        updatedAt: agentDocumentTable.updatedAt,
      })
      .from(agentDocumentTable)
      .where(eq(agentDocumentTable.domainId, domainId))
      .orderBy(
        desc(agentDocumentTable.updatedAt),
        asc(agentDocumentTable.slug),
      ),
  ]);

  return {
    ...toDomainRecord(
      row.domain,
      row.authorId && row.authorName
        ? { userId: row.authorId, name: row.authorName }
        : null,
      liftActor(row),
    ),
    ancestors,
    children,
    terms,
    projects,
    documents,
  };
}

export default getDomain;
