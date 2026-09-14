ALTER TABLE "agent_decision" ALTER COLUMN "status" SET DEFAULT 'accepted';--> statement-breakpoint
ALTER TABLE "agent_design" ALTER COLUMN "status" SET DEFAULT 'approved';--> statement-breakpoint
ALTER TABLE "agent_requirement_set" ALTER COLUMN "status" SET DEFAULT 'approved';--> statement-breakpoint
ALTER TABLE "agent_term" ALTER COLUMN "confidence" SET DEFAULT 'confirmed';--> statement-breakpoint
ALTER TABLE "agent_spec_revision" ADD COLUMN "items" jsonb;--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Hand-written below the generated DDL (agent-autoapply integrity pass). The
-- migrator runs the whole file in one transaction, so a refusal below leaves
-- the database exactly as it was before 0014.
--
-- 1. Legacy writers. 0013 converted the rows that existed then, but an insert
--    that relied on the old column defaults (`draft`, `proposed`) could still
--    create a row the application no longer understands. The defaults above
--    now match what the application writes, the remaining rows are converted
--    with 0013's rules, and CHECK constraints at the end refuse the old values
--    for good. The CHECKs are added last: adding them first would fail on the
--    very rows this migration converts.
--
-- A draft ADR never carried `supersedes_decision_id` (only the old accept path
-- set it). One that does is an invariant violation: accepting it here would
-- leave two accepted ADRs in one supersede chain. Refuse instead of guessing.
DO $$
DECLARE
  offending text;
BEGIN
  SELECT string_agg("id", ', ' ORDER BY "id") INTO offending
    FROM "agent_decision"
   WHERE "status" = 'draft' AND "supersedes_decision_id" IS NOT NULL;
  IF offending IS NOT NULL THEN
    RAISE EXCEPTION 'agent migration 0014 refused: draft ADR(s) % carry supersedes_decision_id; accepting them would leave two accepted ADRs in one supersede chain', offending
      USING HINT = 'Resolve each listed ADR by hand (delete it, or clear supersedes_decision_id after checking its chain), then rerun the migration.';
  END IF;
END $$;--> statement-breakpoint
UPDATE "agent_requirement_set" SET "status" = 'approved', "approved_at" = "updated_at", "reviewed_at" = NULL, "reviewed_by" = NULL WHERE "status" = 'draft';--> statement-breakpoint
UPDATE "agent_design" SET "status" = 'approved', "approved_at" = "updated_at", "reviewed_at" = NULL, "reviewed_by" = NULL WHERE "status" = 'draft';--> statement-breakpoint
UPDATE "agent_decision" SET "status" = 'accepted', "accepted_at" = "updated_at", "reviewed_at" = NULL, "reviewed_by" = NULL WHERE "status" = 'draft';--> statement-breakpoint
UPDATE "agent_term" SET "confidence" = 'confirmed', "reviewed_at" = NULL WHERE "confidence" = 'proposed';--> statement-breakpoint
-- A set or design a legacy writer created after 0013 has no revision to be
-- restored from; give it the same baseline 0013 gave every document then.
-- Documents that already have a revision are left alone, so rerunning this
-- block changes nothing.
INSERT INTO "agent_spec_revision" ("id", "project_id", "set_id", "design_id", "title", "body", "requirement_keys", "items", "created_by", "actor_id", "reverted_from_id", "created_at")
SELECT gen_random_uuid()::text, s."project_id", s."id", NULL, s."title", s."body", NULL, NULL, s."updated_by", s."actor_id", NULL, s."updated_at"
FROM "agent_requirement_set" s
WHERE NOT EXISTS (SELECT 1 FROM "agent_spec_revision" r WHERE r."set_id" = s."id");--> statement-breakpoint
INSERT INTO "agent_spec_revision" ("id", "project_id", "set_id", "design_id", "title", "body", "requirement_keys", "items", "created_by", "actor_id", "reverted_from_id", "created_at")
SELECT gen_random_uuid()::text, d."project_id", NULL, d."id", d."title", d."body",
  COALESCE(
    (SELECT jsonb_agg(i."key" ORDER BY i."seq", i."key")
       FROM "agent_design_requirement" dr
       JOIN "agent_requirement_item" i ON i."id" = dr."item_id"
      WHERE dr."design_id" = d."id"),
    '[]'::jsonb
  ),
  NULL, d."updated_by", d."actor_id", NULL, d."updated_at"
FROM "agent_design" d
WHERE NOT EXISTS (SELECT 1 FROM "agent_spec_revision" r WHERE r."design_id" = d."id");--> statement-breakpoint
-- 2. Item snapshots. A requirement revision now also stores the set's rows,
--    so a save that only changes criteria is revertible. The newest revision
--    of each set describes the content stored right now, so it takes the
--    current rows; in a database where 0013 and 0014 run together that is
--    exactly 0013's baseline. Older revisions keep `items` NULL: their rows
--    were never recorded, and inventing them from today's rows would make a
--    revert restore the wrong criteria.
UPDATE "agent_spec_revision" r
   SET "items" = COALESCE(
     (SELECT jsonb_agg(
               jsonb_build_object(
                 'key', i."key",
                 'text', i."text",
                 'layer', i."layer",
                 'story', i."story",
                 'status', i."status"
               )
               ORDER BY i."seq", i."key"
             )
        FROM "agent_requirement_item" i
       WHERE i."set_id" = r."set_id"),
     '[]'::jsonb
   )
 WHERE r."set_id" IS NOT NULL
   AND r."items" IS NULL
   AND r."id" = (
     SELECT latest."id"
       FROM "agent_spec_revision" latest
      WHERE latest."set_id" = r."set_id"
      ORDER BY latest."created_at" DESC, latest."id" DESC
      LIMIT 1
   );--> statement-breakpoint
ALTER TABLE "agent_decision" ADD CONSTRAINT "agent_decision_status_not_draft" CHECK ("agent_decision"."status" <> 'draft');--> statement-breakpoint
ALTER TABLE "agent_design" ADD CONSTRAINT "agent_design_status_not_draft" CHECK ("agent_design"."status" <> 'draft');--> statement-breakpoint
ALTER TABLE "agent_requirement_set" ADD CONSTRAINT "agent_requirement_set_status_not_draft" CHECK ("agent_requirement_set"."status" <> 'draft');--> statement-breakpoint
ALTER TABLE "agent_term" ADD CONSTRAINT "agent_term_confidence_not_proposed" CHECK ("agent_term"."confidence" <> 'proposed');
