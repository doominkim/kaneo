import { and, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import {
  type ActorColumns,
  toActorResponse,
} from "../../agent-entry/actor-response";
import type { EntryRefs } from "../../agent-entry/controllers/entry-fields";
import db, { schema } from "../../database";
import {
  type AgentDecision,
  agentActorTable,
  agentDecisionTable,
  agentDecisionTaskTable,
} from "../../database/schema-agent-layer";

export const createdActor = alias(agentActorTable, "decision_created_actor");
export const updatedActor = alias(agentActorTable, "decision_updated_actor");
export const createdAuthor = alias(schema.userTable, "decision_created_author");
export const updatedAuthor = alias(schema.userTable, "decision_updated_author");
export const acceptor = alias(schema.userTable, "decision_acceptor");

export const decisionSelect = {
  decision: agentDecisionTable,
  createdActor,
  updatedActor,
  createdAuthor: { id: createdAuthor.id, name: createdAuthor.name },
  updatedAuthor: { id: updatedAuthor.id, name: updatedAuthor.name },
  acceptor: { id: acceptor.id, name: acceptor.name },
};

export function decisionQuery() {
  return db
    .select(decisionSelect)
    .from(agentDecisionTable)
    .leftJoin(
      createdActor,
      eq(agentDecisionTable.createdActorId, createdActor.id),
    )
    .leftJoin(
      updatedActor,
      eq(agentDecisionTable.updatedActorId, updatedActor.id),
    )
    .leftJoin(createdAuthor, eq(agentDecisionTable.createdBy, createdAuthor.id))
    .leftJoin(updatedAuthor, eq(agentDecisionTable.updatedBy, updatedAuthor.id))
    .leftJoin(acceptor, eq(agentDecisionTable.acceptedBy, acceptor.id));
}

export type DecisionJoinRow = Awaited<ReturnType<typeof getDecisionRow>>;

type SummaryDecision = Pick<
  AgentDecision,
  | "id"
  | "number"
  | "title"
  | "status"
  | "reversible"
  | "sourceEntryId"
  | "supersedesDecisionId"
  | "refs"
  | "createdBy"
  | "updatedBy"
  | "acceptedBy"
  | "acceptedAt"
  | "createdAt"
  | "updatedAt"
>;

export type DecisionSummaryJoinRow = {
  decision: SummaryDecision;
  createdActor: ActorColumns | null;
  updatedActor: ActorColumns | null;
  createdAuthor: { id: string | null; name: string | null } | null;
  updatedAuthor: { id: string | null; name: string | null } | null;
  acceptor: { id: string | null; name: string | null } | null;
};

export async function getDecisionRow(projectId: string, decisionId: string) {
  const [row] = await decisionQuery()
    .where(
      and(
        eq(agentDecisionTable.id, decisionId),
        eq(agentDecisionTable.projectId, projectId),
      ),
    )
    .limit(1);
  return row;
}

export async function loadDecisionTasks(
  projectId: string,
  decisionIds: string[],
) {
  const byDecision = new Map<
    string,
    Array<{ id: string; number: number | null; title: string }>
  >();
  if (decisionIds.length === 0) return byDecision;

  const rows = await db
    .select({
      decisionId: agentDecisionTaskTable.decisionId,
      id: schema.taskTable.id,
      number: schema.taskTable.number,
      title: schema.taskTable.title,
    })
    .from(agentDecisionTaskTable)
    .innerJoin(
      schema.taskTable,
      eq(agentDecisionTaskTable.taskId, schema.taskTable.id),
    )
    .where(
      and(
        inArray(agentDecisionTaskTable.decisionId, decisionIds),
        eq(schema.taskTable.projectId, projectId),
      ),
    );

  for (const row of rows) {
    const tasks = byDecision.get(row.decisionId) ?? [];
    tasks.push({ id: row.id, number: row.number, title: row.title });
    byDecision.set(row.decisionId, tasks);
  }
  for (const tasks of byDecision.values()) {
    tasks.sort(
      (a, b) =>
        (a.number ?? Number.MAX_SAFE_INTEGER) -
        (b.number ?? Number.MAX_SAFE_INTEGER),
    );
  }
  return byDecision;
}

export function shapeDecisionSummary(
  row: DecisionSummaryJoinRow,
  contextPreview: string,
  tasks: Array<{ id: string; number: number | null; title: string }>,
) {
  const decision = row.decision;
  return {
    id: decision.id,
    number: decision.number,
    title: decision.title,
    status: decision.status as "draft" | "accepted" | "superseded",
    contextPreview,
    reversible: decision.reversible,
    sourceEntryId: decision.sourceEntryId,
    supersedesDecisionId: decision.supersedesDecisionId,
    refs: (decision.refs as EntryRefs | null) ?? null,
    tasks,
    createdBy: decision.createdBy,
    createdAuthor: row.createdAuthor?.id
      ? {
          userId: row.createdAuthor.id,
          name: row.createdAuthor.name ?? "",
        }
      : null,
    createdActor: toActorResponse(row.createdActor),
    updatedBy: decision.updatedBy,
    updatedAuthor: row.updatedAuthor?.id
      ? {
          userId: row.updatedAuthor.id,
          name: row.updatedAuthor.name ?? "",
        }
      : null,
    updatedActor: toActorResponse(row.updatedActor),
    acceptedBy: decision.acceptedBy,
    acceptor: row.acceptor?.id
      ? { userId: row.acceptor.id, name: row.acceptor.name ?? "" }
      : null,
    acceptedAt: decision.acceptedAt,
    createdAt: decision.createdAt,
    updatedAt: decision.updatedAt,
  };
}

function toDecisionRef(
  decision: typeof agentDecisionTable.$inferSelect | undefined,
) {
  return decision
    ? {
        id: decision.id,
        number: decision.number,
        title: decision.title,
        status: decision.status as "draft" | "accepted" | "superseded",
      }
    : null;
}

export async function getDecision(projectId: string, decisionId: string) {
  const row = await getDecisionRow(projectId, decisionId);
  if (!row) {
    throw new HTTPException(404, { message: "ADR not found" });
  }
  const [tasks, supersedesRows, supersededByRows] = await Promise.all([
    loadDecisionTasks(projectId, [decisionId]),
    row.decision.supersedesDecisionId
      ? db
          .select()
          .from(agentDecisionTable)
          .where(
            and(
              eq(agentDecisionTable.id, row.decision.supersedesDecisionId),
              eq(agentDecisionTable.projectId, projectId),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
    db
      .select()
      .from(agentDecisionTable)
      .where(
        and(
          eq(agentDecisionTable.projectId, projectId),
          eq(agentDecisionTable.supersedesDecisionId, decisionId),
        ),
      )
      .limit(1),
  ]);
  const decision = row.decision;
  const summary = shapeDecisionSummary(
    row,
    decision.context.slice(0, 240),
    tasks.get(decisionId) ?? [],
  );
  const { contextPreview: _contextPreview, ...detailSummary } = summary;
  return {
    ...detailSummary,
    workspaceId: decision.workspaceId,
    projectId: decision.projectId,
    context: decision.context,
    decision: decision.decision,
    alternatives: decision.alternatives,
    consequences: decision.consequences,
    sourceNote: decision.sourceNote,
    supersedes: toDecisionRef(supersedesRows[0]),
    supersededBy: toDecisionRef(supersededByRows[0]),
  };
}
