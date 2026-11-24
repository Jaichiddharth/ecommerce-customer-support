-- AI agent configuration (dashboard: AI agent > Guardrails / Model). Idempotent.
CREATE TABLE IF NOT EXISTS "ai_agent_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
	"enabled" boolean DEFAULT false NOT NULL,
	"live_version_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_agent_configs_org" ON "ai_agent_configs" USING btree ("organization_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_agent_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
	"version" integer NOT NULL,
	"policy" jsonb NOT NULL,
	"note" varchar(200),
	"created_by_id" integer REFERENCES "users"("id") ON DELETE set null,
	"test_score" real,
	"test_run_id" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_agent_versions_org_version" ON "ai_agent_versions" USING btree ("organization_id","version");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_agent_versions_org" ON "ai_agent_versions" USING btree ("organization_id","created_at");
