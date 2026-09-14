import { HTTPException } from "hono/http-exception";
import type { EntryRefs } from "../../agent-entry/controllers/entry-fields";

export type DecisionStatus = "accepted" | "superseded";

export type DecisionContent = {
  title: string;
  context: string;
  decision: string;
  alternatives: string | null;
  consequences: string | null;
  sourceNote: string | null;
  reversible: boolean | null;
  refs: EntryRefs | null;
};

type SourceEntry = {
  summary: string;
  body: string | null;
  decision: unknown;
  refs: unknown;
};

export type DecisionTrace = {
  decisionId: string;
  number: number;
  status: "accepted" | "superseded";
  supersedesDecisionId?: string;
  supersededByDecisionId?: string;
};

export function mapEntryToDecisionDraft(entry: SourceEntry): DecisionContent {
  if (!entry.decision || typeof entry.decision !== "object") {
    throw new HTTPException(400, {
      message: "Entry does not contain a promotable decision",
    });
  }
  const value = entry.decision as Record<string, unknown>;
  if (typeof value.what !== "string" || typeof value.why !== "string") {
    throw new HTTPException(400, {
      message: "Entry does not contain a promotable decision",
    });
  }

  return {
    title: entry.summary,
    context: value.why,
    decision: value.what,
    alternatives: typeof value.rejected === "string" ? value.rejected : null,
    consequences: null,
    sourceNote: entry.body,
    reversible: typeof value.reversible === "boolean" ? value.reversible : null,
    refs:
      entry.refs && typeof entry.refs === "object"
        ? (entry.refs as EntryRefs)
        : null,
  };
}

export function buildTimelineDecision(
  content: DecisionContent,
  trace: DecisionTrace,
) {
  return {
    what: content.decision,
    why: content.context,
    ...(content.alternatives ? { rejected: content.alternatives } : {}),
    ...(content.reversible !== null ? { reversible: content.reversible } : {}),
    adr: trace,
  };
}
