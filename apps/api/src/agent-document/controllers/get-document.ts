import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { actorSelection, liftActor } from "../../agent-entry/actor-response";
import db from "../../database";
import {
  agentActorTable,
  agentDocumentTable,
} from "../../database/schema-agent-layer";

/**
 * Scoped by project as well as slug: the route's `{projectId}` is what the
 * workspace-access middleware authorized, so a slug is only meaningful inside
 * that project.
 *
 * The actor is joined in so the reader sees which model wrote the body rather
 * than an opaque `actorId` — half of how a deliverable is judged is who wrote
 * it, and a second round trip to find that out is a round trip nobody makes.
 */
async function getDocument(projectId: string, slug: string) {
  const [row] = await db
    .select({ document: agentDocumentTable, ...actorSelection })
    .from(agentDocumentTable)
    .leftJoin(
      agentActorTable,
      eq(agentDocumentTable.actorId, agentActorTable.id),
    )
    .where(
      and(
        eq(agentDocumentTable.projectId, projectId),
        eq(agentDocumentTable.slug, slug),
      ),
    )
    .limit(1);

  if (!row) {
    throw new HTTPException(404, { message: "Document not found" });
  }

  return { ...row.document, actor: liftActor(row) };
}

export default getDocument;
