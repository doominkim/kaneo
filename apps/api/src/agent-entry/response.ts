import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";
import { actorResponseSchema } from "./actor-response";
import { refsBody, usageBody } from "./schema";

/**
 * The shared actor block, registered under the `AgentActor` component name.
 * `actor-response.ts` leaves its copy unnamed precisely so this is the only
 * registration; documents, artifacts, and terms inline the same shape.
 */
const actorSchema = actorResponseSchema.openapi("AgentActor");

const authorSchema = z
  .object({
    userId: z.string(),
    name: z.string(),
  })
  .openapi("AgentEntryAuthor");

const actorField = actorSchema.nullable().openapi({
  description:
    "The agent that wrote the entry; null for a human entry (see `author`).",
});
const authorField = authorSchema.nullable().openapi({
  description:
    "The person who wrote the entry from the UI; null for an agent entry (see `actor`). At most one of `actor`/`author` is set; both null means the author row was deleted.",
});

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
    deletedAt: nullableResponseTimestamp.openapi({
      description:
        "When the entry was soft-deleted, or null. Non-null only appears on listings requested with `includeDeleted=true`.",
    }),
    actor: actorField,
    author: authorField,
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
    deletedAt: nullableResponseTimestamp.openapi({
      description:
        "When the entry was soft-deleted, or null. A deleted entry is only returned with `includeDeleted=true`.",
    }),
    deletedBy: z.string().nullable().openapi({
      description:
        "User id of whoever soft-deleted the entry; null when not deleted, or when that account was since removed.",
    }),
    actor: actorField,
    author: authorField,
  })
  .openapi("AgentEntryDetail");

/**
 * Delete and restore answer with the same shape: the id and the current
 * `deletedAt` (set after a delete, null after a restore), so a client can
 * patch its cached row instead of refetching the page.
 */
export const entryDeleteResultSchema = z
  .object({
    id: z.string(),
    deletedAt: nullableResponseTimestamp,
  })
  .openapi("AgentEntryDeleteResult");
