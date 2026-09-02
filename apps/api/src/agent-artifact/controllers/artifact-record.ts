import type { AgentArtifact } from "../../database/schema-agent-layer";

/** Public shape: no storageKey, no finalizedAt, no workspaceId. */
export function toArtifactRecord(row: AgentArtifact) {
  return {
    id: row.id,
    projectId: row.projectId,
    taskId: row.taskId,
    name: row.name,
    contentType: row.contentType,
    size: row.size,
    uploadedBy: row.uploadedBy,
    actorId: row.actorId,
    createdAt: row.createdAt,
  };
}

export type ArtifactRecord = ReturnType<typeof toArtifactRecord>;
