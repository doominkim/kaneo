import type { ActorResponse } from "../../agent-entry/actor-response";
import type { AgentArtifact } from "../../database/schema-agent-layer";

/**
 * Public shape: no storageKey, no finalizedAt, no workspaceId.
 *
 * `actor` is passed in rather than read here so the listing can lift it from
 * its join and the write paths can look it up once. `actorId` stays alongside
 * it for compatibility with clients written before the join existed.
 */
export function toArtifactRecord(
  row: AgentArtifact,
  actor: ActorResponse | null,
) {
  return {
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    name: row.name,
    contentType: row.contentType,
    size: row.size,
    uploadedBy: row.uploadedBy,
    actorId: row.actorId,
    actor,
    createdAt: row.createdAt,
  };
}

export type ArtifactRecord = ReturnType<typeof toArtifactRecord>;
