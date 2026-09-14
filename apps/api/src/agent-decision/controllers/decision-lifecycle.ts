import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  type AgentDecision,
  agentDecisionTable,
  agentEntryTable,
} from "../../database/schema-agent-layer";
import { isConstraintError } from "./database-error";
import { getDecision } from "./decision-record";
import { removalEntry, statusEntry } from "./decision-timeline";

/*
 * The human side of an auto-applied ADR (agent-autoapply): review, soft
 * delete and restore. The routes refuse API keys before calling these. All
 * timeline entries are authored by the calling person, one per ADR that
 * actually changed.
 */

function inProject(projectId: string, decisionId: string) {
  return and(
    eq(agentDecisionTable.id, decisionId),
    eq(agentDecisionTable.projectId, projectId),
  );
}

export async function reviewDecision(input: {
  projectId: string;
  decisionId: string;
  userId: string;
}) {
  const [row] = await db
    .update(agentDecisionTable)
    .set({ reviewedAt: new Date(), reviewedBy: input.userId })
    .where(
      and(
        inProject(input.projectId, input.decisionId),
        isNull(agentDecisionTable.deletedAt),
      ),
    )
    .returning({ id: agentDecisionTable.id });
  if (!row) throw new HTTPException(404, { message: "ADR not found" });
  return getDecision(input.projectId, row.id);
}

/**
 * Soft-deletes D. When D is the accepted ADR that superseded P, P goes back
 * to `accepted` — a wrong replacement is undone by deleting it — unless P is
 * no longer `superseded` or is itself deleted. A D that is already superseded
 * is history rather than the live replacement of anything, so deleting it
 * changes no other ADR.
 */
export async function deleteDecision(input: {
  workspaceId: string;
  projectId: string;
  decisionId: string;
  userId: string;
}) {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [deleted] = await tx
      .update(agentDecisionTable)
      .set({ deletedAt: now, deletedBy: input.userId })
      .where(
        and(
          inProject(input.projectId, input.decisionId),
          isNull(agentDecisionTable.deletedAt),
        ),
      )
      .returning();
    if (!deleted) throw new HTTPException(404, { message: "ADR not found" });

    let restored: AgentDecision | undefined;
    if (deleted.status === "accepted" && deleted.supersedesDecisionId) {
      [restored] = await tx
        .update(agentDecisionTable)
        .set({ status: "accepted", updatedAt: now })
        .where(
          and(
            inProject(input.projectId, deleted.supersedesDecisionId),
            eq(agentDecisionTable.status, "superseded"),
            isNull(agentDecisionTable.deletedAt),
          ),
        )
        .returning();
    }

    const person = { userId: input.userId, actorId: null };
    await tx
      .insert(agentEntryTable)
      .values([
        removalEntry(deleted, "삭제", input.userId, now),
        ...(restored
          ? [statusEntry(restored, { status: "accepted" }, person, now)]
          : []),
      ]);
    return {
      id: deleted.id,
      deletedAt: now,
      deletedBy: input.userId,
      restoredDecisionId: restored?.id ?? null,
    };
  });
}

/**
 * Restores D to how it was before the delete. A deleted ADR cannot be
 * superseded, so D's status is still the one it had when it was deleted.
 *
 * When D is accepted and supersedes P, P must still be `accepted` and not
 * deleted to be superseded again; otherwise the restore is a 409 and nothing
 * changes, because two live replacements of one ADR, or a replacement of a
 * deleted one, is not a state D was in. A superseded D is only un-deleted.
 */
export async function restoreDecision(input: {
  workspaceId: string;
  projectId: string;
  decisionId: string;
  userId: string;
}) {
  const now = new Date();
  try {
    const decisionId = await db.transaction(async (tx) => {
      const [target] = await tx
        .select()
        .from(agentDecisionTable)
        .where(
          and(
            inProject(input.projectId, input.decisionId),
            isNotNull(agentDecisionTable.deletedAt),
          ),
        )
        .limit(1);
      if (!target) throw new HTTPException(404, { message: "ADR not found" });

      let resuperseded: AgentDecision | undefined;
      if (target.status === "accepted" && target.supersedesDecisionId) {
        [resuperseded] = await tx
          .update(agentDecisionTable)
          .set({ status: "superseded", updatedAt: now })
          .where(
            and(
              inProject(input.projectId, target.supersedesDecisionId),
              eq(agentDecisionTable.status, "accepted"),
              isNull(agentDecisionTable.deletedAt),
            ),
          )
          .returning();
        if (!resuperseded) {
          throw new HTTPException(409, {
            message:
              "The ADR this one superseded is no longer accepted, so it cannot be superseded again",
          });
        }
      }

      const [restored] = await tx
        .update(agentDecisionTable)
        .set({ deletedAt: null, deletedBy: null })
        .where(
          and(
            inProject(input.projectId, input.decisionId),
            isNotNull(agentDecisionTable.deletedAt),
          ),
        )
        .returning();
      if (!restored) throw new HTTPException(404, { message: "ADR not found" });

      const person = { userId: input.userId, actorId: null };
      await tx
        .insert(agentEntryTable)
        .values([
          removalEntry(restored, "복구", input.userId, now),
          ...(resuperseded
            ? [
                statusEntry(
                  resuperseded,
                  { status: "superseded", supersededByDecisionId: restored.id },
                  person,
                  now,
                ),
              ]
            : []),
        ]);
      return restored.id;
    });
    return getDecision(input.projectId, decisionId);
  } catch (error) {
    if (isConstraintError(error, "23505", "agent_decision_supersedes_unique")) {
      throw new HTTPException(409, {
        message: "The ADR this one superseded already has another replacement",
      });
    }
    throw error;
  }
}
