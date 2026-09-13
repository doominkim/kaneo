import { and, eq, notInArray } from "drizzle-orm";
import { resolveItemsByKey } from "../../agent-requirement/controllers/shared";
import db from "../../database";
import {
  agentTaskDesignTable,
  agentTaskRequirementTable,
} from "../../database/schema-agent-layer";
import { requireTaskInProject, resolveDesignsByFeature } from "./shared";

/**
 * Replace a task's links (REQ-SPEC-TABS-7). Links that already exist are kept
 * as-is so their `createdAt`/`acknowledgedAt` clocks survive a re-PUT; only
 * missing ones are inserted and absent ones deleted.
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
          ids.length
            ? and(
                eq(agentTaskRequirementTable.taskId, input.taskId),
                notInArray(agentTaskRequirementTable.itemId, ids),
              )
            : eq(agentTaskRequirementTable.taskId, input.taskId),
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
      await tx
        .delete(agentTaskDesignTable)
        .where(
          ids.length
            ? and(
                eq(agentTaskDesignTable.taskId, input.taskId),
                notInArray(agentTaskDesignTable.designId, ids),
              )
            : eq(agentTaskDesignTable.taskId, input.taskId),
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
