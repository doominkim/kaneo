import { and, desc, eq, isNotNull } from "drizzle-orm";
import db from "../../database";
import { agentArtifactTable } from "../../database/schema-agent-layer";
import { toArtifactRecord } from "./artifact-record";

/** Finalized artifacts only, newest first. */
async function listArtifacts(projectId: string, taskId?: string) {
  const rows = await db
    .select()
    .from(agentArtifactTable)
    .where(
      and(
        eq(agentArtifactTable.projectId, projectId),
        isNotNull(agentArtifactTable.finalizedAt),
        taskId ? eq(agentArtifactTable.taskId, taskId) : undefined,
      ),
    )
    .orderBy(desc(agentArtifactTable.createdAt), desc(agentArtifactTable.id));

  return { artifacts: rows.map(toArtifactRecord) };
}

export default listArtifacts;
