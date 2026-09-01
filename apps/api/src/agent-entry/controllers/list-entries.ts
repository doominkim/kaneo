import { and, desc, eq, isNotNull, lt } from "drizzle-orm";
import db from "../../database";
import {
  agentActorTable,
  agentEntryTable,
} from "../../database/schema-agent-layer";

type ListInput = {
  projectId: string;
  limit: number;
  before?: string;
  taskId?: string;
  kind?: string;
};

/**
 * Ledger listing. Selects the summary columns ONLY — `body` and `decision` are
 * excluded at the query level, not filtered afterwards.
 *
 * Upstream's equivalent ships every row's full text and measured 18.5KB for 20
 * tasks. A projection is the only thing that actually keeps the cost bounded;
 * trimming in the response layer still pays the transfer.
 */
async function listEntries(input: ListInput) {
  const conditions = [eq(agentEntryTable.projectId, input.projectId)];

  if (input.before) {
    const beforeDate = new Date(input.before);
    if (!Number.isNaN(beforeDate.getTime())) {
      conditions.push(lt(agentEntryTable.createdAt, beforeDate));
    }
  }
  if (input.taskId) conditions.push(eq(agentEntryTable.taskId, input.taskId));
  if (input.kind) conditions.push(eq(agentEntryTable.kind, input.kind));

  const rows = await db
    .select({
      id: agentEntryTable.id,
      taskId: agentEntryTable.taskId,
      kind: agentEntryTable.kind,
      summary: agentEntryTable.summary,
      hasDecision: isNotNull(agentEntryTable.decision),
      coreChanged: agentEntryTable.coreChanged,
      createdAt: agentEntryTable.createdAt,
      actorId: agentActorTable.id,
      actorProvider: agentActorTable.provider,
      actorModel: agentActorTable.model,
      actorOnBehalfOf: agentActorTable.onBehalfOf,
    })
    .from(agentEntryTable)
    .leftJoin(agentActorTable, eq(agentEntryTable.actorId, agentActorTable.id))
    .where(and(...conditions))
    .orderBy(desc(agentEntryTable.createdAt))
    .limit(input.limit);

  const entries = rows.map((r) => ({
    id: r.id,
    taskId: r.taskId,
    kind: r.kind,
    summary: r.summary,
    hasDecision: Boolean(r.hasDecision),
    coreChanged: (r.coreChanged as string[] | null) ?? null,
    createdAt: r.createdAt,
    actor: r.actorId
      ? {
          id: r.actorId,
          provider: r.actorProvider ?? "",
          model: r.actorModel ?? "",
          onBehalfOf: r.actorOnBehalfOf ?? null,
        }
      : null,
  }));

  const last = entries.length > 0 ? entries[entries.length - 1] : undefined;
  return {
    entries,
    nextBefore:
      entries.length === input.limit && last
        ? last.createdAt.toISOString()
        : null,
  };
}

export default listEntries;
