import { and, asc, eq, isNull } from "drizzle-orm";
import { loadActor } from "../../agent-entry/actor-response";
import { designStale } from "../../agent-requirement/stale";
import db from "../../database";
import { taskTable } from "../../database/schema";
import {
  agentDesignRequirementTable,
  agentRequirementItemTable,
  agentRequirementSetTable,
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
      .innerJoin(
        agentRequirementSetTable,
        and(
          eq(agentRequirementSetTable.id, agentRequirementItemTable.setId),
          isNull(agentRequirementSetTable.deletedAt),
        ),
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
  const stale = designStale(design.revisedAt, requirements);
  const changedKeys = new Set(stale.causes.map((cause) => cause.key));
  return {
    ...design,
    reviewed: design.reviewedAt !== null,
    actor,
    stale,
    requirements: requirements.map((requirement) => ({
      ...requirement,
      changedSinceRevision: changedKeys.has(requirement.key),
    })),
    tasks,
  };
}

export default getDesign;
