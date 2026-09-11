import { sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { EntryRefs } from "../../agent-entry/controllers/entry-fields";
import db from "../../database";
import {
  agentDecisionCounterTable,
  agentDecisionTable,
  agentDecisionTaskTable,
} from "../../database/schema-agent-layer";
import { DECISION_TEXT_BUDGET, DECISION_TITLE_MAX } from "../schema";
import { assertTasksInProject } from "./assert-tasks-in-project";
import { isDecisionTaskForeignKeyError } from "./database-error";
import { creatorColumns, type DecisionAuthor } from "./decision-author";
import { getDecision } from "./decision-record";

export type CreateDecisionInput = {
  workspaceId: string;
  projectId: string;
  title: string;
  context: string;
  decision: string;
  alternatives?: string | null;
  consequences?: string | null;
  sourceNote?: string | null;
  reversible?: boolean | null;
  refs?: EntryRefs | null;
  taskIds: string[];
  sourceEntryId?: string | null;
  author: DecisionAuthor;
};

function nullableText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Allocate the number, draft row and task links in one transaction. */
export async function createDecision(input: CreateDecisionInput) {
  const textBytes = Buffer.byteLength(
    [
      input.context,
      input.decision,
      input.alternatives ?? "",
      input.consequences ?? "",
    ].join(""),
    "utf8",
  );
  if (
    !input.title.trim() ||
    input.title.trim().length > DECISION_TITLE_MAX ||
    !input.context.trim() ||
    !input.decision.trim() ||
    textBytes > DECISION_TEXT_BUDGET
  ) {
    throw new HTTPException(400, { message: "Invalid ADR content" });
  }
  const now = new Date();
  let decisionId: string;
  try {
    decisionId = await db.transaction(async (tx) => {
      await assertTasksInProject(input.projectId, input.taskIds, tx);
      const [counter] = await tx
        .insert(agentDecisionCounterTable)
        .values({ projectId: input.projectId, nextNumber: 2 })
        .onConflictDoUpdate({
          target: agentDecisionCounterTable.projectId,
          set: {
            nextNumber: sql`${agentDecisionCounterTable.nextNumber} + 1`,
          },
        })
        .returning({ nextNumber: agentDecisionCounterTable.nextNumber });
      if (!counter) {
        throw new HTTPException(500, {
          message: "Failed to allocate an ADR number",
        });
      }

      const [created] = await tx
        .insert(agentDecisionTable)
        .values({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          number: counter.nextNumber - 1,
          title: input.title.trim(),
          context: input.context.trim(),
          decision: input.decision.trim(),
          alternatives: nullableText(input.alternatives),
          consequences: nullableText(input.consequences),
          sourceNote: nullableText(input.sourceNote),
          reversible: input.reversible ?? null,
          refs: input.refs ?? null,
          sourceEntryId: input.sourceEntryId ?? null,
          status: "draft",
          ...creatorColumns(input.author),
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: agentDecisionTable.id });
      if (!created) {
        throw new HTTPException(500, { message: "Failed to create ADR" });
      }
      if (input.taskIds.length > 0) {
        await tx.insert(agentDecisionTaskTable).values(
          input.taskIds.map((taskId) => ({
            decisionId: created.id,
            taskId,
          })),
        );
      }
      return created.id;
    });
  } catch (error) {
    if (isDecisionTaskForeignKeyError(error)) {
      throw new HTTPException(400, {
        message: "Every taskId must belong to the ADR project",
      });
    }
    throw error;
  }
  return getDecision(input.projectId, decisionId);
}

export default createDecision;
