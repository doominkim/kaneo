import { and, eq, inArray } from "drizzle-orm";
import { liveItemIds } from "../../agent-requirement/controllers/shared";
import db from "../../database";
import {
  agentTaskDesignTable,
  agentTaskRequirementTable,
} from "../../database/schema-agent-layer";
import { liveDesignIds, requireTaskInProject } from "./shared";

/**
 * A person signs off the task's links, typically an agent's acknowledgement.
 * Only the review marker moves: the stale clock stays where the
 * acknowledgement put it, and no timeline entry is written.
 *
 * Only the links the person can see are signed off. A link to a soft-deleted
 * requirement set or design is hidden from the task, so it keeps its marker
 * and shows unreviewed again if it was when the document is restored.
 */
async function reviewTaskLinks(input: { projectId: string; taskId: string }) {
  await requireTaskInProject(input.projectId, input.taskId);
  const reviewedAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(agentTaskRequirementTable)
      .set({ reviewedAt })
      .where(
        and(
          eq(agentTaskRequirementTable.taskId, input.taskId),
          inArray(
            agentTaskRequirementTable.itemId,
            liveItemIds(input.projectId),
          ),
        ),
      );
    await tx
      .update(agentTaskDesignTable)
      .set({ reviewedAt })
      .where(
        and(
          eq(agentTaskDesignTable.taskId, input.taskId),
          inArray(
            agentTaskDesignTable.designId,
            liveDesignIds(input.projectId),
          ),
        ),
      );
  });
  return { taskId: input.taskId, reviewedAt };
}

export default reviewTaskLinks;
