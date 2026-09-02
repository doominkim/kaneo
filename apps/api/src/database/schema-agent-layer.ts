/**
 * Agent Layer — fork-only schema.
 *
 * See `docs/agent-layer/DESIGN.md`.
 *
 * Rules that must hold (tracking fork discipline):
 * - This file only ADDS tables. It never modifies upstream tables.
 * - It imports from `schema.ts` one-way. `schema.ts` must NOT re-export this
 *   file, otherwise the import cycle breaks Drizzle's lazy references.
 * - Every table is prefixed `agent_` so upstream can never collide.
 * - Migrations live in their own folder (`drizzle-agent/`) with their own
 *   journal and tracking table, generated via `drizzle-agent.config.ts`.
 *   Sharing upstream's journal would conflict on every upstream migration.
 */

import { createId } from "@paralleldrive/cuid2";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { projectTable, taskTable, userTable, workspaceTable } from "./schema";

/* -------------------------------------------------------------------------- */
/* agent_actor — who acted                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A non-human actor. Humans stay in `user`; this table is only for models.
 *
 * Identity is (workspace, human, model) — NOT per session. A session id is
 * recorded on the entry/lease instead, so actor rows stay bounded while a
 * person can still run several concurrent sessions of the same model.
 *
 * `onBehalfOf` is what makes attribution usable on a team: "Claude did it" is
 * not enough, "whose Claude did it" is.
 */
export const agentActorTable = pgTable(
  "agent_actor",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    onBehalfOf: text("on_behalf_of").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    /** anthropic | openai | ... */
    provider: text("provider").notNull(),
    /** claude-opus-5 | gpt-5.6 | ... */
    model: text("model").notNull(),
    /** optional human-facing name */
    label: text("label"),
    firstSeenAt: timestamp("first_seen_at", { mode: "date" })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp("last_seen_at", { mode: "date" })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("agent_actor_workspaceId_idx").on(table.workspaceId),
    index("agent_actor_onBehalfOf_idx").on(table.onBehalfOf),
    unique("agent_actor_workspace_user_model_unique").on(
      table.workspaceId,
      table.onBehalfOf,
      table.model,
    ),
  ],
);

/* -------------------------------------------------------------------------- */
/* agent_entry — the ledger                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Append-only work ledger. This is the agent write surface; `comment` stays the
 * human one. Agents never write comments (the MCP tool set simply does not
 * expose comment writes), which is what keeps a task page from growing without
 * bound.
 *
 * Append-only is enforced at the application layer for now: no update/delete
 * endpoint is exposed. A DB-level trigger can be added later if needed.
 *
 * `taskId` is intentionally NULLABLE — investigation, design discussion and
 * abandoned attempts must be recordable without inventing a task first. This is
 * exactly what upstream `activity` (taskId NOT NULL) cannot express.
 */
