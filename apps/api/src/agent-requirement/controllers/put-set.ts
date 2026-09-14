import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import appendEntry from "../../agent-entry/controllers/append-entry";
import db from "../../database";
import {
  agentRequirementItemTable,
  agentRequirementSetTable,
  type SpecRevisionItem,
} from "../../database/schema-agent-layer";
import { buildKey, parseKey } from "../keys";
import { parseRequirementDoc } from "../parse";
import {
  type Author,
  appliedColumns,
  authorColumns,
  type EntryAuthor,
} from "./shared";
import { insertRevision, snapshotItems } from "./spec-revision";

type ItemStatus = "active" | "deferred" | "dropped";

type ItemInput = {
  key?: string;
  text: string;
  layer?: string | null;
  status?: ItemStatus;
  story?: string | null;
};

type PutInput = {
  workspaceId: string;
  projectId: string;
  feature: string;
  title: string;
  body: string;
  items: ItemInput[];
  sourceSlug?: string | null;
  author: Author;
  entryAuthor: EntryAuthor;
  /** An API-key call: attributed to the key's owner, but not a review. */
  viaApiKey?: boolean;
  /** Set by a revert: the revision this save restores. */
  revertedFromId?: string | null;
  /**
   * Set by a revert whose revision stored the set's rows. The rows are made
   * to match these exactly, whatever mode the body is in, and a row the
   * revision did not have is dropped (keys are never deleted).
   */
  restoreItems?: SpecRevisionItem[] | null;
};

type ItemChange = {
  key: string;
  previousText: string;
  previousStatus: string;
  previousLayer?: string | null;
  previousStory?: string | null;
};

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  return (cause as { code?: string })?.code === "23505";
}

function describeChange(change: ItemChange) {
  const lines = [
    `## ${change.key} (이전 상태 ${change.previousStatus})`,
    `이전 문장:\n${change.previousText}`,
  ];
  if (change.previousLayer !== undefined) {
    lines.push(`이전 layer: ${change.previousLayer ?? "(없음)"}`);
  }
  if (change.previousStory !== undefined) {
    lines.push(`이전 story: ${change.previousStory ?? "(없음)"}`);
  }
  return lines.join("\n");
}

/**
 * Create-or-replace the set's own fields and upsert the items sent.
 *
 * Items are rows, so the payload is a partial: an item not mentioned is left
 * alone (never deleted — REQ-SPEC-TABS-3). To retire one, send it with
 * `status: "dropped"`. A changed `text`, `status`, `layer` or `story` moves
 * `updatedAt`, which is the clock every downstream stale check reads, and
 * leaves the previous values on the timeline (REQ-SPEC-TABS-9).
 *
 * Every save applies immediately (agent-autoapply): the set is `approved` as
 * of this save and the review marker follows the author. The set's content is
 * its title, body and rows: when any of them differs from what was there,
 * `revisedAt` moves and one revision holding all three is appended in the
 * same transaction; an identical re-save writes neither. The timeline entry
 * is written in the same transaction too, so a save never lands without it.
 * A soft-deleted set is refused rather than silently brought back, so a
 * person's delete cannot be undone by the next agent write.
 */
