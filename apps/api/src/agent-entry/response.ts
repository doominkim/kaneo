import { responseTimestamp, z } from "../openapi";
import { refsBody, usageBody } from "./schema";

const actorSchema = z
  .object({
    id: z.string(),
    provider: z.string(),
    model: z.string(),
    onBehalfOf: z.string().nullable(),
  })
  .openapi("AgentActor");

/**
 * Summary shape — deliberately WITHOUT `body` and `decision`.
 *
 * The whole point of this layer is that a list call has a bounded cost. Upstream
 * `list_tasks` ships every task's full description and measured 18.5KB for 20
 * rows; a ledger listing must not repeat that mistake. Callers that need the
 * full record fetch one entry by id.
 */
export const entrySummarySchema = z
  .object({
    id: z.string(),
    taskId: z.string().nullable(),
    kind: z.string(),
    summary: z.string(),
    hasDecision: z.boolean().openapi({
      description:
        "Whether a decision payload exists. Fetch the entry by id to read it.",
    }),
    coreChanged: z.array(z.string()).nullable().openapi({
      description:
        "Server judgment of `refs.files` against the project's core-path patterns at append time: null = not judged (no `refs.files`), [] = judged, nothing matched. Never recomputed.",
    }),
    repo: z.string().nullable().openapi({
      description: "`refs.repo`, lifted so a listing can show it per row.",
    }),
    branch: z.string().nullable().openapi({
      description: "`refs.branch`, lifted so a listing can show it per row.",
    }),
    effort: z.string().nullable(),
    agentLabel: z.string().nullable(),
    usage: usageBody.nullable(),
    createdAt: responseTimestamp,
    actor: actorSchema.nullable(),
  })
  .openapi("AgentEntrySummary");

export const entryListSchema = z
  .object({
    entries: z.array(entrySummarySchema),
    nextBefore: z.string().nullable().openapi({
      description:
        "Opaque cursor for the next page — pass it back as `before` — or null when exhausted.",
    }),
  })
  .openapi("AgentEntryList");

export const entryDetailSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    projectId: z.string(),
    taskId: z.string().nullable(),
    kind: z.string(),
    summary: z.string(),
    body: z.string().nullable(),
    decision: z.unknown(),
    refs: refsBody.nullable(),
    coreChanged: z.array(z.string()).nullable().openapi({
      description:
        "Server judgment of `refs.files` against the project's core-path patterns at append time: null = not judged (no `refs.files`), [] = judged, nothing matched. Rows written before server-side judgment carry the client's claim.",
    }),
    effort: z.string().nullable(),
    agentLabel: z.string().nullable(),
    usage: usageBody.nullable(),
    compaction: z.string(),
    sessionId: z.string().nullable(),
    createdAt: responseTimestamp,
    actor: actorSchema.nullable(),
  })
  .openapi("AgentEntryDetail");
