CREATE TABLE "agent_design_requirement" (
	"design_id" text NOT NULL,
	"item_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_design_requirement_design_id_item_id_pk" PRIMARY KEY("design_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "agent_design" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"feature" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_at" timestamp,
	"approved_by" text,
	"source_slug" text,
	"updated_by" text,
	"actor_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_design_project_feature_unique" UNIQUE("project_id","feature")
);
--> statement-breakpoint
CREATE TABLE "agent_requirement_coverage" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"repo" text NOT NULL,
	"test_path" text NOT NULL,
	"test_name" text,
	"actor_id" text,
	"reported_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_requirement_coverage_item_repo_path_unique" UNIQUE("item_id","repo","test_path")
);
--> statement-breakpoint
CREATE TABLE "agent_requirement_item" (
	"id" text PRIMARY KEY NOT NULL,
	"set_id" text NOT NULL,
	"project_id" text NOT NULL,
	"key" text NOT NULL,
	"seq" integer NOT NULL,
	"text" text NOT NULL,
	"layer" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_requirement_item_project_key_unique" UNIQUE("project_id","key")
);
--> statement-breakpoint
CREATE TABLE "agent_requirement_set" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"feature" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"approved_at" timestamp,
	"approved_by" text,
	"next_seq" integer DEFAULT 1 NOT NULL,
	"source_slug" text,
	"updated_by" text,
	"actor_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_requirement_set_project_feature_unique" UNIQUE("project_id","feature")
);
--> statement-breakpoint
CREATE TABLE "agent_task_design" (
	"task_id" text NOT NULL,
	"design_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp,
	CONSTRAINT "agent_task_design_task_id_design_id_pk" PRIMARY KEY("task_id","design_id")
);
--> statement-breakpoint
CREATE TABLE "agent_task_requirement" (
	"task_id" text NOT NULL,
	"item_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp,
	CONSTRAINT "agent_task_requirement_task_id_item_id_pk" PRIMARY KEY("task_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "agent_design_requirement" ADD CONSTRAINT "agent_design_requirement_design_id_agent_design_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."agent_design"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_design_requirement" ADD CONSTRAINT "agent_design_requirement_item_id_agent_requirement_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."agent_requirement_item"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_design" ADD CONSTRAINT "agent_design_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_design" ADD CONSTRAINT "agent_design_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_design" ADD CONSTRAINT "agent_design_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_design" ADD CONSTRAINT "agent_design_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_design" ADD CONSTRAINT "agent_design_actor_id_agent_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."agent_actor"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_requirement_coverage" ADD CONSTRAINT "agent_requirement_coverage_item_id_agent_requirement_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."agent_requirement_item"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_requirement_coverage" ADD CONSTRAINT "agent_requirement_coverage_actor_id_agent_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."agent_actor"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_requirement_item" ADD CONSTRAINT "agent_requirement_item_set_id_agent_requirement_set_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."agent_requirement_set"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_requirement_item" ADD CONSTRAINT "agent_requirement_item_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_requirement_set" ADD CONSTRAINT "agent_requirement_set_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_requirement_set" ADD CONSTRAINT "agent_requirement_set_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_requirement_set" ADD CONSTRAINT "agent_requirement_set_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_requirement_set" ADD CONSTRAINT "agent_requirement_set_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_requirement_set" ADD CONSTRAINT "agent_requirement_set_actor_id_agent_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."agent_actor"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_task_design" ADD CONSTRAINT "agent_task_design_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_task_design" ADD CONSTRAINT "agent_task_design_design_id_agent_design_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."agent_design"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_task_requirement" ADD CONSTRAINT "agent_task_requirement_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_task_requirement" ADD CONSTRAINT "agent_task_requirement_item_id_agent_requirement_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."agent_requirement_item"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "agent_design_requirement_item_idx" ON "agent_design_requirement" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "agent_design_project_idx" ON "agent_design" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "agent_requirement_coverage_item_idx" ON "agent_requirement_coverage" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "agent_requirement_item_set_idx" ON "agent_requirement_item" USING btree ("set_id");--> statement-breakpoint
CREATE INDEX "agent_requirement_set_project_idx" ON "agent_requirement_set" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "agent_task_design_design_idx" ON "agent_task_design" USING btree ("design_id");--> statement-breakpoint
CREATE INDEX "agent_task_requirement_item_idx" ON "agent_task_requirement" USING btree ("item_id");