ALTER TABLE "agent_term" ADD COLUMN "reviewer_id" text;--> statement-breakpoint
ALTER TABLE "agent_term" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent_term" ADD COLUMN "reject_reason" text;--> statement-breakpoint
ALTER TABLE "agent_term" ADD CONSTRAINT "agent_term_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;
-- No backfill. Every existing row keeps the confidence it already has.
--
-- The obvious backfill — promote `actor_id IS NULL` as "a person entered this"
-- — is wrong here. The MCP propose tool shipped 2026-09-01, but the HTTP body
-- schema did not accept `provider`/`model` until 2026-09-03, so for that window
-- Zod dropped them and model proposals landed with `actor_id` NULL. They are
-- indistinguishable from human rows at the column level, and promoting them
-- would launder unreviewed inference into confirmed record in one irreversible
-- statement — precisely what this gate exists to stop.
--
-- So nothing is promoted. Existing `proposed` terms become the initial review
-- queue and a person confirms each one. An empty answer is honest; a confident
-- wrong one is not.
