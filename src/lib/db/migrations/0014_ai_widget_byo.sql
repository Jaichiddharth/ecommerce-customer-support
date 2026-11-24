-- AI agent: bring your own model (Model tab) and the website chat widget (Chat widget tab). Idempotent.
ALTER TABLE "ai_agent_configs" ADD COLUMN IF NOT EXISTS "byo_provider" varchar(20);
--> statement-breakpoint
ALTER TABLE "ai_agent_configs" ADD COLUMN IF NOT EXISTS "byo_model" varchar(100);
--> statement-breakpoint
ALTER TABLE "ai_agent_configs" ADD COLUMN IF NOT EXISTS "byo_api_key" text;
--> statement-breakpoint
ALTER TABLE "ai_agent_configs" ADD COLUMN IF NOT EXISTS "byo_key_hint" varchar(12);
--> statement-breakpoint
ALTER TABLE "ai_agent_configs" ADD COLUMN IF NOT EXISTS "byo_monthly_limit_usd" real;
--> statement-breakpoint
ALTER TABLE "ai_agent_configs" ADD COLUMN IF NOT EXISTS "byo_verified_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_widgets" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
	"public_key" varchar(40) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_widgets_org" ON "ai_widgets" USING btree ("organization_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_widgets_public_key" ON "ai_widgets" USING btree ("public_key");
