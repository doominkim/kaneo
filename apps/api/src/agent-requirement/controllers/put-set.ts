import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import appendEntry from "../../agent-entry/controllers/append-entry";
import db from "../../database";
import {
  agentRequirementItemTable,
  agentRequirementSetTable,
} from "../../database/schema-agent-layer";
import { buildKey, parseKey } from "../keys";
import { parseRequirementDoc } from "../parse";
import { type Author, authorColumns, type EntryAuthor } from "./shared";

type ItemInput = {
  key?: string;
  text: string;
  layer?: string | null;
  status?: "active" | "deferred" | "dropped";
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
};

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  return (cause as { code?: string })?.code === "23505";
}

/**
 * Create-or-replace the set's own fields and upsert the items sent.
 *
 * Items are rows, so the payload is a partial: an item not mentioned is left
 * alone (never deleted — REQ-SPEC-TABS-3). To retire one, send it with
 * `status: "dropped"`. A changed `text` or `status` moves `updatedAt`, which is
 * the clock every downstream stale check reads, and leaves the previous text on
 * the timeline (REQ-SPEC-TABS-9).
 *
 * Writing to an approved set puts it back to draft and says so on the
 * timeline (REQ-SPEC-TABS-14): approval is a statement about a specific text.
 */
async function putSet(input: PutInput) {
  const isAgent = "actorId" in input.author;
  const result = await db.transaction(async (tx) => {
    // Document mode (REQ-FEATURE-HUB-23): when the body carries criterion
    // lines, the body is the source of truth and `items` is ignored. Parsing
    // runs before the set row is written because it can reject the request,
    // and it needs the set's `nextSeq` to issue keys.
    const [existingForSeq] = await tx
      .select({ nextSeq: agentRequirementSetTable.nextSeq })
      .from(agentRequirementSetTable)
      .where(
        and(
          eq(agentRequirementSetTable.projectId, input.projectId),
          eq(agentRequirementSetTable.feature, input.feature),
        ),
      )
      .limit(1);
    const parsed = parseRequirementDoc(
      input.body,
      input.feature,
      existingForSeq?.nextSeq ?? 1,
    );
    const docMode = parsed.criteria.length > 0;
    const body = docMode ? parsed.body : input.body;
    const items: ItemInput[] = docMode
      ? parsed.criteria.map((criterion) => ({
          key: criterion.key,
          text: criterion.text,
          layer: criterion.layer,
          story: criterion.story,
          status: criterion.dropped ? "dropped" : undefined,
        }))
      : input.items;
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

    const wasApproved = existing?.status === "approved";
    const values = {
      title: input.title,
      body,
      sourceSlug: input.sourceSlug ?? existing?.sourceSlug ?? null,
      status: "draft",
      ...authorColumns(input.author),
      updatedAt: new Date(),
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
        })
        .returning();
    }
    if (!set) {
      throw new HTTPException(500, {
        message: "Failed to save requirement set",
      });
    }

    const current = await tx
      .select()
      .from(agentRequirementItemTable)
      .where(eq(agentRequirementItemTable.setId, set.id));
    const byKey = new Map(current.map((item) => [item.key, item]));

    let nextSeq = docMode ? Math.max(set.nextSeq, parsed.nextSeq) : set.nextSeq;
    const changes: Array<{
      key: string;
      previousText: string;
      previousStatus: string;
    }> = [];
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
        const changed =
          existingItem.text !== item.text || existingItem.status !== nextStatus;
        await tx
          .update(agentRequirementItemTable)
          .set({
            text: item.text,
            layer: item.layer === undefined ? existingItem.layer : item.layer,
            story: item.story === undefined ? existingItem.story : item.story,
            status: nextStatus,
            ...(changed ? { updatedAt: new Date() } : {}),
          })
          .where(eq(agentRequirementItemTable.id, existingItem.id));
        if (changed) {
          changes.push({
            key: existingItem.key,
            previousText: existingItem.text,
            previousStatus: existingItem.status,
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
          setId: set.id,
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

    if (docMode) {
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

    if (nextSeq !== set.nextSeq) {
      [set] = await tx
        .update(agentRequirementSetTable)
        .set({ nextSeq })
        .where(eq(agentRequirementSetTable.id, set.id))
        .returning();
    }

    return {
      set: set as typeof agentRequirementSetTable.$inferSelect,
      wasApproved,
      changes,
    };
  });

  const entryBase = {
    workspaceId: input.workspaceId,
    userId: input.entryAuthor.userId,
    projectId: input.projectId,
    provider: isAgent ? input.entryAuthor.provider : undefined,
    model: isAgent ? input.entryAuthor.model : undefined,
    sessionId: input.entryAuthor.sessionId ?? null,
  };
  // One timeline entry per save, not per item: a document edit that touches
  // twenty lines is one event to a reader. Previous sentences ride in the body
  // so nothing is lost (REQ-SPEC-TABS-9).
  if (result.changes.length) {
    const keys = result.changes.map((change) => change.key);
    await appendEntry({
      ...entryBase,
      kind: "work",
      summary:
        `[requirements:${input.feature}] 기준 ${keys.length}건 수정: ${keys.join(", ")}`.slice(
          0,
          200,
        ),
      body: result.changes
        .map(
          (change) =>
            `## ${change.key} (이전 상태 ${change.previousStatus})\n이전 문장:\n${change.previousText}`,
        )
        .join("\n\n"),
    });
  }
  if (result.wasApproved) {
    await appendEntry({
      ...entryBase,
      kind: "work",
      summary: `[requirements:${input.feature}] 승인된 요구사항 문서를 다시 편집해 draft 로 되돌림`,
    });
  }

  return result.set;
}

export default putSet;
