import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import getSettings from "../../agent-project/controllers/get-settings";
import { judgeCoreChanged } from "../../agent-project/core-paths";
import db from "../../database";
import { userTable } from "../../database/schema";
import { agentEntryTable } from "../../database/schema-agent-layer";
import {
  type EntryRefs,
  type EntryUsage,
  liftRefs,
  shapeAuthorship,
} from "./entry-fields";
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
  /** Both set → agent entry; both absent → human entry. Validated at the edge. */
  provider?: string;
  model?: string;
  sessionId?: string | null;
  effort?: string | null;
  agentLabel?: string | null;
  usage?: EntryUsage | null;
};

/**
 * Append one ledger record. There is no update or delete counterpart — the
 * ledger is append-only, and a correction is a new row rather than an edit.
 *
 * `coreChanged` is decided here, not by the caller (DESIGN.md §6.2): the
 * project's core-path patterns are matched against `refs.files` at append
 * time, and the verdict is stored with the row. It is never recomputed, so
 * changing the patterns later does not rewrite history.
 *
 * Authorship is exactly one of `actorId` (provider/model given) or
 * `createdBy` (neither given: the calling user). The schema already rejected
 * the mixed cases, so `provider && model` is the only branch decided here.
 */
async function appendEntry(input: AppendInput) {
  const isAgent = input.provider != null && input.model != null;
  const [actor, author, settings] = await Promise.all([
    isAgent
      ? resolveActor(
          input.workspaceId,
          input.userId,
          input.provider as string,
          input.model as string,
        )
      : null,
    isAgent
      ? null
      : db
          .select({ id: userTable.id, name: userTable.name })
          .from(userTable)
          .where(eq(userTable.id, input.userId))
          .limit(1)
          .then((rows) => rows[0] ?? null),
    getSettings(input.projectId),
  ]);
  const coreChanged = judgeCoreChanged(input.refs?.files, settings.corePaths);

  const [entry] = await db
    .insert(agentEntryTable)
    .values({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: input.taskId ?? null,
      actorId: actor?.id ?? null,
      createdBy: isAgent ? null : input.userId,
      sessionId: input.sessionId ?? null,
      kind: input.kind,
      summary: input.summary,
      body: input.body ?? null,
      decision: input.decision ?? null,
      refs: input.refs ?? null,
      coreChanged,
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
    ...liftRefs(entry.refs as EntryRefs | null),
    effort: entry.effort,
    agentLabel: entry.agentLabel,
    usage: (entry.usage as EntryUsage | null) ?? null,
    createdAt: entry.createdAt,
    ...shapeAuthorship(actor, author),
  };
}

export default appendEntry;
