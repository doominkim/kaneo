import { and, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { EntryRefs } from "../../agent-entry/controllers/entry-fields";
import db from "../../database";
import {
  type AgentDecision,
  agentDecisionCounterTable,
  agentDecisionTable,
  agentDecisionTaskTable,
  agentEntryTable,
} from "../../database/schema-agent-layer";
import { DECISION_TEXT_BUDGET, DECISION_TITLE_MAX } from "../schema";
import { assertTasksInProject } from "./assert-tasks-in-project";
import {
  isConstraintError,
  isDecisionTaskForeignKeyError,
} from "./database-error";
import {
  acceptanceColumns,
  creatorColumns,
  type DecisionAuthor,
} from "./decision-author";
import { lockChainRoot } from "./decision-chain";
import { getDecision } from "./decision-record";
import { statusEntry } from "./decision-timeline";

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
  supersedesDecisionId?: string | null;
  author: DecisionAuthor;
  /** An API-key call: authored by the key's owner, but not a review. */
  viaApiKey?: boolean;
};

function nullableText(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Allocate the number, the accepted ADR, its task links and its timeline
 * entries in one transaction; there is no draft (agent-autoapply).
 *
 * With `supersedesDecisionId` the previous ADR becomes superseded in the same
 * transaction, so an agent's replacement applies as immediately as its
 * original did. The conditional update is the real guard: a target that is
 * not accepted, is deleted, or was just superseded by a concurrent create
 * matches no row and the whole create is a 409 with nothing written.
 */
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

      let previous: AgentDecision | undefined;
      if (input.supersedesDecisionId) {
        [previous] = await tx
          .select()
          .from(agentDecisionTable)
          .where(
            and(
              eq(agentDecisionTable.id, input.supersedesDecisionId),
              eq(agentDecisionTable.projectId, input.projectId),
            ),
          )
          .limit(1);
        if (!previous) {
          throw new HTTPException(404, {
            message: "The ADR to supersede was not found",
          });
        }
        // Serialises with delete and restore in the same chain (see
        // decision-chain.ts); the conditional update below then sees the
        // state they committed.
        await lockChainRoot(tx, input.projectId, previous.id);
      }

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

      if (previous) {
        const [superseded] = await tx
          .update(agentDecisionTable)
          .set({ status: "superseded", updatedAt: now })
          .where(
            and(
              eq(agentDecisionTable.id, previous.id),
              eq(agentDecisionTable.projectId, input.projectId),
              eq(agentDecisionTable.status, "accepted"),
              isNull(agentDecisionTable.deletedAt),
            ),
          )
          .returning({ id: agentDecisionTable.id });
        if (!superseded) {
          throw new HTTPException(409, {
            message:
              "Only an accepted, non-deleted ADR can be superseded, and this one no longer is",
          });
        }
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
          supersedesDecisionId: previous?.id ?? null,
          ...acceptanceColumns(input.author, now, input.viaApiKey),
          ...creatorColumns(input.author),
          createdAt: now,
          updatedAt: now,
        })
        .returning();
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

      const timeline = previous
        ? [
            statusEntry(
              previous,
              { status: "superseded", supersededByDecisionId: created.id },
              input.author,
              now,
            ),
          ]
        : [];
      timeline.push(
        statusEntry(
          created,
          {
            status: "accepted",
            ...(previous ? { supersedesDecisionId: previous.id } : {}),
          },
          input.author,
          now,
        ),
      );
      await tx.insert(agentEntryTable).values(timeline);
      return created.id;
    });
  } catch (error) {
    if (isDecisionTaskForeignKeyError(error)) {
      throw new HTTPException(400, {
        message: "Every taskId must belong to the ADR project",
      });
    }
    if (isConstraintError(error, "23505", "agent_decision_supersedes_unique")) {
      throw new HTTPException(409, {
        message: "The previous ADR already has a replacement",
      });
    }
    throw error;
  }
  return getDecision(input.projectId, decisionId);
}

export default createDecision;
