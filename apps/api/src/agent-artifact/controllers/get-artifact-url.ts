import { and, eq, isNotNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { agentArtifactTable } from "../../database/schema-agent-layer";
import {
  type ArtifactContentType,
  type Disposition,
  resolveDisposition,
} from "../policy";
import { createArtifactDownloadUrl } from "../storage";

/**
 * A short-lived presigned GET, minted per click. The row is looked up by
 * (id, project) so an id from another project is a 404 even for a member of
 * both. Pending rows are 404 too: nothing is served before verification.
 */
async function getArtifactUrl(input: {
  projectId: string;
  artifactId: string;
  disposition?: Disposition;
}) {
  const [row] = await db
    .select({
      storageKey: agentArtifactTable.storageKey,
      contentType: agentArtifactTable.contentType,
      name: agentArtifactTable.name,
    })
    .from(agentArtifactTable)
    .where(
      and(
        eq(agentArtifactTable.id, input.artifactId),
        eq(agentArtifactTable.projectId, input.projectId),
        isNotNull(agentArtifactTable.finalizedAt),
      ),
    )
    .limit(1);
  if (!row) {
    throw new HTTPException(404, { message: "Artifact not found" });
  }

  try {
    return await createArtifactDownloadUrl({
      storageKey: row.storageKey,
      contentType: row.contentType,
      name: row.name,
      disposition: resolveDisposition(
        row.contentType as ArtifactContentType,
        input.disposition,
      ),
    });
  } catch (error) {
    throw new HTTPException(503, {
      message:
        error instanceof Error ? error.message : "Artifact storage unavailable",
    });
  }
}

export default getArtifactUrl;
