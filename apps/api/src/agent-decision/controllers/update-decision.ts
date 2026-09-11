import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { EntryRefs } from "../../agent-entry/controllers/entry-fields";
import db from "../../database";
import {
  agentDecisionTable,
  agentDecisionTaskTable,
} from "../../database/schema-agent-layer";
import { DECISION_TEXT_BUDGET } from "../schema";
import { assertTasksInProject } from "./assert-tasks-in-project";
import { isDecisionTaskForeignKeyError } from "./database-error";
import { type DecisionAuthor, editorColumns } from "./decision-author";
import { getDecision } from "./decision-record";

type UpdateInput = {
  projectId: string;
  decisionId: string;
  expectedUpdatedAt: string;
  title?: string;
  context?: string;
  decision?: string;
  alternatives?: string | null;
  consequences?: string | null;
  reversible?: boolean | null;
  refs?: EntryRefs | null;
  taskIds?: string[];
  author: DecisionAuthor;
};

function optionalText(value: string | null | undefined) {
  if (value === undefined) return undefined;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function textBytes(value: {
  context: string;
  decision: string;
  alternatives: string | null;
  consequences: string | null;
}) {
  return Buffer.byteLength(
    [
      value.context,
      value.decision,
      value.alternatives ?? "",
      value.consequences ?? "",
    ].join(""),
    "utf8",
  );
}

async function updateDecision(input: UpdateInput) {
  const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
  let decisionId: string;
  try {
    decisionId = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(agentDecisionTable)
        .where(
          and(
            eq(agentDecisionTable.id, input.decisionId),
            eq(agentDecisionTable.projectId, input.projectId),
          ),
        )
        .limit(1);
      if (!current) {
        throw new HTTPException(404, { message: "ADR not found" });
      }
      if (
        current.status !== "draft" ||
        current.updatedAt.getTime() !== expectedUpdatedAt.getTime()
      ) {
        throw new HTTPException(409, {
          message: "ADR is no longer an editable version",
        });
      }
      if (input.taskIds) {
        await assertTasksInProject(input.projectId, input.taskIds, tx);
      }

      const alternatives = optionalText(input.alternatives);
      const consequences = optionalText(input.consequences);
      const merged = {
        context: input.context?.trim() ?? current.context,
        decision: input.decision?.trim() ?? current.decision,
        alternatives:
          alternatives === undefined ? current.alternatives : alternatives,
        consequences:
          consequences === undefined ? current.consequences : consequences,
      };
      if (textBytes(merged) > DECISION_TEXT_BUDGET) {
        throw new HTTPException(400, {
          message: "ADR text must be at most 200KB in total",
        });
      }

      // Millisecond timestamps are the public concurrency token. Advancing at
      // least one millisecond prevents two writes in the same clock tick from
      // reusing the token and both appearing current.
      const now = new Date(
        Math.max(Date.now(), current.updatedAt.getTime() + 1),
      );
      const [updated] = await tx
        .update(agentDecisionTable)
        .set({
          ...(input.title !== undefined ? { title: input.title.trim() } : {}),
          ...(input.context !== undefined ? { context: merged.context } : {}),
          ...(input.decision !== undefined
            ? { decision: merged.decision }
            : {}),
          ...(alternatives !== undefined ? { alternatives } : {}),
          ...(consequences !== undefined ? { consequences } : {}),
          ...(input.reversible !== undefined
            ? { reversible: input.reversible }
            : {}),
          ...(input.refs !== undefined ? { refs: input.refs } : {}),
          ...editorColumns(input.author),
          updatedAt: now,
        })
        .where(
          and(
            eq(agentDecisionTable.id, input.decisionId),
            eq(agentDecisionTable.projectId, input.projectId),
            eq(agentDecisionTable.status, "draft"),
            eq(agentDecisionTable.updatedAt, expectedUpdatedAt),
          ),
        )
        .returning({ id: agentDecisionTable.id });
      if (!updated) {
        throw new HTTPException(409, {
          message: "ADR changed while it was being edited",
        });
      }

      if (input.taskIds) {
        await tx
          .delete(agentDecisionTaskTable)
          .where(eq(agentDecisionTaskTable.decisionId, input.decisionId));
        if (input.taskIds.length > 0) {
          await tx.insert(agentDecisionTaskTable).values(
            input.taskIds.map((taskId) => ({
              decisionId: input.decisionId,
              taskId,
            })),
          );
        }
      }
      return updated.id;
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

export default updateDecision;
