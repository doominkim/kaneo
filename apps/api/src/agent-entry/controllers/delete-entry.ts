import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { agentEntryTable } from "../../database/schema-agent-layer";

type DeleteInput = {
  projectId: string;
  entryId: string;
  userId: string;
  /**
   * Resolved lazily: the author's own entry needs no permission lookup, and
   * the check costs a role query. Only consulted when the caller is not the
   * human author (an agent entry has no human author, so it always is).
   */
  canDeleteAny: () => Promise<boolean>;
};

/**
 * Soft delete — DESIGN.md §2.4 "hide, never edit". The row keeps every field
 * and gains `deletedAt`/`deletedBy`; default reads then skip it. Nothing else
 * on the row is ever touched, so restore is a pure clear of those two columns.
 *
 * Who may hide a row: its human author (`createdBy`), or anyone with
 * project:update — the same gate documents and artifacts use for deletion.
 * Scoped by project like every other entry read, so an id from another
 * project is "not found", never "forbidden".
 *
 * The timestamp comes from the app clock, matching how the other Agent Layer
 * writes stamp time, so a test can pin it with a fake clock.
 */
export async function deleteEntry(input: DeleteInput) {
  const [entry] = await db
    .select({
      id: agentEntryTable.id,
      createdBy: agentEntryTable.createdBy,
      deletedAt: agentEntryTable.deletedAt,
    })
    .from(agentEntryTable)
    .where(
      and(
        eq(agentEntryTable.id, input.entryId),
        eq(agentEntryTable.projectId, input.projectId),
      ),
    )
    .limit(1);

  if (!entry || entry.deletedAt) {
    throw new HTTPException(404, { message: "Entry not found" });
  }

  const isAuthor = entry.createdBy != null && entry.createdBy === input.userId;
  if (!isAuthor && !(await input.canDeleteAny())) {
    throw new HTTPException(403, {
      message:
        "Only the entry's author or a project:update holder can delete it",
    });
  }

  const deletedAt = new Date();
  // The predicate repeats `deleted_at IS NULL` so two concurrent deletes
  // cannot both win: the second finds no row and reports 404.
  const [updated] = await db
    .update(agentEntryTable)
    .set({ deletedAt, deletedBy: input.userId })
    .where(
      and(
        eq(agentEntryTable.id, input.entryId),
        eq(agentEntryTable.projectId, input.projectId),
        isNull(agentEntryTable.deletedAt),
      ),
    )
    .returning({
      id: agentEntryTable.id,
      deletedAt: agentEntryTable.deletedAt,
    });

  if (!updated) {
    throw new HTTPException(404, { message: "Entry not found" });
  }

  return { id: updated.id, deletedAt: updated.deletedAt };
}

/**
 * Undo a soft delete. Gated on project:update at the route: the author who
 * hid a note can ask a maintainer to bring it back, but cannot flip it
 * themselves, which keeps "deleted" meaningful on a shared timeline.
 *
 * A row that is not deleted is "not found" rather than a no-op success, so a
 * client that restored twice learns the second call did nothing.
 */
export async function restoreEntry(projectId: string, entryId: string) {
  const [updated] = await db
    .update(agentEntryTable)
    .set({ deletedAt: null, deletedBy: null })
    .where(
      and(
        eq(agentEntryTable.id, entryId),
        eq(agentEntryTable.projectId, projectId),
        isNotNull(agentEntryTable.deletedAt),
      ),
    )
    .returning({
      id: agentEntryTable.id,
      deletedAt: agentEntryTable.deletedAt,
    });

  if (!updated) {
    throw new HTTPException(404, { message: "Entry not found" });
  }

  return { id: updated.id, deletedAt: updated.deletedAt };
}
