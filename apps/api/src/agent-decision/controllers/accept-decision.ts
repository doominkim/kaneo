import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { EntryRefs } from "../../agent-entry/controllers/entry-fields";
import db from "../../database";
import {
  agentDecisionTable,
  agentEntryTable,
} from "../../database/schema-agent-layer";
import { isConstraintError } from "./database-error";
import { buildTimelineDecision, type DecisionContent } from "./decision-fields";
import { getDecision } from "./decision-record";

function contentOf(
  row: typeof agentDecisionTable.$inferSelect,
): DecisionContent {
  return {
    title: row.title,
    context: row.context,
    decision: row.decision,
    alternatives: row.alternatives,
    consequences: row.consequences,
    sourceNote: row.sourceNote,
    reversible: row.reversible,
    refs: (row.refs as EntryRefs | null) ?? null,
  };
}

function timelineSummary(number: number, title: string) {
  return `ADR-${String(number).padStart(3, "0")} · ${title}`.slice(0, 200);
}

async function acceptDecision(input: {
  workspaceId: string;
  projectId: string;
  decisionId: string;
  expectedUpdatedAt: string;
  supersedesDecisionId?: string;
  userId: string;
}) {
  if (input.supersedesDecisionId === input.decisionId) {
    throw new HTTPException(400, { message: "An ADR cannot supersede itself" });
  }
  const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
  try {
    const decisionId = await db.transaction(async (tx) => {
      const [draft] = await tx
        .select()
        .from(agentDecisionTable)
        .where(
          and(
            eq(agentDecisionTable.id, input.decisionId),
            eq(agentDecisionTable.projectId, input.projectId),
          ),
        )
        .limit(1);
      if (!draft) {
        throw new HTTPException(404, { message: "ADR not found" });
      }
      if (
        draft.status !== "draft" ||
        draft.updatedAt.getTime() !== expectedUpdatedAt.getTime()
      ) {
        throw new HTTPException(409, {
          message: "ADR is no longer the draft that was reviewed",
        });
      }

      let previous: typeof agentDecisionTable.$inferSelect | undefined;
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
        if (previous.status !== "accepted") {
          throw new HTTPException(409, {
            message: "Only an accepted ADR can be superseded",
          });
        }
      }

      const now = new Date(Math.max(Date.now(), draft.updatedAt.getTime() + 1));
      if (previous) {
        const [superseded] = await tx
          .update(agentDecisionTable)
          .set({ status: "superseded", updatedAt: now })
          .where(
            and(
              eq(agentDecisionTable.id, previous.id),
              eq(agentDecisionTable.projectId, input.projectId),
              eq(agentDecisionTable.status, "accepted"),
            ),
          )
          .returning({ id: agentDecisionTable.id });
        if (!superseded) {
          throw new HTTPException(409, {
            message: "The previous ADR was superseded concurrently",
          });
        }
      }

      const [accepted] = await tx
        .update(agentDecisionTable)
        .set({
          status: "accepted",
          supersedesDecisionId: previous?.id ?? null,
          acceptedBy: input.userId,
          acceptedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(agentDecisionTable.id, draft.id),
            eq(agentDecisionTable.projectId, input.projectId),
            eq(agentDecisionTable.status, "draft"),
            eq(agentDecisionTable.updatedAt, expectedUpdatedAt),
          ),
        )
        .returning({ id: agentDecisionTable.id });
      if (!accepted) {
        throw new HTTPException(409, {
          message: "ADR changed while it was being accepted",
        });
      }

      const timelineRows: Array<typeof agentEntryTable.$inferInsert> = [];
      if (previous) {
        timelineRows.push({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          taskId: null,
          createdBy: input.userId,
          actorId: null,
          kind: "decision",
          summary: timelineSummary(previous.number, previous.title),
          body: previous.consequences,
          decision: buildTimelineDecision(contentOf(previous), {
            decisionId: previous.id,
            number: previous.number,
            status: "superseded",
            supersededByDecisionId: draft.id,
          }),
          refs: null,
          coreChanged: null,
          createdAt: now,
        });
      }
      timelineRows.push({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        taskId: null,
        createdBy: input.userId,
        actorId: null,
        kind: "decision",
        summary: timelineSummary(draft.number, draft.title),
        body: draft.consequences,
        decision: buildTimelineDecision(contentOf(draft), {
          decisionId: draft.id,
          number: draft.number,
          status: "accepted",
          ...(previous ? { supersedesDecisionId: previous.id } : {}),
        }),
        refs: null,
        coreChanged: null,
        createdAt: now,
      });
      await tx.insert(agentEntryTable).values(timelineRows);
      return accepted.id;
    });
    return getDecision(input.projectId, decisionId);
  } catch (error) {
    if (isConstraintError(error, "23505", "agent_decision_supersedes_unique")) {
      throw new HTTPException(409, {
        message: "The previous ADR already has a replacement",
      });
    }
    throw error;
  }
}

export default acceptDecision;
