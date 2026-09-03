CREATE TABLE "agent_domain" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"parent_id" text,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"updated_by" text,
	"actor_id" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "agent_domain_workspace_parent_slug_unique" UNIQUE("workspace_id","parent_id","slug")
);
--> statement-breakpoint
CREATE TABLE "agent_project_domain" (
	"project_id" text NOT NULL,
	"domain_id" text NOT NULL,
	CONSTRAINT "agent_project_domain_pk" PRIMARY KEY("project_id","domain_id")
);
--> statement-breakpoint
ALTER TABLE "agent_document" ADD COLUMN "domain_id" text;--> statement-breakpoint
ALTER TABLE "agent_term" ADD COLUMN "domain_id" text;--> statement-breakpoint
ALTER TABLE "agent_domain" ADD CONSTRAINT "agent_domain_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_domain" ADD CONSTRAINT "agent_domain_parent_id_agent_domain_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."agent_domain"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_domain" ADD CONSTRAINT "agent_domain_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_domain" ADD CONSTRAINT "agent_domain_actor_id_agent_actor_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."agent_actor"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_project_domain" ADD CONSTRAINT "agent_project_domain_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_project_domain" ADD CONSTRAINT "agent_project_domain_domain_id_agent_domain_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."agent_domain"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_domain_workspace_root_slug_unique" ON "agent_domain" USING btree ("workspace_id","slug") WHERE "agent_domain"."parent_id" IS NULL;--> statement-breakpoint
CREATE INDEX "agent_domain_workspace_parent_idx" ON "agent_domain" USING btree ("workspace_id","parent_id");--> statement-breakpoint
CREATE INDEX "agent_project_domain_domainId_idx" ON "agent_project_domain" USING btree ("domain_id");--> statement-breakpoint
ALTER TABLE "agent_document" ADD CONSTRAINT "agent_document_domain_id_agent_domain_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."agent_domain"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "agent_term" ADD CONSTRAINT "agent_term_domain_id_agent_domain_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."agent_domain"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "agent_document_domainId_idx" ON "agent_document" USING btree ("domain_id");--> statement-breakpoint
CREATE INDEX "agent_term_domainId_idx" ON "agent_term" USING btree ("domain_id");