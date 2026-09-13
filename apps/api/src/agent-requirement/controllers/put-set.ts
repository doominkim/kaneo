import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import appendEntry from "../../agent-entry/controllers/append-entry";
import db from "../../database";
import {
  agentRequirementItemTable,
  agentRequirementSetTable,
} from "../../database/schema-agent-layer";
import { buildKey, parseKey } from "../keys";
import { type Author, authorColumns, type EntryAuthor } from "./shared";

type ItemInput = {
  key?: string;
  text: string;
  layer?: string | null;
  status?: "active" | "deferred" | "dropped";
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
      body: input.body,
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

    let nextSeq = set.nextSeq;
    const changes: Array<{
      key: string;
      previousText: string;
      previousStatus: string;
    }> = [];
    const seenKeys = new Set<string>();

    for (const item of input.items) {
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
        const nextStatus = item.status ?? existingItem.status;
        const changed =
          existingItem.text !== item.text || existingItem.status !== nextStatus;
        await tx
          .update(agentRequirementItemTable)
          .set({
            text: item.text,
            layer: item.layer === undefined ? existingItem.layer : item.layer,
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
  for (const change of result.changes) {
    await appendEntry({
      ...entryBase,
      kind: "work",
      summary: `[${change.key}] 요구사항 수정 (이전 상태 ${change.previousStatus})`,
      body: `이전 문장:\n${change.previousText}`,
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
