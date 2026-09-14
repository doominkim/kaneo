import { eq } from "drizzle-orm";
import db from "../../database";
import {
  agentTaskDesignTable,
  agentTaskRequirementTable,
} from "../../database/schema-agent-layer";
import { requireTaskInProject } from "./shared";

/**
 * A person signs off the task's links, typically an agent's acknowledgement.
 * Only the review marker moves: the stale clock stays where the
 * acknowledgement put it, and no timeline entry is written.
 */
async function reviewTaskLinks(input: { projectId: string; taskId: string }) {
  await requireTaskInProject(input.projectId, input.taskId);
  const reviewedAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(agentTaskRequirementTable)
      .set({ reviewedAt })
      .where(eq(agentTaskRequirementTable.taskId, input.taskId));
    await tx
      .update(agentTaskDesignTable)
      .set({ reviewedAt })
      .where(eq(agentTaskDesignTable.taskId, input.taskId));
  });
  return { taskId: input.taskId, reviewedAt };
}

export default reviewTaskLinks;