export const agentEntryTable = pgTable(
  "agent_entry",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    /** nullable by design — see above. A deleted task must not erase history. */
    taskId: text("task_id").references(() => taskTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    actorId: text("actor_id").references(() => agentActorTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    /** opaque session identifier from the harness */
    sessionId: text("session_id"),

    /** work | investigation | decision | handoff */
    kind: text("kind").notNull().default("work"),
    /** one line, rendered on the human timeline */
    summary: text("summary").notNull(),
    /** long form, agent-facing only */
    body: text("body"),

    /**
     * { what, why, rejected, reversible }
     *
     * `why` and `rejected` are the whole point of this table: code keeps only
     * what was chosen, so a rejected option is unrecoverable once lost.
     */
    decision: jsonb("decision"),

    /** { commits: string[], prs: string[], files: string[] } — references only, never copies */
    refs: jsonb("refs"),

    /** file paths that matched the project's configured core_paths */
    coreChanged: jsonb("core_changed"),

    /*
     * Cost attribution. provider/model live on `agent_actor` because they are
     * the actor's identity; these three vary per appearance, so they live here.
     * All nullable: rows written before 0001 stay NULL and are never backfilled.
     */
    /** low | medium | high | xhigh | max */
    effort: text("effort"),
    /** harness roster name, e.g. "3setter" | "codex" */
    agentLabel: text("agent_label"),
    /** { inputTokens?, outputTokens?, totalTokens?, cacheReadTokens? } — supplied by the harness, the model does not know its own usage */
    usage: jsonb("usage"),

    /** full | summarized | archived — see DESIGN.md compaction tiers */
    compaction: text("compaction").notNull().default("full"),

    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    index("agent_entry_project_createdAt_idx").on(
      table.projectId,
      table.createdAt,
    ),
    index("agent_entry_taskId_idx").on(table.taskId),
    index("agent_entry_actorId_idx").on(table.actorId),
    index("agent_entry_workspaceId_idx").on(table.workspaceId),
    index("agent_entry_compaction_idx").on(table.compaction),
  ],
);

/* -------------------------------------------------------------------------- */
/* agent_lease — who is holding what right now                                 */
/* -------------------------------------------------------------------------- */

/**
 * Soft claim on a task so concurrent sessions do not collide.
 *
 * Session-scoped, not actor-scoped: the same person's two Claude sessions are
 * distinct holders. TTL is mandatory — a dead session must not hold a task
 * forever. Release is a row delete; the durable record lives in the ledger.
 */
export const agentLeaseTable = pgTable(
  "agent_lease",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    actorId: text("actor_id")
      .notNull()
      .references(() => agentActorTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    sessionId: text("session_id").notNull(),
    acquiredAt: timestamp("acquired_at", { mode: "date" })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
  },
  (table) => [
    unique("agent_lease_task_unique").on(table.taskId),
    index("agent_lease_expiresAt_idx").on(table.expiresAt),
    index("agent_lease_workspaceId_idx").on(table.workspaceId),
  ],
);

/* -------------------------------------------------------------------------- */
/* agent_term — the lexicon                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Workspace vocabulary. Resolution must be deterministic: the same term always
 * returns the same answer, with no embedding step and no model judgement.
 *
 * Nothing here is ever deleted. `state` only changes retrieval ranking; a
 * direct resolve always answers in full, because a rarely-used term is exactly
 * the one a new session cannot recover on its own.
 */
export const agentTermTable = pgTable(
  "agent_term",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),

    /** the one true name */
    canonical: text("canonical").notNull(),
    definition: text("definition"),
    /** string[] — spoken/written variants people actually use */
    aliases: jsonb("aliases"),
    /**
     * string[] of agent_term ids.
     * More load-bearing than `aliases`: "this is NOT that" prevents more
     * mistakes than a synonym list does.
     */
    notToConfuseWith: jsonb("not_to_confuse_with"),
    /**
     * Only mappings that search cannot find on its own.
     * A grep-able symbol does not belong here — it fails the recoverability gate.
     */
    anchors: jsonb("anchors"),

    /** proposed | confirmed | disputed — model-proposed entries never auto-confirm */
    confidence: text("confidence").notNull().default("proposed"),
    /** active | dormant | stale | retired(tombstone) */
    state: text("state").notNull().default("active"),
    /** tombstone pointer: "dead, look at this instead" */
    supersededBy: text("superseded_by"),

    ownerId: text("owner_id").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    /** provenance: which ledger entry produced this */
    sourceEntryId: text("source_entry_id").references(
      () => agentEntryTable.id,
      { onDelete: "set null", onUpdate: "cascade" },
    ),

    /*
     * Retrieval-decay fields. Populated from day one even though the decay
     * logic ships later — adding them afterwards would mean no history to
     * decay against.
     */
    lastVerifiedAt: timestamp("last_verified_at", { mode: "date" }),
    lastAccessedAt: timestamp("last_accessed_at", { mode: "date" }),
    accessCount: integer("access_count").notNull().default(0),
    /** 0..1, how rarely this changes; drives re-verification interval */
    stability: integer("stability").notNull().default(50),

    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("agent_term_workspace_canonical_unique").on(
      table.workspaceId,
      table.canonical,
    ),
    index("agent_term_workspaceId_idx").on(table.workspaceId),
    index("agent_term_state_idx").on(table.state),
    index("agent_term_confidence_idx").on(table.confidence),
  ],
);

/* -------------------------------------------------------------------------- */
/* agent_document — human-readable deliverables                                */
/* -------------------------------------------------------------------------- */

