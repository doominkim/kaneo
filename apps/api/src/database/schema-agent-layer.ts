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
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { projectTable, taskTable, userTable, workspaceTable } from "./schema";

/* -------------------------------------------------------------------------- */
/* agent_actor — who acted                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A non-human actor. Humans stay in `user`; this table is only for models.
 *
 * Identity is (workspace, human, provider, model) — NOT per session. A session id is
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
    unique("agent_actor_workspace_user_provider_model_unique").on(
      table.workspaceId,
      table.onBehalfOf,
      table.provider,
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
 * Append-only is enforced at the application layer: no update endpoint is
 * exposed, and "delete" is a soft delete (`deletedAt`/`deletedBy`) that hides
 * the row without touching any other column. A DB-level trigger can be added
 * later if needed.
 *
 * `taskId` is intentionally NULLABLE — investigation, design discussion and
 * abandoned attempts must be recordable without inventing a task first. This is
 * exactly what upstream `activity` (taskId NOT NULL) cannot express.
 *
 * Authorship rule (application-enforced, not a CHECK constraint — the same
 * rule `agent_document` uses): exactly one of `actorId` (an agent, via MCP or
 * the API with provider/model) or `createdBy` (a human, via the UI) is set per
 * row. Both are `SET NULL` on delete, so an old row can end up with neither;
 * readers must treat that as "author unknown", never as "both".
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
    /** agent author; NULL when a human wrote the row */
    actorId: text("actor_id").references(() => agentActorTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    /** human author; NULL when an agent wrote the row (added in 0004) */
    createdBy: text("created_by").references(() => userTable.id, {
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

    /*
     * Soft delete (0006). "Hide, never edit": a deleted row keeps every field
     * and only stops being read. Default reads filter on `deleted_at IS NULL`;
     * restore clears both columns. `deletedBy` is SET NULL like the other
     * user references, so the row survives the deleter's account.
     */
    deletedAt: timestamp("deleted_at", { mode: "date" }),
    deletedBy: text("deleted_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
  },
  (table) => [
    index("agent_entry_project_createdAt_idx").on(
      table.projectId,
      table.createdAt,
    ),
    index("agent_entry_taskId_idx").on(table.taskId),
    index("agent_entry_actorId_idx").on(table.actorId),
    index("agent_entry_createdBy_idx").on(table.createdBy),
    index("agent_entry_workspaceId_idx").on(table.workspaceId),
    index("agent_entry_compaction_idx").on(table.compaction),
  ],
);

/* -------------------------------------------------------------------------- */
/* agent_decision — architecture decision records                              */
/* -------------------------------------------------------------------------- */

/**
 * A project ADR. Drafts are editable; accepted and superseded rows are
 * immutable at the application boundary. The append-only `agent_entry` ledger
 * remains the audit stream and receives a structured entry when a draft is
 * accepted or an accepted ADR is superseded.
 *
 * `sourceEntryId` promotes an older ledger decision without rewriting it.
 * `supersedesDecisionId` points from the replacement to the record it replaced;
 * the partial unique index lets drafts express no pending intent while ensuring
 * one accepted ADR cannot acquire two replacements.
 */
export const agentDecisionTable = pgTable(
  "agent_decision",
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
    /** Stable, monotonically allocated within one project. */
    number: integer("number").notNull(),
    title: text("title").notNull(),
    context: text("context").notNull(),
    decision: text("decision").notNull(),
    alternatives: text("alternatives"),
    consequences: text("consequences"),
    /** Uninterpreted body copied from a promoted legacy decision entry. */
    sourceNote: text("source_note"),
    reversible: boolean("reversible"),
    /**
     * accepted | superseded. `draft` is gone (agent-autoapply) and refused by
     * a CHECK since 0014, so a legacy writer relying on the default cannot
     * bring it back.
     */
    status: text("status").notNull().default("accepted"),
    /** Same reference shape as `agent_entry.refs`. */
    refs: jsonb("refs"),
    /** Optional provenance when an existing ledger decision became this ADR. */
    sourceEntryId: text("source_entry_id").references(
      () => agentEntryTable.id,
      { onDelete: "set null", onUpdate: "cascade" },
    ),
    /** The accepted ADR replaced by this one. Accepted rows only. */
    supersedesDecisionId: text("supersedes_decision_id").references(
      (): AnyPgColumn => agentDecisionTable.id,
      { onDelete: "restrict", onUpdate: "cascade" },
    ),

    /** Exactly one creator column is populated by the application. */
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdActorId: text("created_actor_id").references(
      () => agentActorTable.id,
      { onDelete: "set null", onUpdate: "cascade" },
    ),
    /** Exactly one last-editor column is populated while the row is a draft. */
    updatedBy: text("updated_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    updatedActorId: text("updated_actor_id").references(
      () => agentActorTable.id,
      { onDelete: "set null", onUpdate: "cascade" },
    ),
    /** Acceptance is a human project-governance action. */
    acceptedBy: text("accepted_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    acceptedAt: timestamp("accepted_at", { mode: "date" }),
    /*
     * Review marker (0013, agent-autoapply). Agent writes take effect at once;
     * `reviewedAt` NULL is the "unreviewed" flag a person clears afterwards.
     */
    reviewedAt: timestamp("reviewed_at", { mode: "date" }),
    reviewedBy: text("reviewed_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    /** Soft delete (0013), same shape as `agent_entry`. */
    deletedAt: timestamp("deleted_at", { mode: "date" }),
    deletedBy: text("deleted_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    unique("agent_decision_project_number_unique").on(
      table.projectId,
      table.number,
    ),
    uniqueIndex("agent_decision_source_entry_unique")
      .on(table.sourceEntryId)
      .where(sql`${table.sourceEntryId} IS NOT NULL`),
    // A soft-deleted replacement must not block superseding the same ADR again.
    uniqueIndex("agent_decision_supersedes_unique")
      .on(table.supersedesDecisionId)
      .where(
        sql`${table.supersedesDecisionId} IS NOT NULL AND ${table.deletedAt} IS NULL`,
      ),
    index("agent_decision_project_status_number_idx").on(
      table.projectId,
      table.status,
      table.number,
    ),
    index("agent_decision_workspaceId_idx").on(table.workspaceId),
    check("agent_decision_status_not_draft", sql`${table.status} <> 'draft'`),
  ],
);

/** Many-to-many task links. A deleted task removes only the link, not the ADR. */
export const agentDecisionTaskTable = pgTable(
  "agent_decision_task",
  {
    decisionId: text("decision_id")
      .notNull()
      .references(() => agentDecisionTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
  },
  (table) => [
    primaryKey({
      name: "agent_decision_task_pk",
      columns: [table.decisionId, table.taskId],
    }),
    index("agent_decision_task_taskId_idx").on(table.taskId),
  ],
);

/** Separate counter so creating an ADR does not make agent-project settings look configured. */
export const agentDecisionCounterTable = pgTable("agent_decision_counter", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projectTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
  /** The number assigned to the next draft created in this project. */
  nextNumber: integer("next_number").notNull().default(1),
});

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
/* agent_domain — workspace domain knowledge                                  */
/* -------------------------------------------------------------------------- */

/**
 * One page of workspace-level domain knowledge, in a tree. Unlike a document
 * (a per-project deliverable) a domain page is where the meaning lives: what
 * the business calls things, how a flow actually works, which projects touch
 * it. Terms, documents and projects link TO a page (`domain_id` on
 * `agent_term`/`agent_document`, `agent_project_domain`), and the page view
 * aggregates them — the page never copies them.
 *
 * Tree shape: `parentId` NULL for a root page, `SET NULL` on parent delete so
 * an orphaned subtree is promoted to root rather than lost (the API refuses to
 * delete a page with children anyway, so this only matters for raw SQL).
 * Cycles are rejected at the application layer on move.
 *
 * Slug uniqueness is per level. Postgres treats NULLs as distinct in a UNIQUE
 * constraint, so the composite constraint alone would let two root pages share
 * a slug; the partial unique index covers the root level.
 *
 * Authorship follows the document rule: exactly one of `updatedBy` (human,
 * HTTP) or `actorId` (agent, MCP) is set per write. `createdAt`/`updatedAt`
 * are written by the app clock on every write.
 */
export const agentDomainTable = pgTable(
  "agent_domain",
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
    parentId: text("parent_id").references(
      (): AnyPgColumn => agentDomainTable.id,
      { onDelete: "set null", onUpdate: "cascade" },
    ),
    /** ^[a-z0-9][a-z0-9-]{0,63}$ — validated at the API layer; unique per level */
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    /** markdown, ≤ 200KB enforced in Zod */
    body: text("body").notNull().default(""),
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
    /** sibling order; ties broken by title */
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    unique("agent_domain_workspace_parent_slug_unique").on(
      table.workspaceId,
      table.parentId,
      table.slug,
    ),
    uniqueIndex("agent_domain_workspace_root_slug_unique")
      .on(table.workspaceId, table.slug)
      .where(sql`${table.parentId} IS NULL`),
    index("agent_domain_workspace_parent_idx").on(
      table.workspaceId,
      table.parentId,
    ),
  ],
);

/**
 * Which domain pages a project touches. Many-to-many with a composite key;
 * both sides cascade because the link has no meaning without either end. The
 * project side references `project` directly, not `agent_project`, so linking
 * never requires a settings row to exist.
 */
export const agentProjectDomainTable = pgTable(
  "agent_project_domain",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    domainId: text("domain_id")
      .notNull()
      .references(() => agentDomainTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
  },
  (table) => [
    primaryKey({
      name: "agent_project_domain_pk",
      columns: [table.projectId, table.domainId],
    }),
    index("agent_project_domain_domainId_idx").on(table.domainId),
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
 *
 * `confidence` is a gate, not a label: resolve answers with `confirmed` rows
 * only. Without that, a model reads back its own `proposed` guess in the next
 * session and treats it as settled fact — the lexicon would launder inference
 * into record.
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

    /**
     * confirmed | disputed. Terms apply on proposal (agent-autoapply), so
     * `proposed` is no longer written; a CHECK refuses it since 0014.
     */
    confidence: text("confidence").notNull().default("confirmed"),
    /** active | dormant | stale | retired(tombstone) */
    state: text("state").notNull().default("active"),
    /** tombstone pointer: "dead, look at this instead" */
    supersededBy: text("superseded_by"),

    ownerId: text("owner_id").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    /**
     * The model that proposed the term; NULL when a person did.
     *
     * NOT exclusive with `ownerId`, unlike the document/artifact authorship
     * rule: a proposal always happens on some human's authority, and the MCP
     * path records both — the person the session belongs to and the model that
     * actually wrote the words. Which model proposed a term is exactly what a
     * reviewer weighs it by, and the pair is unrecoverable once lost.
     */
    actorId: text("actor_id").references(() => agentActorTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    /** provenance: which ledger entry produced this */
    sourceEntryId: text("source_entry_id").references(
      () => agentEntryTable.id,
      { onDelete: "set null", onUpdate: "cascade" },
    ),
    /** the domain page this term belongs to (0007); NULL when unfiled */
    domainId: text("domain_id").references(() => agentDomainTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),

    /*
     * Review trail (0008). `confidence` says what was decided; these three say
     * who decided it, when, and — for a rejection — why.
     */
    /**
     * The person who reviewed it. Only ever a `user`: the MCP path cannot set
     * this, because review is a human act, and a model that could confirm its
     * own proposal is not a gate.
     */
    reviewerId: text("reviewer_id").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    reviewedAt: timestamp("reviewed_at", { mode: "date" }),
    /**
     * Why a `disputed` term was turned down. Kept so the next proposal of the
     * same word is answered with the reason rather than a bare conflict —
     * otherwise the same term is re-proposed every session.
     */
    rejectReason: text("reject_reason"),

    /*
     * Soft delete (0013, agent-autoapply). Terms used to be hard-deleted; now a
     * wrong auto-applied term is hidden and restorable, like `agent_entry`.
     * `reviewerId`/`reviewedAt` above remain the review marker.
     */
    deletedAt: timestamp("deleted_at", { mode: "date" }),
    deletedBy: text("deleted_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),

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
    index("agent_term_domainId_idx").on(table.domainId),
    check(
      "agent_term_confidence_not_proposed",
      sql`${table.confidence} <> 'proposed'`,
    ),
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
    /** the domain page this document is filed under (0007); NULL when unfiled */
    domainId: text("domain_id").references(() => agentDomainTable.id, {
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
    index("agent_document_domainId_idx").on(table.domainId),
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
/* agent_project — per-project settings                                        */
/* -------------------------------------------------------------------------- */

/**
 * Per-project Agent Layer settings. Keyed by the project itself: there is at
 * most one row, and no row at all means "defaults" — reads never create one.
 *
 * `corePaths` is the human-defined glob list that makes "core change" a
 * deterministic judgment (DESIGN.md §6.2): the server matches an entry's
 * `refs.files` against it at append time. Patterns are relative, `..`-free
 * and matched with picomatch; the defaults for the two limits are the ones
 * §6.1 names. `doneArchiveDays` is stored now but only read by the Phase 1c
 * archive job.
 *
 * `createdAt`/`updatedAt` are written explicitly by the upsert so both come
 * from the app clock, like the row's other values.
 */
export const agentProjectTable = pgTable(
  "agent_project",
  {
    projectId: text("project_id")
      .primaryKey()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    /** string[] of relative glob patterns, e.g. "src/domain/**" */
    corePaths: jsonb("core_paths").$type<string[]>().notNull().default([]),
    activeTaskThreshold: integer("active_task_threshold").notNull().default(20),
    doneArchiveDays: integer("done_archive_days").notNull().default(30),
    updatedBy: text("updated_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [index("agent_project_workspaceId_idx").on(table.workspaceId)],
);

/* -------------------------------------------------------------------------- */

export type AgentActor = typeof agentActorTable.$inferSelect;
export type NewAgentActor = typeof agentActorTable.$inferInsert;
export type AgentEntry = typeof agentEntryTable.$inferSelect;
export type NewAgentEntry = typeof agentEntryTable.$inferInsert;
export type AgentDecision = typeof agentDecisionTable.$inferSelect;
export type NewAgentDecision = typeof agentDecisionTable.$inferInsert;
export type AgentDecisionTask = typeof agentDecisionTaskTable.$inferSelect;
export type AgentDecisionCounter =
  typeof agentDecisionCounterTable.$inferSelect;
export type AgentLease = typeof agentLeaseTable.$inferSelect;
export type NewAgentLease = typeof agentLeaseTable.$inferInsert;
export type AgentTerm = typeof agentTermTable.$inferSelect;
export type NewAgentTerm = typeof agentTermTable.$inferInsert;
export type AgentDocument = typeof agentDocumentTable.$inferSelect;
export type NewAgentDocument = typeof agentDocumentTable.$inferInsert;
export type AgentArtifact = typeof agentArtifactTable.$inferSelect;
export type NewAgentArtifact = typeof agentArtifactTable.$inferInsert;
export type AgentProject = typeof agentProjectTable.$inferSelect;
export type NewAgentProject = typeof agentProjectTable.$inferInsert;
export type AgentDomain = typeof agentDomainTable.$inferSelect;
export type NewAgentDomain = typeof agentDomainTable.$inferInsert;
export type AgentProjectDomain = typeof agentProjectDomainTable.$inferSelect;

/* -------------------------------------------------------------------------- */
/* spec tabs — requirements · design · task links (KAN-19)                     */
/* -------------------------------------------------------------------------- */

/**
 * A requirement set is the project's spec for one feature: the human-approved
 * list of what to build, kept as rows (not free text) so a key survives edits
 * and tests can point at it. `feature` is the slug that binds requirements,
 * design and tasks together. `nextSeq` issues item keys; it never goes down,
 * so a dropped key is never reused.
 *
 * Approval is document-level and human-only (`approvedBy` is a user, there is
 * no actor column). `approvedAt` is kept when the set goes back to draft: the
 * stale computation compares downstream `approvedAt` against item `updatedAt`,
 * not against the set's status.
 */
export const agentRequirementSetTable = pgTable(
  "agent_requirement_set",
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
    /** ^[a-z0-9][a-z0-9-]{0,63}$ — validated at the API layer */
    feature: text("feature").notNull(),
    title: text("title").notNull(),
    /** markdown: background, scope, out-of-scope. Items are rows, not body. */
    body: text("body").notNull().default(""),
    /** `approved`; `draft` is refused by a CHECK since 0014 (agent-autoapply). */
    status: text("status").notNull().default("approved"),
    approvedAt: timestamp("approved_at", { mode: "date" }),
    approvedBy: text("approved_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    /** next item seq to issue; monotonic */
    nextSeq: integer("next_seq").notNull().default(1),
    /** the document slug this set was migrated from (REQ-SPEC-TABS-17), or NULL */
    sourceSlug: text("source_slug"),
    updatedBy: text("updated_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    actorId: text("actor_id").references(() => agentActorTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    /*
     * Review marker (0013, agent-autoapply). Writes apply immediately and stay
     * `approved`; `reviewedAt` NULL is the "unreviewed" flag a person clears.
     */
    reviewedAt: timestamp("reviewed_at", { mode: "date" }),
    reviewedBy: text("reviewed_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    /** Soft delete (0013), same shape as `agent_entry`. */
    deletedAt: timestamp("deleted_at", { mode: "date" }),
    deletedBy: text("deleted_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    /**
     * When the title, body or rows last changed, i.e. when the latest
     * `agent_spec_revision` was taken. The DB default only keeps older insert
     * paths valid.
     */
    revisedAt: timestamp("revised_at", { mode: "date" }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    unique("agent_requirement_set_project_feature_unique").on(
      table.projectId,
      table.feature,
    ),
    index("agent_requirement_set_project_idx").on(table.projectId),
    check(
      "agent_requirement_set_status_not_draft",
      sql`${table.status} <> 'draft'`,
    ),
  ],
);

/**
 * One requirement. `key` is `REQ-<FEATURE>-<seq>`, unique per project, and is
 * the string tests and commits cite. Rows are never deleted — status goes to
 * `dropped` — because a deleted key would orphan the tests that reference it.
 * `updatedAt` moves only when `text`, `status`, `layer` or `story` changes; it
 * is the upstream clock for the stale computation.
 */
export const agentRequirementItemTable = pgTable(
  "agent_requirement_item",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    setId: text("set_id")
      .notNull()
      .references(() => agentRequirementSetTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    key: text("key").notNull(),
    seq: integer("seq").notNull(),
    /** EARS sentence */
    text: text("text").notNull(),
    /** unit | api | e2e | free text */
    layer: text("layer"),
    /** active | deferred | dropped */
    status: text("status").notNull().default("active"),
    /** The `##` story heading the criterion sits under in the document (feature-hub); null = 기타 */
    story: text("story"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    unique("agent_requirement_item_project_key_unique").on(
      table.projectId,
      table.key,
    ),
    index("agent_requirement_item_set_idx").on(table.setId),
  ],
);

/** The design for one feature. One per (project, feature); split the feature if two are needed. */
export const agentDesignTable = pgTable(
  "agent_design",
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
    feature: text("feature").notNull(),
    title: text("title").notNull(),
    /** markdown, ≤ 200KB enforced in Zod */
    body: text("body").notNull(),
    /** `approved`; `draft` is refused by a CHECK since 0014 (agent-autoapply). */
    status: text("status").notNull().default("approved"),
    approvedAt: timestamp("approved_at", { mode: "date" }),
    approvedBy: text("approved_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    sourceSlug: text("source_slug"),
    updatedBy: text("updated_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    actorId: text("actor_id").references(() => agentActorTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    /** Review marker (0013), same semantics as `agent_requirement_set`. */
    reviewedAt: timestamp("reviewed_at", { mode: "date" }),
    reviewedBy: text("reviewed_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    /** Soft delete (0013), same shape as `agent_entry`. */
    deletedAt: timestamp("deleted_at", { mode: "date" }),
    deletedBy: text("deleted_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    /** See `agent_requirement_set.revisedAt`. */
    revisedAt: timestamp("revised_at", { mode: "date" }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    unique("agent_design_project_feature_unique").on(
      table.projectId,
      table.feature,
    ),
    index("agent_design_project_idx").on(table.projectId),
    check("agent_design_status_not_draft", sql`${table.status} <> 'draft'`),
  ],
);

/** Which requirement items a design covers. Structure, not history: stale is computed from timestamps. */
export const agentDesignRequirementTable = pgTable(
  "agent_design_requirement",
  {
    designId: text("design_id")
      .notNull()
      .references(() => agentDesignTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    itemId: text("item_id")
      .notNull()
      .references(() => agentRequirementItemTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.designId, table.itemId] }),
    index("agent_design_requirement_item_idx").on(table.itemId),
  ],
);

/**
 * task ↔ requirement item. `acknowledgedAt` is the task side's clock: a human
 * pressing "확인" after an upstream change sets it, which clears the stale flag
 * without touching the upstream row or the task itself.
 */
export const agentTaskRequirementTable = pgTable(
  "agent_task_requirement",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    itemId: text("item_id")
      .notNull()
      .references(() => agentRequirementItemTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { mode: "date" }),
    /**
     * The agent that acknowledged (0013, agent-autoapply); NULL for a person.
     * `reviewedAt` NULL marks an acknowledgement no person has reviewed yet.
     */
    acknowledgedActorId: text("acknowledged_actor_id").references(
      () => agentActorTable.id,
      { onDelete: "set null", onUpdate: "cascade" },
    ),
    reviewedAt: timestamp("reviewed_at", { mode: "date" }),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.itemId] }),
    index("agent_task_requirement_item_idx").on(table.itemId),
  ],
);

/** task ↔ design. Same acknowledgement semantics as agent_task_requirement. */
export const agentTaskDesignTable = pgTable(
  "agent_task_design",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => taskTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    designId: text("design_id")
      .notNull()
      .references(() => agentDesignTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { mode: "date" }),
    /** See `agent_task_requirement.acknowledgedActorId` (0013). */
    acknowledgedActorId: text("acknowledged_actor_id").references(
      () => agentActorTable.id,
      { onDelete: "set null", onUpdate: "cascade" },
    ),
    reviewedAt: timestamp("reviewed_at", { mode: "date" }),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.designId] }),
    index("agent_task_design_design_idx").on(table.designId),
  ],
);

/**
 * spec-check's report: which test files cite which requirement key. Stored
 * per (item, repo, path); whether the test passes is not recorded here —
 * that is the test runner's job.
 */
export const agentRequirementCoverageTable = pgTable(
  "agent_requirement_coverage",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => agentRequirementItemTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    /** e.g. "doominkim/sandbox" */
    repo: text("repo").notNull(),
    /** repo-relative test file path */
    testPath: text("test_path").notNull(),
    testName: text("test_name"),
    actorId: text("actor_id").references(() => agentActorTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    reportedAt: timestamp("reported_at", { mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("agent_requirement_coverage_item_repo_path_unique").on(
      table.itemId,
      table.repo,
      table.testPath,
    ),
    index("agent_requirement_coverage_item_idx").on(table.itemId),
  ],
);

/** One requirement row as a revision stores it (0014). */
export type SpecRevisionItem = {
  key: string;
  text: string;
  layer: string | null;
  story: string | null;
  status: string;
};

/**
 * A stored copy of a requirement set's or design's content (0013,
 * agent-autoapply). Agent writes apply immediately, so a revision is what a
 * person restores a document from after a wrong write. Rows are only
 * appended; a restore writes a new revision and records its source in
 * `revertedFromId`.
 *
 * Exactly one of `setId`/`designId` is set, enforced by a CHECK because the
 * two targets share every other column. `requirementKeys` is filled on design
 * revisions only: it is the design's requirement-link list at that moment,
 * as keys because keys are what the design API accepts. `items` (0014) is
 * filled on requirement revisions only: every row of the set in `seq` order,
 * because a set's criteria can change without its body changing. It is NULL
 * on requirement revisions older than 0014 that the backfill did not reach.
 *
 * Authorship follows the document rule: `createdBy` (human) or `actorId`
 * (agent), both SET NULL so a revision outlives either author.
 */
export const agentSpecRevisionTable = pgTable(
  "agent_spec_revision",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projectTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    setId: text("set_id").references(() => agentRequirementSetTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    designId: text("design_id").references(() => agentDesignTable.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** string[] of requirement item keys; design revisions only */
    requirementKeys: jsonb("requirement_keys").$type<string[]>(),
    /** SpecRevisionItem[] in seq order; requirement revisions only (0014) */
    items: jsonb("items").$type<SpecRevisionItem[]>(),
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    actorId: text("actor_id").references(() => agentActorTable.id, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    revertedFromId: text("reverted_from_id").references(
      (): AnyPgColumn => agentSpecRevisionTable.id,
      { onDelete: "set null", onUpdate: "cascade" },
    ),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "agent_spec_revision_one_target",
      sql`(${table.setId} IS NULL) <> (${table.designId} IS NULL)`,
    ),
    index("agent_spec_revision_set_created_at_idx").on(
      table.setId,
      table.createdAt.desc(),
    ),
    index("agent_spec_revision_design_created_at_idx").on(
      table.designId,
      table.createdAt.desc(),
    ),
  ],
);
