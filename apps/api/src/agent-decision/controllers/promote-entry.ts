import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  agentDecisionTable,
  agentEntryTable,
} from "../../database/schema-agent-layer";
import createDecision from "./create-decision";
import { isConstraintError } from "./database-error";
import { mapEntryToDecisionDraft } from "./decision-fields";
import { getDecision } from "./decision-record";

async function findPromoted(projectId: string, entryId: string) {
  const [existing] = await db
    .select({ id: agentDecisionTable.id })
    .from(agentDecisionTable)
    .where(
      and(
        eq(agentDecisionTable.projectId, projectId),
        eq(agentDecisionTable.sourceEntryId, entryId),
      ),
    )
    .limit(1);
  return existing;
}

/** Idempotently copy an immutable legacy decision into an editable ADR draft. */
async function promoteEntry(input: {
  workspaceId: string;
  projectId: string;
  entryId: string;
  userId: string;
}) {
  const promoted = await findPromoted(input.projectId, input.entryId);
  if (promoted) return getDecision(input.projectId, promoted.id);

  const [entry] = await db
    .select({
      summary: agentEntryTable.summary,
      body: agentEntryTable.body,
      decision: agentEntryTable.decision,
      refs: agentEntryTable.refs,
      taskId: agentEntryTable.taskId,
    })
    .from(agentEntryTable)
    .where(
      and(
        eq(agentEntryTable.id, input.entryId),
        eq(agentEntryTable.projectId, input.projectId),
        eq(agentEntryTable.kind, "decision"),
        isNull(agentEntryTable.deletedAt),
      ),
    )
    .limit(1);
  if (!entry) {
    throw new HTTPException(404, {
      message: "Promotable decision entry not found",
    });
  }

  const content = mapEntryToDecisionDraft(entry);
  try {
    return await createDecision({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      ...content,
      taskIds: entry.taskId ? [entry.taskId] : [],
      sourceEntryId: input.entryId,
      author: { userId: input.userId, actorId: null },
    });
  } catch (error) {
    if (
      !isConstraintError(error, "23505", "agent_decision_source_entry_unique")
    ) {
      throw error;
    }
    const concurrent = await findPromoted(input.projectId, input.entryId);
    if (!concurrent) throw error;
    return getDecision(input.projectId, concurrent.id);
  }
}

export default promoteEntry;
