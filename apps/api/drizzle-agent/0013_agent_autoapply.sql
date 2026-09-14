CREATE TABLE "agent_spec_revision" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"set_id" text,
	"design_id" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"requirement_keys" jsonb,
	"created_by" text,
	"actor_id" text,
	"reverted_from_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_spec_revision_one_target" CHECK (("agent_spec_revision"."set_id" IS NULL) <> ("agent_spec_revision"."design_id" IS NULL))
);
--> statement-breakpoint
DROP INDEX "agent_decision_supersedes_unique";--> statement-breakpoint
ALTER TABLE "agent_decision" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent_decision" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "agent_decision" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent_decision" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "agent_design" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent_design" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "agent_design" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent_design" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "agent_design" ADD COLUMN "revised_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_requirement_set" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent_requirement_set" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "agent_requirement_set" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent_requirement_set" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "agent_requirement_set" ADD COLUMN "revised_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_task_design" ADD COLUMN "acknowledged_actor_id" text;--> statement-breakpoint
ALTER TABLE "agent_task_design" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent_task_requirement" ADD COLUMN "acknowledged_actor_id" text;--> statement-breakpoint
ALTER TABLE "agent_task_requirement" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent_term" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent_term" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "agent_spec_revision" ADD CONSTRAINT "agent_spec_revision_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_spec_revision" ADD CONSTRAINT "agent_spec_revision_set_id_agent_requirement_set_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."agent_requirement_set"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_spec_revision" ADD CONSTRAINT "agent_spec_revision_design_id_agent_design_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."agent_design"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_spec_revision" ADD CONSTRAINT "agent_spec_revision_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_spec_revision" ADD CONSTRAINT "agent_spec_revision_actor_id_agent_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."agent_actor"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_spec_revision" ADD CONSTRAINT "agent_spec_revision_reverted_from_id_agent_spec_revision_id_fk" FOREIGN KEY ("reverted_from_id") REFERENCES "public"."agent_spec_revision"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "agent_spec_revision_set_created_at_idx" ON "agent_spec_revision" USING btree ("set_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_spec_revision_design_created_at_idx" ON "agent_spec_revision" USING btree ("design_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "agent_decision" ADD CONSTRAINT "agent_decision_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_decision" ADD CONSTRAINT "agent_decision_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_design" ADD CONSTRAINT "agent_design_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_design" ADD CONSTRAINT "agent_design_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_requirement_set" ADD CONSTRAINT "agent_requirement_set_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_requirement_set" ADD CONSTRAINT "agent_requirement_set_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_task_design" ADD CONSTRAINT "agent_task_design_acknowledged_actor_id_agent_actor_id_fk" FOREIGN KEY ("acknowledged_actor_id") REFERENCES "public"."agent_actor"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_task_requirement" ADD CONSTRAINT "agent_task_requirement_acknowledged_actor_id_agent_actor_id_fk" FOREIGN KEY ("acknowledged_actor_id") REFERENCES "public"."agent_actor"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_term" ADD CONSTRAINT "agent_term_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_decision_supersedes_unique" ON "agent_decision" USING btree ("supersedes_decision_id") WHERE "agent_decision"."supersedes_decision_id" IS NOT NULL AND "agent_decision"."deleted_at" IS NULL;--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Data conversion (agent-autoapply, decided 2026-09-14). Hand-written below the
-- generated DDL; the migrator runs the whole file in one transaction.
--
-- Agent Layer writes now take effect immediately. Rows that were waiting in
-- `draft`/`proposed` for a person are switched on, and `reviewed_at IS NULL`
-- becomes the "unreviewed" marker that replaces the approval gate. This
-- deliberately reverses 0008's "promote nothing": promoted rows stay flagged
-- as unreviewed instead of being passed off as reviewed record.
--
-- Order matters inside each table: rows that were already approved/accepted
-- are marked reviewed BEFORE drafts are switched on, otherwise the review
-- backfill would also mark the converted drafts as reviewed.
--
-- `revised_at` was added with DEFAULT now() NOT NULL, which fills existing rows
-- with the migration time; it is overwritten with `updated_at` here.
UPDATE "agent_requirement_set" SET "revised_at" = "updated_at";--> statement-breakpoint
UPDATE "agent_requirement_set" SET "reviewed_at" = "approved_at", "reviewed_by" = "approved_by" WHERE "status" = 'approved';--> statement-breakpoint
UPDATE "agent_requirement_set" SET "status" = 'approved', "approved_at" = "updated_at", "reviewed_at" = NULL, "reviewed_by" = NULL WHERE "status" = 'draft';--> statement-breakpoint
UPDATE "agent_design" SET "revised_at" = "updated_at";--> statement-breakpoint
UPDATE "agent_design" SET "reviewed_at" = "approved_at", "reviewed_by" = "approved_by" WHERE "status" = 'approved';--> statement-breakpoint
UPDATE "agent_design" SET "status" = 'approved', "approved_at" = "updated_at", "reviewed_at" = NULL, "reviewed_by" = NULL WHERE "status" = 'draft';--> statement-breakpoint
-- ADR numbers are kept. A draft never carries `supersedes_decision_id` (the
-- accept path sets it), so accepting drafts here cannot collide with
-- agent_decision_supersedes_unique.
UPDATE "agent_decision" SET "reviewed_at" = "accepted_at", "reviewed_by" = "accepted_by" WHERE "status" IN ('accepted', 'superseded');--> statement-breakpoint
UPDATE "agent_decision" SET "status" = 'accepted', "accepted_at" = "updated_at", "reviewed_at" = NULL, "reviewed_by" = NULL WHERE "status" = 'draft';--> statement-breakpoint
-- Terms keep reviewer_id/reviewed_at as the marker. A confirmed term from
-- before 0008 has no reviewed_at; its last update is the closest review time.
-- Disputed terms are not touched.
UPDATE "agent_term" SET "reviewed_at" = "updated_at" WHERE "confidence" = 'confirmed' AND "reviewed_at" IS NULL;--> statement-breakpoint
UPDATE "agent_term" SET "confidence" = 'confirmed', "reviewed_at" = NULL WHERE "confidence" = 'proposed';--> statement-breakpoint
-- Task links: the existing acknowledgement doubles as the review.
UPDATE "agent_task_requirement" SET "reviewed_at" = "acknowledged_at" WHERE "acknowledged_at" IS NOT NULL;--> statement-breakpoint
UPDATE "agent_task_design" SET "reviewed_at" = "acknowledged_at" WHERE "acknowledged_at" IS NOT NULL;--> statement-breakpoint
-- One baseline revision per existing set and design with its current content
-- and last author. Ids are UUID text here (the app issues cuids); both are
-- opaque. gen_random_uuid() is core since PostgreSQL 13 and upstream 0004
-- already relies on it. Design keys follow item seq, as the design API lists them.
INSERT INTO "agent_spec_revision" ("id", "project_id", "set_id", "design_id", "title", "body", "requirement_keys", "created_by", "actor_id", "reverted_from_id", "created_at")
SELECT gen_random_uuid()::text, s."project_id", s."id", NULL, s."title", s."body", NULL, s."updated_by", s."actor_id", NULL, s."updated_at"
FROM "agent_requirement_set" s;--> statement-breakpoint
INSERT INTO "agent_spec_revision" ("id", "project_id", "set_id", "design_id", "title", "body", "requirement_keys", "created_by", "actor_id", "reverted_from_id", "created_at")
SELECT gen_random_uuid()::text, d."project_id", NULL, d."id", d."title", d."body",
  COALESCE(
    (SELECT jsonb_agg(i."key" ORDER BY i."seq", i."key")
       FROM "agent_design_requirement" dr
       JOIN "agent_requirement_item" i ON i."id" = dr."item_id"
      WHERE dr."design_id" = d."id"),
    '[]'::jsonb
  ),
  d."updated_by", d."actor_id", NULL, d."updated_at"
FROM "agent_design" d;