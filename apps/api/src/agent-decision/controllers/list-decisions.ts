import {
  and,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../../database";
import {
  agentDecisionTable,
  agentDecisionTaskTable,
} from "../../database/schema-agent-layer";
import {
  acceptor,
  createdActor,
  createdAuthor,
  loadDecisionTasks,
  shapeDecisionSummary,
  updatedActor,
  updatedAuthor,
} from "./decision-record";

type ListInput = {
  projectId: string;
  limit: number;
  before?: string;
  status: "current" | "all" | "draft" | "accepted" | "superseded";
  taskId?: string;
  q?: string;
};

async function listDecisions(input: ListInput) {
  const conditions: (SQL | undefined)[] = [
    eq(agentDecisionTable.projectId, input.projectId),
  ];

  if (input.before) {
    const [cursor] = await db
      .select({ number: agentDecisionTable.number })
      .from(agentDecisionTable)
      .where(
        and(
          eq(agentDecisionTable.id, input.before),
          eq(agentDecisionTable.projectId, input.projectId),
        ),
      )
      .limit(1);
    if (!cursor) {
      throw new HTTPException(400, { message: "Unknown ADR cursor" });
    }
    conditions.push(lt(agentDecisionTable.number, cursor.number));
  }

  if (input.status === "current") {
    conditions.push(inArray(agentDecisionTable.status, ["draft", "accepted"]));
  } else if (input.status !== "all") {
    conditions.push(eq(agentDecisionTable.status, input.status));
  }
  if (input.taskId) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(agentDecisionTaskTable)
          .innerJoin(
            schema.taskTable,
            and(
              eq(agentDecisionTaskTable.taskId, schema.taskTable.id),
              eq(schema.taskTable.projectId, input.projectId),
            ),
          )
          .where(
            and(
              eq(agentDecisionTaskTable.decisionId, agentDecisionTable.id),
              eq(agentDecisionTaskTable.taskId, input.taskId),
            ),
          ),
      ),
    );
  }
  if (input.q) {
    const pattern = `%${input.q}%`;
    conditions.push(
      or(
        ilike(agentDecisionTable.title, pattern),
        ilike(agentDecisionTable.context, pattern),
        ilike(agentDecisionTable.decision, pattern),
      ),
    );
  }

  const rows = await db
    .select({
      decision: {
        id: agentDecisionTable.id,
        number: agentDecisionTable.number,
        title: agentDecisionTable.title,
        status: agentDecisionTable.status,
        reversible: agentDecisionTable.reversible,
        sourceEntryId: agentDecisionTable.sourceEntryId,
        supersedesDecisionId: agentDecisionTable.supersedesDecisionId,
        refs: agentDecisionTable.refs,
        createdBy: agentDecisionTable.createdBy,
        updatedBy: agentDecisionTable.updatedBy,
        acceptedBy: agentDecisionTable.acceptedBy,
        acceptedAt: agentDecisionTable.acceptedAt,
        createdAt: agentDecisionTable.createdAt,
        updatedAt: agentDecisionTable.updatedAt,
      },
      contextPreview: sql<string>`left(${agentDecisionTable.context}, 240)`,
      createdActor,
      updatedActor,
      createdAuthor: { id: createdAuthor.id, name: createdAuthor.name },
      updatedAuthor: { id: updatedAuthor.id, name: updatedAuthor.name },
      acceptor: { id: acceptor.id, name: acceptor.name },
    })
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
    .leftJoin(acceptor, eq(agentDecisionTable.acceptedBy, acceptor.id))
    .where(and(...conditions))
    .orderBy(desc(agentDecisionTable.number))
    .limit(input.limit);

  const tasks = await loadDecisionTasks(
    input.projectId,
    rows.map((row) => row.decision.id),
  );
  const decisions = rows.map((row) =>
    shapeDecisionSummary(
      row,
      row.contextPreview,
      tasks.get(row.decision.id) ?? [],
    ),
  );
  const last = decisions.at(-1);
  return {
    decisions,
    nextBefore: decisions.length === input.limit && last ? last.id : null,
  };
}

export default listDecisions;
