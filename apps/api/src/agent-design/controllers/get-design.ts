import { asc, eq } from "drizzle-orm";
import { loadActor } from "../../agent-entry/actor-response";
import { designStale } from "../../agent-requirement/stale";
import db from "../../database";
import { taskTable } from "../../database/schema";
import {
  agentDesignRequirementTable,
  agentRequirementItemTable,
  agentTaskDesignTable,
} from "../../database/schema-agent-layer";
import { requireDesign } from "./shared";

async function getDesign(projectId: string, feature: string) {
  const design = await requireDesign(projectId, feature);
  const [actor, requirements, tasks] = await Promise.all([
    loadActor(design.actorId),
    db
      .select({
        itemId: agentRequirementItemTable.id,
        key: agentRequirementItemTable.key,
        text: agentRequirementItemTable.text,
        status: agentRequirementItemTable.status,
        updatedAt: agentRequirementItemTable.updatedAt,
      })
      .from(agentDesignRequirementTable)
      .innerJoin(
        agentRequirementItemTable,
        eq(agentRequirementItemTable.id, agentDesignRequirementTable.itemId),
      )
      .where(eq(agentDesignRequirementTable.designId, design.id))
      .orderBy(asc(agentRequirementItemTable.seq)),
    db
      .select({
        id: taskTable.id,
        number: taskTable.number,
        title: taskTable.title,
        status: taskTable.status,
      })
      .from(agentTaskDesignTable)
      .innerJoin(taskTable, eq(taskTable.id, agentTaskDesignTable.taskId))
      .where(eq(agentTaskDesignTable.designId, design.id)),
  ]);
  const stale = designStale(design.approvedAt, requirements);
  const changedKeys = new Set(stale.causes.map((cause) => cause.key));
  return {
    ...design,
    actor,
    stale,
    requirements: requirements.map((requirement) => ({
      ...requirement,
      changedSinceApproval: changedKeys.has(requirement.key),
    })),
    tasks,
  };
}

export default getDesign;
