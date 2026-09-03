ALTER TABLE "agent_entry" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "agent_entry" ADD CONSTRAINT "agent_entry_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "agent_entry_createdBy_idx" ON "agent_entry" USING btree ("created_by");