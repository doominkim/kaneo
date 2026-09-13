import { eq } from "drizzle-orm";
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

async function getTaskLinks(projectId: string, taskId: string) {
  await requireTaskInProject(projectId, taskId);
  const [requirements, designs] = await Promise.all([
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
      })
      .from(agentTaskRequirementTable)
      .innerJoin(
        agentRequirementItemTable,
        eq(agentRequirementItemTable.id, agentTaskRequirementTable.itemId),
      )
      .innerJoin(
        agentRequirementSetTable,
        eq(agentRequirementSetTable.id, agentRequirementItemTable.setId),
      )
      .where(eq(agentTaskRequirementTable.taskId, taskId)),
    db
      .select({
        designId: agentDesignTable.id,
        feature: agentDesignTable.feature,
        title: agentDesignTable.title,
        status: agentDesignTable.status,
        approvedAt: agentDesignTable.approvedAt,
        createdAt: agentTaskDesignTable.createdAt,
        acknowledgedAt: agentTaskDesignTable.acknowledgedAt,
      })
      .from(agentTaskDesignTable)
      .innerJoin(
        agentDesignTable,
        eq(agentDesignTable.id, agentTaskDesignTable.designId),
      )
      .where(eq(agentTaskDesignTable.taskId, taskId)),
  ]);

  const clocks: TaskLinkClock[] = [
    ...requirements.map((row) => ({
      kind: "requirement" as const,
      key: row.key,
      upstreamChangedAt: row.updatedAt,
      createdAt: row.createdAt,
      acknowledgedAt: row.acknowledgedAt,
    })),
    ...designs.map((row) => ({
      kind: "design" as const,
      key: row.feature,
      upstreamChangedAt: row.approvedAt,
      createdAt: row.createdAt,
      acknowledgedAt: row.acknowledgedAt,
    })),
  ];
  return { taskId, requirements, designs, stale: taskStale(clocks) };
}

export default getTaskLinks;
