import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import appendEntry from "../../agent-entry/controllers/append-entry";
import {
  type Author,
  authorColumns,
  type EntryAuthor,
  resolveItemsByKey,
} from "../../agent-requirement/controllers/shared";
import db from "../../database";
import {
  agentDesignRequirementTable,
  agentDesignTable,
} from "../../database/schema-agent-layer";
import { findDesign } from "./shared";

/**
 * Create-or-replace the design at (project, feature). Requirement links are
 * replaced only when `requirementKeys` is sent (REQ-SPEC-TABS-5). Writing to an
 * approved design returns it to draft — same rule as requirement sets.
 */
async function putDesign(input: {
  workspaceId: string;
  projectId: string;
  feature: string;
  title: string;
  body: string;
  requirementKeys?: string[];
  sourceSlug?: string | null;
  author: Author;
  entryAuthor: EntryAuthor;
}) {
  const items = input.requirementKeys
    ? await resolveItemsByKey(input.projectId, input.requirementKeys)
    : null;
  const existing = await findDesign(input.projectId, input.feature);
  const wasApproved = existing?.status === "approved";

  const design = await db.transaction(async (tx) => {
    const values = {
      title: input.title,
      body: input.body,
      sourceSlug: input.sourceSlug ?? existing?.sourceSlug ?? null,
      status: "draft",
      ...authorColumns(input.author),
      updatedAt: new Date(),
    };
    let row: typeof agentDesignTable.$inferSelect | undefined;
    if (existing) {
      [row] = await tx
        .update(agentDesignTable)
        .set(values)
        .where(eq(agentDesignTable.id, existing.id))
        .returning();
    } else {
      [row] = await tx
        .insert(agentDesignTable)
        .values({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          feature: input.feature,
          ...values,
        })
        .returning();
    }
    if (!row)
      throw new HTTPException(500, { message: "Failed to save design" });

    if (items) {
      await tx
        .delete(agentDesignRequirementTable)
        .where(eq(agentDesignRequirementTable.designId, row.id));
      if (items.length) {
        await tx
          .insert(agentDesignRequirementTable)
          .values(items.map((item) => ({ designId: row.id, itemId: item.id })));
      }
    }
    return row;
  });

  if (wasApproved) {
    const isAgent = "actorId" in input.author;
    await appendEntry({
      workspaceId: input.workspaceId,
      userId: input.entryAuthor.userId,
      projectId: input.projectId,
      provider: isAgent ? input.entryAuthor.provider : undefined,
      model: isAgent ? input.entryAuthor.model : undefined,
      sessionId: input.entryAuthor.sessionId ?? null,
      kind: "work",
      summary: `[design:${input.feature}] 승인된 설계 문서를 다시 편집해 draft 로 되돌림`,
    });
  }
  return design;
}

export default putDesign;
