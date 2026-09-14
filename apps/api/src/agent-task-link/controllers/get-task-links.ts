import { and, eq, isNull } from "drizzle-orm";
import { type TaskLinkClock, taskStale } from "../../agent-requirement/stale";
import db from "../../database";
import {
  agentDesignTable,
  agentRequirementItemTable,
  agentRequirementSetTable,
  agentTaskDesignTable,
  agentTaskRequirementTable,
} from "../../database/schema-agent-layer";
import { requireTaskInProject } from "./shared";

function withLinkFlags<
  T extends { acknowledgedActorId: string | null; reviewedAt: Date | null },
>({ acknowledgedActorId, reviewedAt, ...link }: T) {
  return {
    ...link,
    acknowledgedByAgent: acknowledgedActorId !== null,
    reviewed: reviewedAt !== null,
  };
}

/** Links to a soft-deleted requirement set or design are hidden, as in `collectTaskLinks`. */
async function getTaskLinks(projectId: string, taskId: string) {
  await requireTaskInProject(projectId, taskId);
  const [requirementRows, designRows] = await Promise.all([
    db
      .select({
        itemId: agentRequirementItemTable.id,
        key: agentRequirementItemTable.key,
        feature: agentRequirementSetTable.feature,
        text: agentRequirementItemTable.text,
        status: agentRequirementItemTable.status,
        updatedAt: agentRequirementItemTable.updatedAt,
        createdAt: agentTaskRequirementTable.createdAt,
        acknowledgedAt: agentTaskRequirementTable.acknowledgedAt,
        acknowledgedActorId: agentTaskRequirementTable.acknowledgedActorId,
        reviewedAt: agentTaskRequirementTable.reviewedAt,
      })
      .from(agentTaskRequirementTable)
      .innerJoin(
        agentRequirementItemTable,
        eq(agentRequirementItemTable.id, agentTaskRequirementTable.itemId),
      )
      .innerJoin(
        agentRequirementSetTable,
        and(
          eq(agentRequirementSetTable.id, agentRequirementItemTable.setId),
          isNull(agentRequirementSetTable.deletedAt),
        ),
      )
      .where(eq(agentTaskRequirementTable.taskId, taskId)),
    db
      .select({
        designId: agentDesignTable.id,
        feature: agentDesignTable.feature,
        title: agentDesignTable.title,
        status: agentDesignTable.status,
        approvedAt: agentDesignTable.approvedAt,
        revisedAt: agentDesignTable.revisedAt,
        createdAt: agentTaskDesignTable.createdAt,
        acknowledgedAt: agentTaskDesignTable.acknowledgedAt,
        acknowledgedActorId: agentTaskDesignTable.acknowledgedActorId,
        reviewedAt: agentTaskDesignTable.reviewedAt,
      })
      .from(agentTaskDesignTable)
      .innerJoin(
        agentDesignTable,
        and(
          eq(agentDesignTable.id, agentTaskDesignTable.designId),
          isNull(agentDesignTable.deletedAt),
        ),
      )
      .where(eq(agentTaskDesignTable.taskId, taskId)),
  ]);

  const clocks: TaskLinkClock[] = [
    ...requirementRows.map((row) => ({
      kind: "requirement" as const,
      key: row.key,
      upstreamChangedAt: row.updatedAt,
      createdAt: row.createdAt,
      acknowledgedAt: row.acknowledgedAt,
    })),
    ...designRows.map((row) => ({
      kind: "design" as const,
      key: row.feature,
      upstreamChangedAt: row.revisedAt,
      createdAt: row.createdAt,
      acknowledgedAt: row.acknowledgedAt,
    })),
  ];
  return {
    taskId,
    requirements: requirementRows.map(withLinkFlags),
    designs: designRows.map(withLinkFlags),
    stale: taskStale(clocks),
  };
}

export default getTaskLinks;
