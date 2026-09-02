import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { agentDocumentTable } from "../../database/schema-agent-layer";

/**
 * Scoped by project as well as slug: the route's `{projectId}` is what the
 * workspace-access middleware authorized, so a slug is only meaningful inside
 * that project.
 */
async function getDocument(projectId: string, slug: string) {
  const [document] = await db
    .select()
    .from(agentDocumentTable)
    .where(
      and(
        eq(agentDocumentTable.projectId, projectId),
        eq(agentDocumentTable.slug, slug),
      ),
    )
    .limit(1);

  if (!document) {
    throw new HTTPException(404, { message: "Document not found" });
  }

  return document;
}

export default getDocument;