async function putSet(input: PutInput) {
  const isAgent = "actorId" in input.author;
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(agentRequirementSetTable)
      .where(
        and(
          eq(agentRequirementSetTable.projectId, input.projectId),
          eq(agentRequirementSetTable.feature, input.feature),
        ),
      )
      .limit(1);
    if (existing?.deletedAt) {
      throw new HTTPException(409, {
        message: `Requirement set ${input.feature} is deleted; restore it before saving`,
      });
    }

    // Document mode (REQ-FEATURE-HUB-23): when the body carries criterion
    // lines, the body is the source of truth and `items` is ignored. Parsing
    // runs before the set row is written because it can reject the request,
    // and it needs the set's `nextSeq` to issue keys.
    const parsed = parseRequirementDoc(
      input.body,
      input.feature,
      existing?.nextSeq ?? 1,
    );
    const docMode = parsed.criteria.length > 0;
    const body = docMode ? parsed.body : input.body;
    const restoring = input.restoreItems != null;
    const items: ItemInput[] = input.restoreItems
      ? input.restoreItems.map((item) => ({
          key: item.key,
          text: item.text,
          layer: item.layer,
          story: item.story,
          status: item.status as ItemStatus,
        }))
      : docMode
        ? parsed.criteria.map((criterion) => ({
            key: criterion.key,
            text: criterion.text,
            layer: criterion.layer,
            story: criterion.story,
            status: criterion.dropped ? "dropped" : undefined,
          }))
        : input.items;
    // A document body and a revision's rows are the whole list, so a row they
    // do not name is dropped; an items payload is a partial and leaves it.
    const dropUnlisted = restoring || docMode;

    const now = new Date();
    const values = {
      title: input.title,
      body,
      sourceSlug: input.sourceSlug ?? existing?.sourceSlug ?? null,
      ...appliedColumns(input.author, now, input.viaApiKey),
      ...authorColumns(input.author),
      updatedAt: now,
    };

    let set: typeof agentRequirementSetTable.$inferSelect | undefined;
    if (existing) {
      [set] = await tx
        .update(agentRequirementSetTable)
        .set(values)
        .where(eq(agentRequirementSetTable.id, existing.id))
        .returning();
    } else {
      [set] = await tx
        .insert(agentRequirementSetTable)
        .values({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          feature: input.feature,
          ...values,
          revisedAt: now,
        })
        .returning();
    }
    if (!set) {
      throw new HTTPException(500, {
        message: "Failed to save requirement set",
      });
    }
    const setId = set.id;

    const current = await tx
      .select()
      .from(agentRequirementItemTable)
      .where(eq(agentRequirementItemTable.setId, setId));
    const before = snapshotItems(current);
    const byKey = new Map(current.map((item) => [item.key, item]));

    let nextSeq = docMode ? Math.max(set.nextSeq, parsed.nextSeq) : set.nextSeq;
    const changes: ItemChange[] = [];
    const seenKeys = new Set<string>();

    for (const item of items) {
      if (item.key) {
        if (seenKeys.has(item.key)) {
          throw new HTTPException(400, {
            message: `Duplicate key in payload: ${item.key}`,
          });
        }
        seenKeys.add(item.key);
      }
      const existingItem = item.key ? byKey.get(item.key) : undefined;

      if (existingItem) {
        // In document mode a line that is no longer struck through comes back
        // to life; a deferred row stays deferred until the text says otherwise.
        const nextStatus =
          item.status ??
          (docMode && existingItem.status === "dropped"
            ? "active"
            : existingItem.status);
        const nextLayer =
          item.layer === undefined ? existingItem.layer : item.layer;
        const nextStory =
          item.story === undefined ? existingItem.story : item.story;
        const layerChanged = existingItem.layer !== nextLayer;
        const storyChanged = existingItem.story !== nextStory;
        const changed =
          existingItem.text !== item.text ||
          existingItem.status !== nextStatus ||
          layerChanged ||
          storyChanged;
        await tx
          .update(agentRequirementItemTable)
          .set({
            text: item.text,
            layer: nextLayer,
            story: nextStory,
            status: nextStatus,
            ...(changed ? { updatedAt: new Date() } : {}),
          })
          .where(eq(agentRequirementItemTable.id, existingItem.id));
        if (changed) {
          changes.push({
            key: existingItem.key,
            previousText: existingItem.text,
            previousStatus: existingItem.status,
            ...(layerChanged ? { previousLayer: existingItem.layer } : {}),
            ...(storyChanged ? { previousStory: existingItem.story } : {}),
          });
        }
        continue;
      }

      // New row: an explicit key imports numbering (migration), otherwise issue the next seq.
      let seq: number;
      let key: string;
      if (item.key) {
        seq = parseKey(item.key, input.feature).seq;
        key = item.key;
        nextSeq = Math.max(nextSeq, seq + 1);
      } else {
        seq = nextSeq;
        key = buildKey(input.feature, seq);
        nextSeq += 1;
      }
      try {
        await tx.insert(agentRequirementItemTable).values({
          setId,
          projectId: input.projectId,
          key,
          seq,
          text: item.text,
          layer: item.layer ?? null,
          story: item.story ?? null,
          status: item.status ?? "active",
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new HTTPException(400, {
            message: `Requirement key already exists in this project: ${key}`,
          });
        }
        throw error;
      }
    }

    if (dropUnlisted) {
      for (const row of current) {
        if (seenKeys.has(row.key) || row.status === "dropped") continue;
        await tx
          .update(agentRequirementItemTable)
          .set({ status: "dropped", updatedAt: new Date() })
          .where(eq(agentRequirementItemTable.id, row.id));
        changes.push({
          key: row.key,
          previousText: row.text,
          previousStatus: row.status,
        });
      }
    }

    const after = snapshotItems(
      await tx
        .select()
        .from(agentRequirementItemTable)
        .where(eq(agentRequirementItemTable.setId, setId)),
    );
    const contentChanged =
      !existing ||
      existing.title !== input.title ||
      existing.body !== body ||
      JSON.stringify(before) !== JSON.stringify(after);

    const setUpdate = {
      ...(nextSeq !== set.nextSeq ? { nextSeq } : {}),
      ...(existing && contentChanged ? { revisedAt: now } : {}),
    };
    if (Object.keys(setUpdate).length > 0) {
      [set] = await tx
        .update(agentRequirementSetTable)
        .set(setUpdate)
        .where(eq(agentRequirementSetTable.id, setId))
        .returning();
    }

    if (contentChanged) {
      await insertRevision(tx, {
        projectId: input.projectId,
        target: { setId },
        title: input.title,
        body,
        requirementKeys: null,
        items: after,
        author: input.author,
        revertedFromId: input.revertedFromId,
        createdAt: now,
      });
    }

    // One timeline entry per save, not per item: a document edit that touches
    // twenty lines is one event to a reader. Previous values ride in the body
    // so nothing is lost (REQ-SPEC-TABS-9).
    if (changes.length) {
      const keys = changes.map((change) => change.key);
      await appendEntry(
        {
          workspaceId: input.workspaceId,
          userId: input.entryAuthor.userId,
          projectId: input.projectId,
          provider: isAgent ? input.entryAuthor.provider : undefined,
          model: isAgent ? input.entryAuthor.model : undefined,
          sessionId: input.entryAuthor.sessionId ?? null,
          kind: "work",
          summary:
            `[requirements:${input.feature}] 기준 ${keys.length}건 수정: ${keys.join(", ")}`.slice(
              0,
              200,
            ),
          body: changes.map(describeChange).join("\n\n"),
        },
        tx,
      );
    }

    return set as typeof agentRequirementSetTable.$inferSelect;
  });
}

export default putSet;
