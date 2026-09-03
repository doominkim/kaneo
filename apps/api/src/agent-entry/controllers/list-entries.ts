import {
  and,
  desc,
  eq,
  isNotNull,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { userTable } from "../../database/schema";
import {
  agentActorTable,
  agentEntryTable,
} from "../../database/schema-agent-layer";
import { NO_TASK_FILTER } from "../schema";
import {
  type EntryRefs,
  type EntryUsage,
  liftRefs,
  shapeAuthorship,
} from "./entry-fields";

type ListInput = {
  projectId: string;
  limit: number;
  before?: string;
  /** An exact task id, or NO_TASK_FILTER for the project-level rows. */
  taskId?: string;
  kind?: string;
};

/**
 * Ledger listing. Selects the summary columns ONLY — `body` and `decision` are
 * excluded at the query level, not filtered afterwards. `refs` is small
 * (paths, shas) and is read so `repo`/`branch` can be lifted per row.
 *
 * Upstream's equivalent ships every row's full text and measured 18.5KB for 20
 * tasks. A projection is the only thing that actually keeps the cost bounded;
 * trimming in the response layer still pays the transfer.
 *
 * Paging is a keyset on (created_at, id). The cursor is the id of the last
 * entry of the previous page, and its created_at is read back inside the query
 * rather than round-tripped through the client: PostgreSQL stores microseconds,
 * a JS Date carries milliseconds, and a timestamp cursor would silently skip
 * every row inside the truncated window. The ledger is append-only, so a
 * cursor id never disappears underneath a caller.
 */
async function listEntries(input: ListInput) {
  // `and()` drops undefined members, so `or()`'s nullable return can be
  // pushed straight in without a guard.
  const conditions: (SQL | undefined)[] = [
    eq(agentEntryTable.projectId, input.projectId),
  ];

  if (input.before) {
    const [cursorRow] = await db
      .select({ id: agentEntryTable.id })
      .from(agentEntryTable)
      .where(
        and(
          eq(agentEntryTable.id, input.before),
          eq(agentEntryTable.projectId, input.projectId),
        ),
      )
      .limit(1);
    if (!cursorRow) {
      throw new HTTPException(400, { message: "Unknown cursor" });
    }

    // The subquery keeps the comparison on PostgreSQL's own stored value; the
    // JS Date the driver would hand back is already truncated to milliseconds.
    const cursor = alias(agentEntryTable, "cursor");
    const cursorCreatedAt = sql`(${db
      .select({ createdAt: cursor.createdAt })
      .from(cursor)
      .where(eq(cursor.id, input.before))})`;
    conditions.push(
      or(
        lt(agentEntryTable.createdAt, cursorCreatedAt),
        and(
          eq(agentEntryTable.createdAt, cursorCreatedAt),
          lt(agentEntryTable.id, input.before),
        ),
      ),
    );
  }
  if (input.taskId === NO_TASK_FILTER) {
    conditions.push(isNull(agentEntryTable.taskId));
  } else if (input.taskId) {
    conditions.push(eq(agentEntryTable.taskId, input.taskId));
  }
  if (input.kind) conditions.push(eq(agentEntryTable.kind, input.kind));

  const rows = await db
    .select({
      id: agentEntryTable.id,
      taskId: agentEntryTable.taskId,
      kind: agentEntryTable.kind,
      summary: agentEntryTable.summary,
      hasDecision: isNotNull(agentEntryTable.decision),
      coreChanged: agentEntryTable.coreChanged,
      refs: agentEntryTable.refs,
      effort: agentEntryTable.effort,
      agentLabel: agentEntryTable.agentLabel,
      usage: agentEntryTable.usage,
      createdAt: agentEntryTable.createdAt,
      actorId: agentActorTable.id,
      actorProvider: agentActorTable.provider,
      actorModel: agentActorTable.model,
      actorOnBehalfOf: agentActorTable.onBehalfOf,
      authorId: userTable.id,
      authorName: userTable.name,
    })
    .from(agentEntryTable)
    .leftJoin(agentActorTable, eq(agentEntryTable.actorId, agentActorTable.id))
    .leftJoin(userTable, eq(agentEntryTable.createdBy, userTable.id))
    .where(and(...conditions))
    .orderBy(desc(agentEntryTable.createdAt), desc(agentEntryTable.id))
    .limit(input.limit);

  const entries = rows.map((r) => ({
    id: r.id,
    taskId: r.taskId,
    kind: r.kind,
    summary: r.summary,
    hasDecision: Boolean(r.hasDecision),
    coreChanged: (r.coreChanged as string[] | null) ?? null,
    ...liftRefs(r.refs as EntryRefs | null),
    effort: r.effort,
    agentLabel: r.agentLabel,
    usage: (r.usage as EntryUsage | null) ?? null,
    createdAt: r.createdAt,
    ...shapeAuthorship(
      {
        id: r.actorId,
        provider: r.actorProvider,
        model: r.actorModel,
        onBehalfOf: r.actorOnBehalfOf,
      },
      { id: r.authorId, name: r.authorName },
    ),
  }));

  const last = entries.length > 0 ? entries[entries.length - 1] : undefined;
  return {
    entries,
    nextBefore: entries.length === input.limit && last ? last.id : null,
  };
}

export default listEntries;
