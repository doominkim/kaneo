import { eq } from "drizzle-orm";
import {
  type StaleVerdict,
  type TaskLinkClock,
  taskStale,
} from "../../agent-requirement/stale";
import db from "../../database";
import { taskTable } from "../../database/schema";
import {
  agentDesignTable,
  agentRequirementItemTable,
  agentRequirementSetTable,
  agentTaskDesignTable,
  agentTaskRequirementTable,
} from "../../database/schema-agent-layer";

export type TaskLinkSummary = {
  taskId: string;
  number: number | null;
  title: string;
  status: string | null;
  requirementKeys: string[];
  designFeatures: string[];
  /** Every feature the task derives from, via keys or design. */
  features: string[];
  stale: StaleVerdict;
};

/**
 * Two queries for the whole project: every requirement link and every design
 * link, each with the upstream clock beside the link's own. Board badges,
 * feature summaries and per-feature task lists all read this one shape so
 * "stale" means the same thing on every screen.
 */
export async function collectTaskLinks(
  projectId: string,
): Promise<Map<string, TaskLinkSummary>> {
  const [reqLinks, designLinks] = await Promise.all([
    db
      .select({
        taskId: agentTaskRequirementTable.taskId,
        number: taskTable.number,
        title: taskTable.title,
        status: taskTable.status,
        key: agentRequirementItemTable.key,
        feature: agentRequirementSetTable.feature,
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
      .innerJoin(
        agentRequirementSetTable,
        eq(agentRequirementSetTable.id, agentRequirementItemTable.setId),
      )
      .where(eq(taskTable.projectId, projectId)),
    db
      .select({
        taskId: agentTaskDesignTable.taskId,
        number: taskTable.number,
        title: taskTable.title,
        status: taskTable.status,
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
    Omit<TaskLinkSummary, "stale" | "features"> & {
      clocks: TaskLinkClock[];
      features: Set<string>;
    }
  >();
  const bucket = (row: {
    taskId: string;
    number: number | null;
    title: string;
    status: string | null;
  }) => {
    let entry = byTask.get(row.taskId);
    if (!entry) {
      entry = {
        taskId: row.taskId,
        number: row.number,
        title: row.title,
        status: row.status,
        requirementKeys: [],
        designFeatures: [],
        features: new Set(),
        clocks: [],
      };
      byTask.set(row.taskId, entry);
    }
    return entry;
  };
  for (const link of reqLinks) {
    const entry = bucket(link);
    entry.requirementKeys.push(link.key);
    entry.features.add(link.feature);
    entry.clocks.push({
      kind: "requirement",
      key: link.key,
      upstreamChangedAt: link.updatedAt,
      createdAt: link.createdAt,
      acknowledgedAt: link.acknowledgedAt,
    });
  }
  for (const link of designLinks) {
    const entry = bucket(link);
    entry.designFeatures.push(link.feature);
    entry.features.add(link.feature);
    entry.clocks.push({
      kind: "design",
      key: link.feature,
      upstreamChangedAt: link.approvedAt,
      createdAt: link.createdAt,
      acknowledgedAt: link.acknowledgedAt,
    });
  }
  const out = new Map<string, TaskLinkSummary>();
  for (const [taskId, entry] of byTask) {
    out.set(taskId, {
      taskId,
      number: entry.number,
      title: entry.title,
      status: entry.status,
      requirementKeys: entry.requirementKeys.sort(),
      designFeatures: entry.designFeatures.sort(),
      features: [...entry.features].sort(),
      stale: taskStale(entry.clocks),
    });
  }
  return out;
}
