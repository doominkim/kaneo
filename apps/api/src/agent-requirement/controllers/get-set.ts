import { asc, eq, inArray } from "drizzle-orm";
import { loadActor } from "../../agent-entry/actor-response";
import db from "../../database";
import { taskTable } from "../../database/schema";
import {
  agentDesignRequirementTable,
  agentDesignTable,
  agentRequirementCoverageTable,
  agentRequirementItemTable,
  agentTaskRequirementTable,
} from "../../database/schema-agent-layer";
import { requireSet } from "./shared";

/**
 * One set with its items; each item carries where it went (designs, tasks)
 * and which tests cite it, so the 요구사항 tab can answer "is this covered?"
 * without a second round-trip (REQ-SPEC-TABS-11, 17).
 */
async function getSet(projectId: string, feature: string) {
  const set = await requireSet(projectId, feature);
  const items = await db
    .select()
    .from(agentRequirementItemTable)
    .where(eq(agentRequirementItemTable.setId, set.id))
    .orderBy(asc(agentRequirementItemTable.seq));
  const itemIds = items.map((item) => item.id);
  const actor = await loadActor(set.actorId);
  if (itemIds.length === 0) {
    return { ...set, actor, items: [] };
  }

  const [coverage, designLinks, taskLinks] = await Promise.all([
    db
      .select()
      .from(agentRequirementCoverageTable)
      .where(inArray(agentRequirementCoverageTable.itemId, itemIds)),
    db
      .select({
        itemId: agentDesignRequirementTable.itemId,
        designId: agentDesignRequirementTable.designId,
        feature: agentDesignTable.feature,
        title: agentDesignTable.title,
        status: agentDesignTable.status,
      })
      .from(agentDesignRequirementTable)
      .innerJoin(
        agentDesignTable,
        eq(agentDesignTable.id, agentDesignRequirementTable.designId),
      )
      .where(inArray(agentDesignRequirementTable.itemId, itemIds)),
    db
      .select({
        itemId: agentTaskRequirementTable.itemId,
        taskId: agentTaskRequirementTable.taskId,
        number: taskTable.number,
        title: taskTable.title,
        status: taskTable.status,
      })
      .from(agentTaskRequirementTable)
      .innerJoin(taskTable, eq(taskTable.id, agentTaskRequirementTable.taskId))
      .where(inArray(agentTaskRequirementTable.itemId, itemIds)),
  ]);

  const group = <T extends { itemId: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      const list = map.get(row.itemId) ?? [];
      list.push(row);
      map.set(row.itemId, list);
    }
    return map;
  };
  const coverageBy = group(coverage);
  const designBy = group(designLinks);
  const taskBy = group(taskLinks);

  return {
    ...set,
    actor,
    items: items.map((item) => ({
      ...item,
      coverage: (coverageBy.get(item.id) ?? []).map(
        ({ repo, testPath, testName, reportedAt }) => ({
          repo,
          testPath,
          testName,
          reportedAt,
        }),
      ),
      designs: (designBy.get(item.id) ?? []).map(
        ({ designId, feature, title, status }) => ({
          id: designId,
          feature,
          title,
          status,
        }),
      ),
      tasks: (taskBy.get(item.id) ?? []).map(
        ({ taskId, number, title, status }) => ({
          id: taskId,
          number,
          title,
          status,
        }),
      ),
    })),
  };
}

export default getSet;
