CREATE TABLE "campaign_recipients" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"phone" varchar(20) NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"wamid" varchar(128),
	"message_id" integer,
	"error_code" integer,
	"error_message" text,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" varchar(120) NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"pause_reason" varchar(40),
	"last_error" text,
	"channel_id" integer,
	"phone_number_id" varchar(64),
	"template" jsonb,
	"variables" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"audience" jsonb,
	"source_file_key" varchar(300),
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"scheduled_at" timestamp with time zone,
	"timezone" varchar(64) DEFAULT 'UTC' NOT NULL,
	"interval_seconds" integer,
	"schedule_name" varchar(64),
	"run_generation" integer DEFAULT 0 NOT NULL,
	"tick_seq" integer DEFAULT 0 NOT NULL,
	"last_tick_at" timestamp with time zone,
	"worker_lease_until" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_campaign_recipients_phone" ON "campaign_recipients" USING btree ("campaign_id","phone");--> statement-breakpoint
CREATE INDEX "idx_campaign_recipients_due" ON "campaign_recipients" USING btree ("campaign_id","id") WHERE "campaign_recipients"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_campaign_recipients_status" ON "campaign_recipients" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "idx_campaign_recipients_wamid" ON "campaign_recipients" USING btree ("wamid") WHERE "campaign_recipients"."wamid" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_campaigns_org_updated" ON "campaigns" USING btree ("organization_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_campaigns_active" ON "campaigns" USING btree ("status","scheduled_at") WHERE "campaigns"."status" IN ('scheduled', 'running');