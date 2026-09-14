import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { designStale } from "../../agent-requirement/stale";
import { collectTaskLinks } from "../../agent-task-link/controllers/collect-task-links";
import db from "../../database";
import { columnTable } from "../../database/schema";
import {
  agentDesignRequirementTable,
  agentDesignTable,
  agentRequirementCoverageTable,
  agentRequirementItemTable,
  agentRequirementSetTable,
} from "../../database/schema-agent-layer";

type Lifecycle = {
  reviewed: boolean;
  revisedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
};

export type FeatureSummary = {
  feature: string;
  title: string;
  requirements:
    | (Lifecycle & {
        status: string;
        approvedAt: Date | null;
        itemCount: number;
        activeCount: number;
        coveredCount: number;
        updatedAt: Date;
      })
    | null;
  design:
    | (Lifecycle & {
        status: string;
        approvedAt: Date | null;
        stale: boolean;
        updatedAt: Date;
      })
    | null;
  tasks: { total: number; done: number; stale: number };
  updatedAt: Date;
};

function lifecycleOf(row: {
  reviewedAt: Date | null;
  revisedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
}): Lifecycle {
  return {
    reviewed: row.reviewedAt !== null,
    revisedAt: row.revisedAt,
    deletedAt: row.deletedAt,
    deletedBy: row.deletedBy,
  };
}

/**
 * One row per feature for the Feature tab (REQ-FEATURE-HUB-2, 18, 19). A
 * feature is a slug shared by a requirement set, a design and task links, so
 * the set of features is the union of set.feature and design.feature.
 *
 * Fixed number of queries whatever the project size (REQ-FEATURE-HUB-9):
 * sets+items, designs+their item clocks, coverage, columns, and the two
 * link queries inside collectTaskLinks.
 *
 * Soft-deleted documents are left out by default; `deleted` lists only them
 * instead. Design staleness and task counts always read the live documents,
 * because those are what a task is currently derived from.
 */
async function listFeatures(
  projectId: string,
  options: { deleted?: boolean } = {},
): Promise<FeatureSummary[]> {
  const deletedFilter = (column: Parameters<typeof isNull>[0]) =>
    options.deleted ? isNotNull(column) : isNull(column);
  const [sets, items, designs, designItems, finalColumns, links] =
    await Promise.all([
      db
        .select()
        .from(agentRequirementSetTable)
        .where(
          and(
            eq(agentRequirementSetTable.projectId, projectId),
            deletedFilter(agentRequirementSetTable.deletedAt),
          ),
        ),
      db
        .select({
          id: agentRequirementItemTable.id,
          setId: agentRequirementItemTable.setId,
          key: agentRequirementItemTable.key,
          status: agentRequirementItemTable.status,
          updatedAt: agentRequirementItemTable.updatedAt,
        })
        .from(agentRequirementItemTable)
        .innerJoin(
          agentRequirementSetTable,
          eq(agentRequirementSetTable.id, agentRequirementItemTable.setId),
        )
        .where(
          and(
            eq(agentRequirementItemTable.projectId, projectId),
            deletedFilter(agentRequirementSetTable.deletedAt),
          ),
        ),
      db
        .select()
        .from(agentDesignTable)
        .where(
          and(
            eq(agentDesignTable.projectId, projectId),
            deletedFilter(agentDesignTable.deletedAt),
          ),
        ),
      db
        .select({
          designId: agentDesignRequirementTable.designId,
          key: agentRequirementItemTable.key,
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
        .where(eq(agentRequirementItemTable.projectId, projectId)),
      db
        .select({ slug: columnTable.slug })
        .from(columnTable)
        .where(
          and(
            eq(columnTable.projectId, projectId),
            eq(columnTable.isFinal, true),
          ),
        ),
      collectTaskLinks(projectId),
    ]);

  const itemIds = items.map((item) => item.id);
  const covered = itemIds.length
    ? await db
        .selectDistinct({ itemId: agentRequirementCoverageTable.itemId })
        .from(agentRequirementCoverageTable)
        .where(inArray(agentRequirementCoverageTable.itemId, itemIds))
    : [];
  const coveredIds = new Set(covered.map((row) => row.itemId));
  const doneSlugs = new Set(finalColumns.map((column) => column.slug));

  const itemsBySet = new Map<string, typeof items>();
  for (const item of items) {
    const list = itemsBySet.get(item.setId) ?? [];
    list.push(item);
    itemsBySet.set(item.setId, list);
  }
  const designItemsBy = new Map<
    string,
    Array<{ key: string; updatedAt: Date }>
  >();
  for (const row of designItems) {
    const list = designItemsBy.get(row.designId) ?? [];
    list.push({ key: row.key, updatedAt: row.updatedAt });
    designItemsBy.set(row.designId, list);
  }
  const tasksByFeature = new Map<
    string,
    { total: number; done: number; stale: number }
  >();
  for (const task of links.values()) {
    for (const feature of task.features) {
      const bucket = tasksByFeature.get(feature) ?? {
        total: 0,
        done: 0,
        stale: 0,
      };
      bucket.total += 1;
      if (task.status && doneSlugs.has(task.status)) bucket.done += 1;
      if (task.stale.stale) bucket.stale += 1;
      tasksByFeature.set(feature, bucket);
    }
  }

  const features = new Map<string, FeatureSummary>();
  for (const set of sets) {
    const setItems = itemsBySet.get(set.id) ?? [];
    const active = setItems.filter((item) => item.status === "active");
    features.set(set.feature, {
      feature: set.feature,
      title: set.title,
      requirements: {
        status: set.status,
        approvedAt: set.approvedAt,
        ...lifecycleOf(set),
        itemCount: setItems.length,
        activeCount: active.length,
        coveredCount: active.filter((item) => coveredIds.has(item.id)).length,
        updatedAt: set.updatedAt,
      },
      design: null,
      tasks: tasksByFeature.get(set.feature) ?? { total: 0, done: 0, stale: 0 },
      updatedAt: set.updatedAt,
    });
  }
  for (const design of designs) {
    const existing = features.get(design.feature);
    const summary = {
      status: design.status,
      approvedAt: design.approvedAt,
      ...lifecycleOf(design),
      stale: designStale(design.revisedAt, designItemsBy.get(design.id) ?? [])
        .stale,
      updatedAt: design.updatedAt,
    };
    if (existing) {
      existing.design = summary;
      if (design.updatedAt > existing.updatedAt)
        existing.updatedAt = design.updatedAt;
    } else {
      features.set(design.feature, {
        feature: design.feature,
        title: design.title,
        requirements: null,
        design: summary,
        tasks: tasksByFeature.get(design.feature) ?? {
          total: 0,
          done: 0,
          stale: 0,
        },
        updatedAt: design.updatedAt,
      });
    }
  }
  return [...features.values()].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
}

export default listFeatures;
