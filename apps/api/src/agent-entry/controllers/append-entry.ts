import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { agentEntryTable } from "../../database/schema-agent-layer";
import type { EntryRefs, EntryUsage } from "./entry-fields";
import resolveActor from "./resolve-actor";

type AppendInput = {
  workspaceId: string;
  userId: string;
  projectId: string;
  taskId?: string | null;
  kind: string;
  summary: string;
  body?: string | null;
  decision?: unknown;
  refs?: EntryRefs | null;
  coreChanged?: string[] | null;
  provider: string;
  model: string;
  sessionId?: string | null;
  effort?: string | null;
  agentLabel?: string | null;
  usage?: EntryUsage | null;
};

/**
 * Append one ledger record. There is no update or delete counterpart — the
 * ledger is append-only, and a correction is a new row rather than an edit.
 */
async function appendEntry(input: AppendInput) {
  const actor = await resolveActor(
    input.workspaceId,
    input.userId,
    input.provider,
    input.model,
  );

  const [entry] = await db
    .insert(agentEntryTable)
    .values({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: input.taskId ?? null,
      actorId: actor?.id ?? null,
      sessionId: input.sessionId ?? null,
      kind: input.kind,
      summary: input.summary,
      body: input.body ?? null,
      decision: input.decision ?? null,
      refs: input.refs ?? null,
      coreChanged: input.coreChanged ?? null,
      effort: input.effort ?? null,
      agentLabel: input.agentLabel ?? null,
      usage: input.usage ?? null,
    })
    .returning();

  if (!entry) {
    throw new HTTPException(500, { message: "Failed to append entry" });
  }

  // Returns the SUMMARY shape, not the full row: an append response has no
  // reason to echo back the body/decision the caller just sent.
  return {
    id: entry.id,
    taskId: entry.taskId,
    kind: entry.kind,
    summary: entry.summary,
    hasDecision: entry.decision != null,
    coreChanged: (entry.coreChanged as string[] | null) ?? null,
    effort: entry.effort,
    agentLabel: entry.agentLabel,
    usage: (entry.usage as EntryUsage | null) ?? null,
    createdAt: entry.createdAt,
    actor: actor
      ? {
          id: actor.id,
          provider: actor.provider,
          model: actor.model,
          onBehalfOf: actor.onBehalfOf,
        }
      : null,
  };
}

export default appendEntry;
