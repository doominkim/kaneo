import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  type AgentDecision,
  agentDecisionTable,
  agentEntryTable,
} from "../../database/schema-agent-layer";
import { isConstraintError } from "./database-error";
import { adrLabel, lockChain } from "./decision-chain";
import { getDecision } from "./decision-record";
import { removalEntry, statusEntry } from "./decision-timeline";

/*
 * The human side of an auto-applied ADR (agent-autoapply): review, soft
 * delete and restore. The routes refuse API keys before calling these. All
 * timeline entries are authored by the calling person, one per ADR that
 * actually changed, in the same transaction as the change.
 *
 * Delete and restore keep the supersede-chain invariant described in
 * `decision-chain.ts`: per chain, at most one live accepted ADR, exactly one
 * while any ADR of the chain is live.
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
 * Soft-deletes D. When D is accepted, acceptance goes back to D's nearest
 * live ancestor — walking past ancestors that are deleted themselves — so a
 * wrong replacement is undone by deleting it. A D that is already superseded
 * is history rather than the live end of its chain, so deleting it changes no
 * other ADR.
 */
export async function deleteDecision(input: {
  workspaceId: string;
  projectId: string;
  decisionId: string;
  userId: string;
}) {
  const now = new Date();
  return db.transaction(async (tx) => {
    const chain = await lockChain(tx, input.projectId, input.decisionId);
    if (!chain) throw new HTTPException(404, { message: "ADR not found" });

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
    const ancestor =
      deleted.status === "accepted"
        ? chain.nearestLiveAncestor(deleted.id)
        : null;
    // The other-accepted check only matters for rows written before the
    // invariant existed: it never turns one accepted ADR into two.
    const otherAccepted = chain
      .liveAccepted()
      .some((node) => node.id !== deleted.id);
    if (ancestor?.status === "superseded" && !otherAccepted) {
      [restored] = await tx
        .update(agentDecisionTable)
        .set({ status: "accepted", updatedAt: now })
        .where(
          and(
            inProject(input.projectId, ancestor.id),
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
 * Restores D. A deleted ADR cannot be superseded, so D's status is still the
 * one it had when it was deleted, and it comes back with that status.
 *
 * - D accepted: with no live accepted ADR in the chain, D is simply restored.
 *   When the chain's accepted ADR is D's nearest live ancestor, that ADR is
 *   superseded again in the same transaction. Any other accepted ADR means
 *   the chain moved on without D: 409, nothing changes.
 * - D superseded: restored only while a live accepted ADR is among its
 *   descendants, and no other ADR changes; otherwise 409.
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
      const chain = await lockChain(tx, input.projectId, input.decisionId);
      const target = chain?.node(input.decisionId);
      if (!chain || !target?.deletedAt) {
        throw new HTTPException(404, { message: "ADR not found" });
      }

      let resuperseded: AgentDecision | undefined;
      if (target.status === "accepted") {
        const [accepted, ...more] = chain.liveAccepted();
        const ancestor = chain.nearestLiveAncestor(target.id);
        if (accepted && (more.length > 0 || accepted.id !== ancestor?.id)) {
          throw new HTTPException(409, {
            message: `${adrLabel(accepted)} is now the accepted ADR of this supersede chain; restoring this one would make a second accepted ADR`,
          });
        }
        if (accepted) {
          [resuperseded] = await tx
            .update(agentDecisionTable)
            .set({ status: "superseded", updatedAt: now })
            .where(
              and(
                inProject(input.projectId, accepted.id),
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
      } else if (!chain.hasLiveAcceptedBelow(target.id)) {
        throw new HTTPException(409, {
          message:
            "No live ADR replaces this superseded ADR; restore the ADR that replaced it first",
        });
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
