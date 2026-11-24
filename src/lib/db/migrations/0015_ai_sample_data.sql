-- AI agent sample data (Test data tab): sample orders and products to test the agent without a live store. Idempotent.
CREATE TABLE IF NOT EXISTS "ai_sample_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
	"kind" varchar(20) NOT NULL,
	"data" jsonb NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"file_name" varchar(200),
	"updated_by_id" integer REFERENCES "users"("id") ON DELETE set null,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_sample_data_org_kind" ON "ai_sample_data" USING btree ("organization_id","kind");
