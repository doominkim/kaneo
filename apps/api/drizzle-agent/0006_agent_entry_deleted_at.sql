ALTER TABLE "agent_entry" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent_entry" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "agent_entry" ADD CONSTRAINT "agent_entry_deleted_by_user_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;