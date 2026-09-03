import { asc, eq } from "drizzle-orm";
import { actorSelection, liftActor } from "../../agent-entry/actor-response";
import db from "../../database";
import {
  agentActorTable,
  agentDocumentTable,
} from "../../database/schema-agent-layer";

/**
 * Project documents, alphabetical by slug. `body` is excluded at the query
 * level so the cost of listing stays bounded regardless of document size.
 *
 * The actor is joined rather than left as a bare id: a listing that shows only
 * "an agent wrote this" cannot be acted on, and resolving each id client-side
 * would be an N+1 on the one call that exists to avoid them.
 */
async function listDocuments(projectId: string) {
  const rows = await db
    .select({
      id: agentDocumentTable.id,
      slug: agentDocumentTable.slug,
      title: agentDocumentTable.title,
      taskId: agentDocumentTable.taskId,
      updatedBy: agentDocumentTable.updatedBy,
      documentActorId: agentDocumentTable.actorId,
      updatedAt: agentDocumentTable.updatedAt,
      ...actorSelection,
    })
    .from(agentDocumentTable)
    .leftJoin(
      agentActorTable,
      eq(agentDocumentTable.actorId, agentActorTable.id),
    )
    .where(eq(agentDocumentTable.projectId, projectId))
    .orderBy(asc(agentDocumentTable.slug));

  return {
    documents: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      taskId: row.taskId,
      updatedBy: row.updatedBy,
      actorId: row.documentActorId,
      actor: liftActor(row),
      updatedAt: row.updatedAt,
    })),
  };
}

export default listDocuments;
