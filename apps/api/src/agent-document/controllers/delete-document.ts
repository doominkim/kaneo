import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { agentDocumentTable } from "../../database/schema-agent-layer";

async function deleteDocument(projectId: string, slug: string) {
  const [deleted] = await db
    .delete(agentDocumentTable)
    .where(
      and(
        eq(agentDocumentTable.projectId, projectId),
        eq(agentDocumentTable.slug, slug),
      ),
    )
    .returning({ id: agentDocumentTable.id, slug: agentDocumentTable.slug });

  if (!deleted) {
    throw new HTTPException(404, { message: "Document not found" });
  }

  return deleted;
}

export default deleteDocument;
