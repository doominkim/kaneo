import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  type Author,
  appliedColumns,
  authorColumns,
  type EntryAuthor,
  liveItemIds,
  resolveItemsByKey,
} from "../../agent-requirement/controllers/shared";
import { insertRevision } from "../../agent-requirement/controllers/spec-revision";
import db from "../../database";
import {
  agentDesignRequirementTable,
  agentDesignTable,
  agentRequirementItemTable,
} from "../../database/schema-agent-layer";

type KeyedItem = { id: string; key: string; seq: number };

function sameItems(a: KeyedItem[], b: KeyedItem[]) {
  const left = a.map((item) => item.id).sort();
  const right = b.map((item) => item.id).sort();
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

function keysInItemOrder(items: KeyedItem[]) {
  return [...items]
    .sort((a, b) => a.seq - b.seq || a.key.localeCompare(b.key))
    .map((item) => item.key);
}

/**
 * Create-or-replace the design at (project, feature). Requirement links are
 * replaced only when `requirementKeys` is sent (REQ-SPEC-TABS-5).
 *
 * Every save applies immediately and follows the same review rule as
 * requirement sets (agent-autoapply). The design's content is its title, body
 * and the set of requirement items it covers: when any of them changes,
 * `revisedAt` moves — the clock linked tasks are compared against — and one
 * revision with the covered keys is appended in the same transaction. A
 * soft-deleted design is refused until it is restored.
 *
 * Covered items of a soft-deleted requirement set are invisible here as
 * everywhere else: they neither count as content nor get replaced, so the
 * links are intact when that set is restored.
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
  /** An API-key call: attributed to the key's owner, but not a review. */
  viaApiKey?: boolean;
  /** Set by a revert: the revision this save restores. */
  revertedFromId?: string | null;
}) {
  const items = input.requirementKeys
    ? await resolveItemsByKey(input.projectId, input.requirementKeys)
    : null;

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(agentDesignTable)
      .where(
        and(
          eq(agentDesignTable.projectId, input.projectId),
          eq(agentDesignTable.feature, input.feature),
        ),
      )
      .limit(1);
    if (existing?.deletedAt) {
      throw new HTTPException(409, {
        message: `Design ${input.feature} is deleted; restore it before saving`,
      });
    }
    const currentItems: KeyedItem[] = existing
      ? await tx
          .select({
            id: agentRequirementItemTable.id,
            key: agentRequirementItemTable.key,
            seq: agentRequirementItemTable.seq,
          })
          .from(agentDesignRequirementTable)
          .innerJoin(
            agentRequirementItemTable,
            eq(
              agentRequirementItemTable.id,
              agentDesignRequirementTable.itemId,
            ),
          )
          .where(
            and(
              eq(agentDesignRequirementTable.designId, existing.id),
              inArray(
                agentDesignRequirementTable.itemId,
                liveItemIds(input.projectId),
              ),
            ),
          )
      : [];

    const now = new Date();
    const contentChanged =
      !existing ||
      existing.title !== input.title ||
      existing.body !== input.body ||
      (items !== null && !sameItems(items, currentItems));
    const values = {
      title: input.title,
      body: input.body,
      sourceSlug: input.sourceSlug ?? existing?.sourceSlug ?? null,
      ...appliedColumns(input.author, now, input.viaApiKey),
      ...authorColumns(input.author),
      ...(contentChanged ? { revisedAt: now } : {}),
      updatedAt: now,
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
    const designId = row.id;

    if (items) {
      await tx
        .delete(agentDesignRequirementTable)
        .where(
          and(
            eq(agentDesignRequirementTable.designId, designId),
            inArray(
              agentDesignRequirementTable.itemId,
              liveItemIds(input.projectId),
            ),
          ),
        );
      if (items.length) {
        await tx
          .insert(agentDesignRequirementTable)
          .values(items.map((item) => ({ designId, itemId: item.id })));
      }
    }

    if (contentChanged) {
      await insertRevision(tx, {
        projectId: input.projectId,
        target: { designId },
        title: input.title,
        body: input.body,
        requirementKeys: keysInItemOrder(items ?? currentItems),
        author: input.author,
        revertedFromId: input.revertedFromId,
        createdAt: now,
      });
    }
    return row;
  });
}

export default putDesign;
