import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { agentArtifactTable } from "../../database/schema-agent-layer";
import { ArtifactObjectMissingError, headArtifactObject } from "../storage";
import { toArtifactRecord } from "./artifact-record";

type FinalizeInput = {
  projectId: string;
  artifactId: string;
  storageKey: string;
};

const MISMATCH_MESSAGE = "Uploaded file does not match the finalize request.";

/**
 * Step two. Verifies the object in storage against the row written at presign
 * and stamps `finalizedAt`. Attribution (`uploadedBy`/`actorId`) is left as
 * presign wrote it: rewriting it here would re-attribute an agent's upload to
 * whichever human token happened to finalize it. Idempotent: a second call on a finalized artifact
 * returns it without another HeadObject, so a client that lost the first
 * response can safely retry. A mismatch leaves the row pending — the client
 * may re-upload to the same URL until it expires and finalize again.
 *
 * Error mapping mirrors the task image finalize: missing object or metadata
 * mismatch → 400 (the upload is wrong), any other storage failure → 503 (we
 * could not tell).
 */
async function finalizeArtifact(input: FinalizeInput) {
  const [row] = await db
    .select()
    .from(agentArtifactTable)
    .where(
      and(
        eq(agentArtifactTable.id, input.artifactId),
        eq(agentArtifactTable.projectId, input.projectId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new HTTPException(404, { message: "Artifact not found" });
  }
  if (row.storageKey !== input.storageKey.trim()) {
    throw new HTTPException(400, {
      message: "storageKey does not match the presigned artifact",
    });
  }
  if (row.finalizedAt) {
    return toArtifactRecord(row);
  }

  let object: Awaited<ReturnType<typeof headArtifactObject>>;
  try {
    object = await headArtifactObject(row.storageKey);
  } catch (error) {
    if (error instanceof ArtifactObjectMissingError) {
      throw new HTTPException(400, { message: MISMATCH_MESSAGE });
    }
    throw new HTTPException(503, {
      message: "Unable to verify uploaded file.",
    });
  }
  if (
    object.contentLength !== row.size ||
    (object.contentType ?? "").toLowerCase() !== row.contentType
  ) {
    throw new HTTPException(400, { message: MISMATCH_MESSAGE });
  }

  const [finalized] = await db
    .update(agentArtifactTable)
    .set({ finalizedAt: new Date() })
    .where(eq(agentArtifactTable.id, row.id))
    .returning();
  if (!finalized) {
    throw new HTTPException(500, { message: "Failed to finalize artifact" });
  }
  return toArtifactRecord(finalized);
}

export default finalizeArtifact;
