CREATE TABLE "agent_actor" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"on_behalf_of" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"label" text,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_actor_workspace_user_model_unique" UNIQUE("workspace_id","on_behalf_of","model")
);
--> statement-breakpoint
CREATE TABLE "agent_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"task_id" text,
	"actor_id" text,
	"session_id" text,
	"kind" text DEFAULT 'work' NOT NULL,
	"summary" text NOT NULL,
	"body" text,
	"decision" jsonb,
	"refs" jsonb,
	"core_changed" jsonb,
	"compaction" text DEFAULT 'full' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_lease" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"task_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"session_id" text NOT NULL,
	"acquired_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "agent_lease_task_unique" UNIQUE("task_id")
);
--> statement-breakpoint
CREATE TABLE "agent_term" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"canonical" text NOT NULL,
	"definition" text,
	"aliases" jsonb,
	"not_to_confuse_with" jsonb,
	"anchors" jsonb,
	"confidence" text DEFAULT 'proposed' NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"superseded_by" text,
	"owner_id" text,
	"source_entry_id" text,
	"last_verified_at" timestamp,
	"last_accessed_at" timestamp,
	"access_count" integer DEFAULT 0 NOT NULL,
	"stability" integer DEFAULT 50 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_term_workspace_canonical_unique" UNIQUE("workspace_id","canonical")
);
--> statement-breakpoint
ALTER TABLE "agent_actor" ADD CONSTRAINT "agent_actor_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_actor" ADD CONSTRAINT "agent_actor_on_behalf_of_user_id_fk" FOREIGN KEY ("on_behalf_of") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_entry" ADD CONSTRAINT "agent_entry_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_entry" ADD CONSTRAINT "agent_entry_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_entry" ADD CONSTRAINT "agent_entry_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_entry" ADD CONSTRAINT "agent_entry_actor_id_agent_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."agent_actor"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_lease" ADD CONSTRAINT "agent_lease_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_lease" ADD CONSTRAINT "agent_lease_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_lease" ADD CONSTRAINT "agent_lease_actor_id_agent_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."agent_actor"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_term" ADD CONSTRAINT "agent_term_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_term" ADD CONSTRAINT "agent_term_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_term" ADD CONSTRAINT "agent_term_source_entry_id_agent_entry_id_fk" FOREIGN KEY ("source_entry_id") REFERENCES "public"."agent_entry"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "agent_actor_workspaceId_idx" ON "agent_actor" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agent_actor_onBehalfOf_idx" ON "agent_actor" USING btree ("on_behalf_of");--> statement-breakpoint
CREATE INDEX "agent_entry_project_createdAt_idx" ON "agent_entry" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_entry_taskId_idx" ON "agent_entry" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "agent_entry_actorId_idx" ON "agent_entry" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "agent_entry_workspaceId_idx" ON "agent_entry" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agent_entry_compaction_idx" ON "agent_entry" USING btree ("compaction");--> statement-breakpoint
CREATE INDEX "agent_lease_expiresAt_idx" ON "agent_lease" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "agent_lease_workspaceId_idx" ON "agent_lease" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agent_term_workspaceId_idx" ON "agent_term" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agent_term_state_idx" ON "agent_term" USING btree ("state");--> statement-breakpoint
CREATE INDEX "agent_term_confidence_idx" ON "agent_term" USING btree ("confidence");