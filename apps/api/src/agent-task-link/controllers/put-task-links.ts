import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import {
  liveItemIds,
  resolveItemsByKey,
} from "../../agent-requirement/controllers/shared";
import db from "../../database";
import {
  agentDesignTable,
  agentTaskDesignTable,
  agentTaskRequirementTable,
} from "../../database/schema-agent-layer";
import { requireTaskInProject, resolveDesignsByFeature } from "./shared";

/**
 * Replace a task's links (REQ-SPEC-TABS-7). Links that already exist are kept
 * as-is so their `createdAt`/`acknowledgedAt` clocks survive a re-PUT; only
 * missing ones are inserted and absent ones deleted.
 *
 * "Absent" only covers links a caller can see. A link to a soft-deleted
 * requirement set or design is hidden from every read, so no payload names
 * it; it is left in place and shows again when the document is restored.
 */
async function putTaskLinks(input: {
  projectId: string;
  taskId: string;
  requirementKeys?: string[];
  designFeatures?: string[];
}) {
  await requireTaskInProject(input.projectId, input.taskId);
  const items = input.requirementKeys
    ? await resolveItemsByKey(input.projectId, input.requirementKeys)
    : null;
  const designs = input.designFeatures
    ? await resolveDesignsByFeature(input.projectId, input.designFeatures)
    : null;

  await db.transaction(async (tx) => {
    if (items) {
      const ids = items.map((item) => item.id);
      await tx
        .delete(agentTaskRequirementTable)
        .where(
          and(
            eq(agentTaskRequirementTable.taskId, input.taskId),
            inArray(
              agentTaskRequirementTable.itemId,
              liveItemIds(input.projectId),
            ),
            ids.length
              ? notInArray(agentTaskRequirementTable.itemId, ids)
              : undefined,
          ),
        );
      if (ids.length) {
        await tx
          .insert(agentTaskRequirementTable)
          .values(ids.map((itemId) => ({ taskId: input.taskId, itemId })))
          .onConflictDoNothing();
      }
    }
    if (designs) {
      const ids = designs.map((design) => design.id);
      const liveDesignIds = db
        .select({ id: agentDesignTable.id })
        .from(agentDesignTable)
        .where(
          and(
            eq(agentDesignTable.projectId, input.projectId),
            isNull(agentDesignTable.deletedAt),
          ),
        );
      await tx
        .delete(agentTaskDesignTable)
        .where(
          and(
            eq(agentTaskDesignTable.taskId, input.taskId),
            inArray(agentTaskDesignTable.designId, liveDesignIds),
            ids.length
              ? notInArray(agentTaskDesignTable.designId, ids)
              : undefined,
          ),
        );
      if (ids.length) {
        await tx
          .insert(agentTaskDesignTable)
          .values(ids.map((designId) => ({ taskId: input.taskId, designId })))
          .onConflictDoNothing();
      }
    }
  });
}

export default putTaskLinks;
