import { asc, eq } from "drizzle-orm";
import db from "../../database";
import { agentDocumentTable } from "../../database/schema-agent-layer";

/**
 * Project documents, alphabetical by slug. `body` is excluded at the query
 * level so the cost of listing stays bounded regardless of document size.
 */
async function listDocuments(projectId: string) {
  const documents = await db
    .select({
      id: agentDocumentTable.id,
      slug: agentDocumentTable.slug,
      title: agentDocumentTable.title,
      taskId: agentDocumentTable.taskId,
      updatedBy: agentDocumentTable.updatedBy,
      actorId: agentDocumentTable.actorId,
      updatedAt: agentDocumentTable.updatedAt,
    })
    .from(agentDocumentTable)
    .where(eq(agentDocumentTable.projectId, projectId))
    .orderBy(asc(agentDocumentTable.slug));

  return { documents };
}

export default listDocuments;
