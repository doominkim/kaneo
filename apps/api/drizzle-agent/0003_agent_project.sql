CREATE TABLE "agent_project" (
	"project_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"core_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active_task_threshold" integer DEFAULT 20 NOT NULL,
	"done_archive_days" integer DEFAULT 30 NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_project" ADD CONSTRAINT "agent_project_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_project" ADD CONSTRAINT "agent_project_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_project" ADD CONSTRAINT "agent_project_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "agent_project_workspaceId_idx" ON "agent_project" USING btree ("workspace_id");