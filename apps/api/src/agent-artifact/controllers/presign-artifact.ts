import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../../database";
import { agentArtifactTable } from "../../database/schema-agent-layer";
import { buildArtifactKey, normalizeArtifactContentType } from "../policy";
import { createArtifactUploadUrl, toStorageKey } from "../storage";

type PresignInput = {
  workspaceId: string;
  projectId: string;
  userId: string;
  name: string;
  contentType: string;
  size: number;
  taskId?: string | null;
};

/**
 * Step one of two. The row is inserted now, unfinalized, so that finalize can
 * check the object against exactly what was declared here instead of trusting
 * a second copy of size/contentType from the client. Unfinalized rows are
 * invisible to every read path; see the schema comment for the orphan story.
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

  if (input.taskId) {
    const [task] = await db
      .select({ id: schema.taskTable.id })
      .from(schema.taskTable)
      .where(
        and(
          eq(schema.taskTable.id, input.taskId),
          eq(schema.taskTable.projectId, input.projectId),
        ),
      )
      .limit(1);
    if (!task) {
      throw new HTTPException(400, {
        message: "taskId does not belong to this project",
      });
    }
  }

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
      uploadedBy: input.userId,
      actorId: null,
      finalizedAt: null,
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
