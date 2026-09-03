import { createId } from "@paralleldrive/cuid2";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { agentArtifactTable } from "../../database/schema-agent-layer";
import { buildArtifactKey, normalizeArtifactContentType } from "../policy";
import { createArtifactUploadUrl, toStorageKey } from "../storage";
import { assertTaskInProject } from "./assert-task-in-project";

/** Exactly one is set; the other column is written as NULL. */
export type ArtifactUploader = { userId: string } | { actorId: string };

type PresignInput = {
  workspaceId: string;
  projectId: string;
  uploader: ArtifactUploader;
  name: string;
  contentType: string;
  size: number;
  taskId?: string | null;
};

export function uploaderColumns(uploader: ArtifactUploader) {
  return "userId" in uploader
    ? { uploadedBy: uploader.userId, actorId: null }
    : { uploadedBy: null, actorId: uploader.actorId };
}

/**
 * Step one of two. The row is inserted now, unfinalized, so that finalize can
 * check the object against exactly what was declared here instead of trusting
 * a second copy of size/contentType from the client. Unfinalized rows are
 * invisible to every read path; see the schema comment for the orphan story.
 *
 * Attribution is decided here, not at finalize: the HTTP route passes the
 * human (`userId`), the MCP path passes the agent (`actorId`).
 *
 * Storage is asked to sign only after the row exists, so a storage outage
 * cannot leave a signed URL without a record — the reverse (a row without a
 * URL) is harmless because the row is not surfaced.
 */
async function presignArtifact(input: PresignInput) {
  const contentType = normalizeArtifactContentType(input.contentType);
  if (!contentType) {
    throw new HTTPException(400, {
      message: "contentType is not allowed for artifacts",
    });
  }

  await assertTaskInProject(input.projectId, input.taskId);

  const artifactId = createId();
  const name = input.name.trim();

  let storageKey: string;
  try {
    storageKey = toStorageKey(
      buildArtifactKey({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        artifactId,
        name,
      }),
    );
  } catch (error) {
    throw new HTTPException(503, {
      message:
        error instanceof Error
          ? error.message
          : "Artifact uploads are not configured",
    });
  }

  const [row] = await db
    .insert(agentArtifactTable)
    .values({
      id: artifactId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: input.taskId ?? null,
      name,
      contentType,
      size: input.size,
      storageKey,
      ...uploaderColumns(input.uploader),
      finalizedAt: null,
      // Set by the app, not `defaultNow()`: the DB session time zone is not
      // guaranteed to be UTC (KAN-9), and `createdAt` orders the listing.
      createdAt: new Date(),
    })
    .returning({ id: agentArtifactTable.id });
  if (!row) {
    throw new HTTPException(500, { message: "Failed to record artifact" });
  }

  let upload: Awaited<ReturnType<typeof createArtifactUploadUrl>>;
  try {
    upload = await createArtifactUploadUrl({ storageKey, contentType });
  } catch (error) {
    throw new HTTPException(503, {
      message:
        error instanceof Error
          ? error.message
          : "Artifact uploads are not configured",
    });
  }

  return {
    artifactId,
    uploadUrl: upload.uploadUrl,
    storageKey,
    expiresAt: upload.expiresAt,
    headers: { "Content-Type": contentType },
  };
}

export default presignArtifact;
