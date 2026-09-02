CREATE TABLE "agent_document" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"task_id" text,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"updated_by" text,
	"actor_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_document_project_slug_unique" UNIQUE("project_id","slug")
);
--> statement-breakpoint
ALTER TABLE "agent_entry" ADD COLUMN "effort" text;--> statement-breakpoint
ALTER TABLE "agent_entry" ADD COLUMN "agent_label" text;--> statement-breakpoint
ALTER TABLE "agent_entry" ADD COLUMN "usage" jsonb;--> statement-breakpoint
ALTER TABLE "agent_document" ADD CONSTRAINT "agent_document_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_document" ADD CONSTRAINT "agent_document_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_document" ADD CONSTRAINT "agent_document_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_document" ADD CONSTRAINT "agent_document_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_document" ADD CONSTRAINT "agent_document_actor_id_agent_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."agent_actor"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "agent_document_project_task_idx" ON "agent_document" USING btree ("project_id","task_id");--> statement-breakpoint
CREATE INDEX "agent_document_workspaceId_idx" ON "agent_document" USING btree ("workspace_id");