CREATE TABLE "agent_decision_counter" (
	"project_id" text PRIMARY KEY NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_decision" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"context" text NOT NULL,
	"decision" text NOT NULL,
	"alternatives" text,
	"consequences" text,
	"source_note" text,
	"reversible" boolean,
	"status" text DEFAULT 'draft' NOT NULL,
	"refs" jsonb,
	"source_entry_id" text,
	"supersedes_decision_id" text,
	"created_by" text,
	"created_actor_id" text,
	"updated_by" text,
	"updated_actor_id" text,
	"accepted_by" text,
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_decision_project_number_unique" UNIQUE("project_id","number")
);
--> statement-breakpoint
CREATE TABLE "agent_decision_task" (
	"decision_id" text NOT NULL,
	"task_id" text NOT NULL,
	CONSTRAINT "agent_decision_task_pk" PRIMARY KEY("decision_id","task_id")
);
--> statement-breakpoint
ALTER TABLE "agent_decision_counter" ADD CONSTRAINT "agent_decision_counter_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_decision" ADD CONSTRAINT "agent_decision_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_decision" ADD CONSTRAINT "agent_decision_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_decision" ADD CONSTRAINT "agent_decision_source_entry_id_agent_entry_id_fk" FOREIGN KEY ("source_entry_id") REFERENCES "public"."agent_entry"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_decision" ADD CONSTRAINT "agent_decision_supersedes_decision_id_agent_decision_id_fk" FOREIGN KEY ("supersedes_decision_id") REFERENCES "public"."agent_decision"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_decision" ADD CONSTRAINT "agent_decision_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_decision" ADD CONSTRAINT "agent_decision_created_actor_id_agent_actor_id_fk" FOREIGN KEY ("created_actor_id") REFERENCES "public"."agent_actor"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_decision" ADD CONSTRAINT "agent_decision_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_decision" ADD CONSTRAINT "agent_decision_updated_actor_id_agent_actor_id_fk" FOREIGN KEY ("updated_actor_id") REFERENCES "public"."agent_actor"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_decision" ADD CONSTRAINT "agent_decision_accepted_by_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_decision_task" ADD CONSTRAINT "agent_decision_task_decision_id_agent_decision_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."agent_decision"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_decision_task" ADD CONSTRAINT "agent_decision_task_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_decision_source_entry_unique" ON "agent_decision" USING btree ("source_entry_id") WHERE "agent_decision"."source_entry_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_decision_supersedes_unique" ON "agent_decision" USING btree ("supersedes_decision_id") WHERE "agent_decision"."supersedes_decision_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_decision_project_status_number_idx" ON "agent_decision" USING btree ("project_id","status","number");--> statement-breakpoint
CREATE INDEX "agent_decision_workspaceId_idx" ON "agent_decision" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agent_decision_task_taskId_idx" ON "agent_decision_task" USING btree ("task_id");