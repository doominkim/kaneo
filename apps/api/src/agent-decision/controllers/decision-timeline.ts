import type { EntryRefs } from "../../agent-entry/controllers/entry-fields";
import type {
  AgentDecision,
  agentEntryTable,
} from "../../database/schema-agent-layer";
import type { DecisionAuthor } from "./decision-author";
import {
  buildTimelineDecision,
  type DecisionContent,
  type DecisionTrace,
} from "./decision-fields";

type EntryInsert = typeof agentEntryTable.$inferInsert;

function contentOf(row: AgentDecision): DecisionContent {
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

function label(row: AgentDecision) {
  return `ADR-${String(row.number).padStart(3, "0")}`;
}

/**
 * A status change the timeline can deep-link: the entry carries the ADR trace
 * (`accepted` or `superseded`) that `liftDecisionTrace` reads back.
 */
export function statusEntry(
  row: AgentDecision,
  trace: Omit<DecisionTrace, "decisionId" | "number">,
  author: DecisionAuthor,
  createdAt: Date,
): EntryInsert {
  return {
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    taskId: null,
    createdBy: author.userId,
    actorId: author.actorId,
    kind: "decision",
    summary: `${label(row)} · ${row.title}`.slice(0, 200),
    body: row.consequences,
    decision: buildTimelineDecision(contentOf(row), {
      decisionId: row.id,
      number: row.number,
      ...trace,
    }),
    refs: null,
    coreChanged: null,
    createdAt,
  };
}

/**
 * Delete and restore are not ADR statuses, so they are plain work entries
 * naming the record rather than traces a reader would mistake for a status.
 */
export function removalEntry(
  row: AgentDecision,
  action: "삭제" | "복구",
  userId: string,
  createdAt: Date,
): EntryInsert {
  return {
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    taskId: null,
    createdBy: userId,
    actorId: null,
    kind: "work",
    summary: `${label(row)} ${action} · ${row.title}`.slice(0, 200),
    body: null,
    decision: null,
    refs: null,
    coreChanged: null,
    createdAt,
  };
}
