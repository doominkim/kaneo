import { eq } from "drizzle-orm";
import { type TaskLinkClock, taskStale } from "../../agent-requirement/stale";
import db from "../../database";
import { taskTable } from "../../database/schema";
import {
  agentDesignTable,
  agentRequirementItemTable,
  agentTaskDesignTable,
  agentTaskRequirementTable,
} from "../../database/schema-agent-layer";

/** Per-task badge data for the board (REQ-SPEC-TABS-13): keys, features, stale. */
async function listTaskLinkBadges(projectId: string) {
  const [reqLinks, designLinks] = await Promise.all([
    db
      .select({
        taskId: agentTaskRequirementTable.taskId,
        key: agentRequirementItemTable.key,
        updatedAt: agentRequirementItemTable.updatedAt,
        createdAt: agentTaskRequirementTable.createdAt,
        acknowledgedAt: agentTaskRequirementTable.acknowledgedAt,
      })
      .from(agentTaskRequirementTable)
      .innerJoin(taskTable, eq(taskTable.id, agentTaskRequirementTable.taskId))
      .innerJoin(
        agentRequirementItemTable,
        eq(agentRequirementItemTable.id, agentTaskRequirementTable.itemId),
      )
      .where(eq(taskTable.projectId, projectId)),
    db
      .select({
        taskId: agentTaskDesignTable.taskId,
        feature: agentDesignTable.feature,
        approvedAt: agentDesignTable.approvedAt,
        createdAt: agentTaskDesignTable.createdAt,
        acknowledgedAt: agentTaskDesignTable.acknowledgedAt,
      })
      .from(agentTaskDesignTable)
      .innerJoin(taskTable, eq(taskTable.id, agentTaskDesignTable.taskId))
      .innerJoin(
        agentDesignTable,
        eq(agentDesignTable.id, agentTaskDesignTable.designId),
      )
      .where(eq(taskTable.projectId, projectId)),
  ]);

  const byTask = new Map<
    string,
    {
      requirementKeys: string[];
      designFeatures: string[];
      clocks: TaskLinkClock[];
    }
  >();
  const bucket = (taskId: string) => {
    let entry = byTask.get(taskId);
    if (!entry) {
      entry = { requirementKeys: [], designFeatures: [], clocks: [] };
      byTask.set(taskId, entry);
    }
    return entry;
  };
  for (const link of reqLinks) {
    const entry = bucket(link.taskId);
    entry.requirementKeys.push(link.key);
    entry.clocks.push({
      kind: "requirement",
      key: link.key,
      upstreamChangedAt: link.updatedAt,
      createdAt: link.createdAt,
      acknowledgedAt: link.acknowledgedAt,
    });
  }
  for (const link of designLinks) {
    const entry = bucket(link.taskId);
    entry.designFeatures.push(link.feature);
    entry.clocks.push({
      kind: "design",
      key: link.feature,
      upstreamChangedAt: link.approvedAt,
      createdAt: link.createdAt,
      acknowledgedAt: link.acknowledgedAt,
    });
  }
  return [...byTask.entries()].map(([taskId, entry]) => ({
    taskId,
    requirementKeys: entry.requirementKeys.sort(),
    designFeatures: entry.designFeatures.sort(),
    stale: taskStale(entry.clocks).stale,
  }));
}

export default listTaskLinkBadges;