/**
 * A deliverable meant to be read whole by a person: session report, design
 * packet. Too large for one ledger entry, and unlike the ledger it is
 * overwritten in place — unbounded growth is prevented by the (project, slug)
 * key rather than by append discipline. Version history, if ever needed, is a
 * separate `agent_document_revision` table (DESIGN.md §10).
 *
 * Authorship rule (application-enforced, not a CHECK constraint): exactly one
 * of `updatedBy` (a human, via the HTTP API) or `actorId` (an agent, via MCP)
 * is set per write, and the other is reset to NULL. Which kind of author wrote
 * the current body is half of how a reader judges it.
 *
 * `taskId` is optional and `SET NULL` on task deletion, like the ledger: a
 * document outlives the task it was produced under.
 */
export const agentDocumentTable = pgTable(
  "agent_document",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    taskId: text("task_id").references(() => taskTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    /** ^[a-z0-9][a-z0-9-]{0,63}$ — validated at the API layer */
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    /** markdown, ≤ 200KB enforced in Zod */
    body: text("body").notNull(),
    /** human author of the current body; NULL when an agent wrote it */
    updatedBy: text("updated_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    /** agent author of the current body; NULL when a human wrote it */
    actorId: text("actor_id").references(() => agentActorTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    unique("agent_document_project_slug_unique").on(
      table.projectId,
      table.slug,
    ),
    index("agent_document_project_task_idx").on(table.projectId, table.taskId),
    index("agent_document_workspaceId_idx").on(table.workspaceId),
  ],
);

/* -------------------------------------------------------------------------- */
/* agent_artifact — uploaded deliverables (html report, zip, pdf, md)          */
/* -------------------------------------------------------------------------- */

/**
 * A file deliverable stored in S3, distinct from the upstream `asset` table:
 * that one is inline description/comment images bound to a task + surface,
 * this one is a project-level output that may or may not belong to a task.
 *
 * Two-step lifecycle. `presign` inserts the row with `finalizedAt` NULL and
 * hands back a PUT URL; `finalize` verifies the object (HeadObject) against the
 * size/contentType recorded here and stamps `finalizedAt`. Only finalized rows
 * are ever listed, served or hung on the tree. A pending row is therefore
 * invisible but keeps its `storageKey`, so an abandoned upload can still be
 * found and cleaned — nothing is orphaned silently.
 *
 * `taskId` is SET NULL on task deletion, like documents: the artifact outlives
 * the task it was produced under. `uploadedBy` (human, HTTP) / `actorId`
 * (agent, MCP) mirror the document authorship rule; Phase 1a' only writes the
 * human side.
 */
export const agentArtifactTable = pgTable(
  "agent_artifact",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    taskId: text("task_id").references(() => taskTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    /** original file name as shown to people; the key uses a sanitized copy */
    name: text("name").notNull(),
    /** one of the allowlisted MIME types, lower-cased at the API layer */
    contentType: text("content_type").notNull(),
    /** bytes, as declared at presign and verified at finalize */
    size: integer("size").notNull(),
    /** full S3 key including S3_KEY_PREFIX; unique so one object maps to one row */
    storageKey: text("storage_key").notNull(),
    uploadedBy: text("uploaded_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    actorId: text("actor_id").references(() => agentActorTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    /** NULL until the object has been verified in storage */
    finalizedAt: timestamp("finalized_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    unique("agent_artifact_storage_key_unique").on(table.storageKey),
    index("agent_artifact_project_task_idx").on(table.projectId, table.taskId),
    index("agent_artifact_workspaceId_idx").on(table.workspaceId),
  ],
);

/* -------------------------------------------------------------------------- */

export type AgentActor = typeof agentActorTable.$inferSelect;
export type NewAgentActor = typeof agentActorTable.$inferInsert;
export type AgentEntry = typeof agentEntryTable.$inferSelect;
export type NewAgentEntry = typeof agentEntryTable.$inferInsert;
export type AgentLease = typeof agentLeaseTable.$inferSelect;
export type NewAgentLease = typeof agentLeaseTable.$inferInsert;
export type AgentTerm = typeof agentTermTable.$inferSelect;
export type NewAgentTerm = typeof agentTermTable.$inferInsert;
export type AgentDocument = typeof agentDocumentTable.$inferSelect;
export type NewAgentDocument = typeof agentDocumentTable.$inferInsert;
export type AgentArtifact = typeof agentArtifactTable.$inferSelect;
export type NewAgentArtifact = typeof agentArtifactTable.$inferInsert;
