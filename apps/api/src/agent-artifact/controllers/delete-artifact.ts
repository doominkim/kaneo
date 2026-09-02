import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { agentArtifactTable } from "../../database/schema-agent-layer";
import { deleteArtifactObject } from "../storage";

/**
 * Object first, row second. If the object delete fails the row stays and the
 * caller can retry; the reverse order would leave an untracked object. A
 * pending (never finalized) row is deletable too — that is the manual cleanup
 * path for abandoned uploads.
 */
async function deleteArtifact(projectId: string, artifactId: string) {
  const [row] = await db
    .select({
      id: agentArtifactTable.id,
      storageKey: agentArtifactTable.storageKey,
    })
    .from(agentArtifactTable)
    .where(
      and(
        eq(agentArtifactTable.id, artifactId),
        eq(agentArtifactTable.projectId, projectId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new HTTPException(404, { message: "Artifact not found" });
  }

  try {
    await deleteArtifactObject(row.storageKey);
  } catch (error) {
    throw new HTTPException(503, {
      message:
        error instanceof Error ? error.message : "Artifact storage unavailable",
    });
  }

  await db.delete(agentArtifactTable).where(eq(agentArtifactTable.id, row.id));
  return { id: row.id };
}

export default deleteArtifact;
