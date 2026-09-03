import { and, desc, eq, isNotNull } from "drizzle-orm";
import { actorSelection, liftActor } from "../../agent-entry/actor-response";
import db from "../../database";
import {
  agentActorTable,
  agentArtifactTable,
} from "../../database/schema-agent-layer";
import { toArtifactRecord } from "./artifact-record";

/**
 * Finalized artifacts only, newest first.
 *
 * The actor join is what makes "who wrote this" answerable in one call: a bare
 * `actorId` would force the client into an N+1 just to render an author label.
 * LEFT, because a human upload has no actor row.
 */
async function listArtifacts(projectId: string, taskId?: string) {
  const rows = await db
    .select({ artifact: agentArtifactTable, ...actorSelection })
    .from(agentArtifactTable)
    .leftJoin(
      agentActorTable,
      eq(agentArtifactTable.actorId, agentActorTable.id),
    )
    .where(
      and(
        eq(agentArtifactTable.projectId, projectId),
        isNotNull(agentArtifactTable.finalizedAt),
        taskId ? eq(agentArtifactTable.taskId, taskId) : undefined,
      ),
    )
    .orderBy(desc(agentArtifactTable.createdAt), desc(agentArtifactTable.id));

  return {
    artifacts: rows.map((row) =>
      toArtifactRecord(row.artifact, liftActor(row)),
    ),
  };
}

export default listArtifacts;
