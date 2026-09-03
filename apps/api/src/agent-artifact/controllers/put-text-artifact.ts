import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { loadActor } from "../../agent-entry/actor-response";
import db from "../../database";
import { agentArtifactTable } from "../../database/schema-agent-layer";
import {
  buildArtifactKey,
  MAX_TEXT_ARTIFACT_BYTES,
  normalizeTextArtifactContentType,
} from "../policy";
import { putArtifactObject, toStorageKey } from "../storage";
import { toArtifactRecord } from "./artifact-record";
import { assertTaskInProject } from "./assert-task-in-project";
import { uploaderColumns } from "./presign-artifact";

type PutTextInput = {
  workspaceId: string;
  projectId: string;
  actorId: string;
  name: string;
  contentType: string;
  text: string;
  taskId?: string | null;
};

/**
 * One-call path for small text deliverables: the server writes the object and
 * finalizes the row itself, so there is no presign/upload/finalize round trip
 * and no HeadObject — a successful PutObject is the verification.
 *
 * Agent-only by construction: the caller must already hold an actor id, which
 * only the in-process MCP path can produce (see `mcp/agent-direct.ts`).
 *
 * Order is row → object → finalize, as with presign. If the write fails the
 * pending row is removed again: unlike an abandoned presign there is nothing
 * a retry could attach to, so leaving it would only be litter.
 */
async function putTextArtifact(input: PutTextInput) {
  const contentType = normalizeTextArtifactContentType(input.contentType);
  if (!contentType) {
    throw new HTTPException(400, {
      message: "contentType is not allowed for text artifacts",
    });
  }
  const size = Buffer.byteLength(input.text, "utf8");
  if (size < 1 || size > MAX_TEXT_ARTIFACT_BYTES) {
    throw new HTTPException(400, {
      message: "text must be between 1 byte and 200KB",
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
      size,
      storageKey,
      ...uploaderColumns({ actorId: input.actorId }),
      finalizedAt: null,
      createdAt: new Date(),
    })
    .returning({ id: agentArtifactTable.id });
  if (!row) {
    throw new HTTPException(500, { message: "Failed to record artifact" });
  }

  try {
    await putArtifactObject({ storageKey, contentType, body: input.text });
  } catch (error) {
    await db
      .delete(agentArtifactTable)
      .where(eq(agentArtifactTable.id, artifactId))
      .catch(() => undefined);
    throw new HTTPException(503, {
      message:
        error instanceof Error ? error.message : "Artifact storage unavailable",
    });
  }

  const [finalized] = await db
    .update(agentArtifactTable)
    .set({ finalizedAt: new Date() })
    .where(eq(agentArtifactTable.id, artifactId))
    .returning();
  if (!finalized) {
    throw new HTTPException(500, { message: "Failed to finalize artifact" });
  }
  return toArtifactRecord(finalized, await loadActor(finalized.actorId));
}

export default putTextArtifact;
