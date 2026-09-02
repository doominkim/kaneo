CREATE TABLE "agent_artifact" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"task_id" text,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by" text,
	"actor_id" text,
	"finalized_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_artifact_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "agent_artifact" ADD CONSTRAINT "agent_artifact_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_artifact" ADD CONSTRAINT "agent_artifact_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_artifact" ADD CONSTRAINT "agent_artifact_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_artifact" ADD CONSTRAINT "agent_artifact_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_artifact" ADD CONSTRAINT "agent_artifact_actor_id_agent_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."agent_actor"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "agent_artifact_project_task_idx" ON "agent_artifact" USING btree ("project_id","task_id");--> statement-breakpoint
CREATE INDEX "agent_artifact_workspaceId_idx" ON "agent_artifact" USING btree ("workspace_id");