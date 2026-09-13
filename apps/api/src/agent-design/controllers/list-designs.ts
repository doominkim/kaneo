import { desc, eq, inArray } from "drizzle-orm";
import { designStale } from "../../agent-requirement/stale";
import db from "../../database";
import {
  agentDesignRequirementTable,
  agentDesignTable,
  agentRequirementItemTable,
} from "../../database/schema-agent-layer";

async function listDesigns(projectId: string) {
  const designs = await db
    .select({
      id: agentDesignTable.id,
      feature: agentDesignTable.feature,
      title: agentDesignTable.title,
      status: agentDesignTable.status,
      approvedAt: agentDesignTable.approvedAt,
      sourceSlug: agentDesignTable.sourceSlug,
      updatedBy: agentDesignTable.updatedBy,
      actorId: agentDesignTable.actorId,
      createdAt: agentDesignTable.createdAt,
      updatedAt: agentDesignTable.updatedAt,
    })
    .from(agentDesignTable)
    .where(eq(agentDesignTable.projectId, projectId))
    .orderBy(desc(agentDesignTable.updatedAt));
  if (designs.length === 0) return [];

  const links = await db
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
    .where(
      inArray(
        agentDesignRequirementTable.designId,
        designs.map((design) => design.id),
      ),
    );
  const byDesign = new Map<string, Array<{ key: string; updatedAt: Date }>>();
  for (const link of links) {
    const list = byDesign.get(link.designId) ?? [];
    list.push({ key: link.key, updatedAt: link.updatedAt });
    byDesign.set(link.designId, list);
  }
  return designs.map((design) => {
    const items = byDesign.get(design.id) ?? [];
    return {
      ...design,
      requirementCount: items.length,
      stale: designStale(design.approvedAt, items),
    };
  });
}

export default listDesigns;
