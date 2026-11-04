CREATE TABLE "automation_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"automation_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"channel_id" integer,
	"trigger_key" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"current_node_id" varchar(100),
	"waiting_for" jsonb,
	"wake_at" timestamp with time zone,
	"context" jsonb NOT NULL,
	"step_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" varchar(200) NOT NULL,
	"graph" jsonb NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_flow_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"flow_id" integer NOT NULL,
	"flow_version_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"channel_id" integer,
	"template_id" integer,
	"automation_run_id" integer,
	"automation_node_id" varchar(100),
	"send_method" varchar(20) NOT NULL,
	"flow_token" varchar(100) NOT NULL,
	"meta_message_id" varchar(255),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"last_error" text,
	"expires_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_flow_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"execution_id" integer,
	"flow_id" integer,
	"flow_version_id" integer,
	"customer_id" integer NOT NULL,
	"channel_id" integer,
	"meta_message_id" varchar(255) NOT NULL,
	"flow_token" varchar(100),
	"response" jsonb NOT NULL,
	"processing_status" varchar(20) DEFAULT 'received' NOT NULL,
	"automation_run_id" integer,
	"last_error" text,
	"submitted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_flow_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"flow_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"waba_id" varchar(100) NOT NULL,
	"meta_flow_id" varchar(100),
	"meta_flow_name" varchar(255) NOT NULL,
	"json_version" varchar(10) NOT NULL,
	"definition" jsonb NOT NULL,
	"flow_json" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'publishing' NOT NULL,
	"validation_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"meta_response" jsonb,
	"last_error" text,
	"published_at" timestamp with time zone,
	"deprecated_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_flows" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"channel_id" integer,
	"name" varchar(200) NOT NULL,
	"categories" text[] DEFAULT '{OTHER}'::text[] NOT NULL,
	"json_version" varchar(10) NOT NULL,
	"draft" jsonb NOT NULL,
	"has_unpublished_changes" boolean DEFAULT true NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"published_version_id" integer,
	"created_by_id" integer,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"channel_id" integer,
	"waba_id" varchar(100) NOT NULL,
	"meta_template_id" varchar(100),
	"name" varchar(512) NOT NULL,
	"language" varchar(20) NOT NULL,
	"category" varchar(30) NOT NULL,
	"status" varchar(30) DEFAULT 'PENDING' NOT NULL,
	"rejection_reason" text,
	"body_text" text NOT NULL,
	"header_text" varchar(60),
	"footer_text" varchar(60),
	"components" jsonb NOT NULL,
	"flow_id" integer,
	"flow_version_id" integer,
	"flow_button" jsonb,
	"flow_button_index" integer,
	"last_error" text,
	"last_synced_at" timestamp with time zone,
	"created_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_flow_executions" ADD CONSTRAINT "whatsapp_flow_executions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_flow_executions" ADD CONSTRAINT "whatsapp_flow_executions_flow_id_whatsapp_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."whatsapp_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_flow_executions" ADD CONSTRAINT "whatsapp_flow_executions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_flow_executions" ADD CONSTRAINT "whatsapp_flow_executions_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_flow_executions" ADD CONSTRAINT "whatsapp_flow_executions_template_id_whatsapp_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."whatsapp_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_flow_executions" ADD CONSTRAINT "whatsapp_flow_executions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_flow_executions" ADD CONSTRAINT "wa_flow_exec_version_fk" FOREIGN KEY ("flow_version_id") REFERENCES "public"."whatsapp_flow_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_flow_submissions" ADD CONSTRAINT "whatsapp_flow_submissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_flow_submissions" ADD CONSTRAINT "whatsapp_flow_submissions_flow_id_whatsapp_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."whatsapp_flows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_flow_submissions" ADD CONSTRAINT "whatsapp_flow_submissions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_flow_submissions" ADD CONSTRAINT "whatsapp_flow_submissions_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_flow_submissions" ADD CONSTRAINT "wa_flow_sub_execution_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."whatsapp_flow_executions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_flow_submissions" ADD CONSTRAINT "wa_flow_sub_version_fk" FOREIGN KEY ("flow_version_id") REFERENCES "public"."whatsapp_flow_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_flow_versions" ADD CONSTRAINT "whatsapp_flow_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_flow_versions" ADD CONSTRAINT "whatsapp_flow_versions_flow_id_whatsapp_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."whatsapp_flows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_flow_versions" ADD CONSTRAINT "whatsapp_flow_versions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_flows" ADD CONSTRAINT "whatsapp_flows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_flows" ADD CONSTRAINT "whatsapp_flows_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_flows" ADD CONSTRAINT "whatsapp_flows_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_flow_id_whatsapp_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."whatsapp_flows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_flow_version_id_whatsapp_flow_versions_id_fk" FOREIGN KEY ("flow_version_id") REFERENCES "public"."whatsapp_flow_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_automation_runs_trigger" ON "automation_runs" USING btree ("automation_id","trigger_key");--> statement-breakpoint
CREATE INDEX "idx_automation_runs_org_customer" ON "automation_runs" USING btree ("organization_id","customer_id","status");--> statement-breakpoint
CREATE INDEX "idx_automation_runs_waiting" ON "automation_runs" USING btree ("status","wake_at") WHERE "automation_runs"."status" = 'waiting';--> statement-breakpoint
CREATE INDEX "idx_automations_org_active" ON "automations" USING btree ("organization_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wa_flow_exec_token" ON "whatsapp_flow_executions" USING btree ("flow_token");--> statement-breakpoint
CREATE INDEX "idx_wa_flow_exec_meta_message" ON "whatsapp_flow_executions" USING btree ("meta_message_id");--> statement-breakpoint
CREATE INDEX "idx_wa_flow_exec_org_customer" ON "whatsapp_flow_executions" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "idx_wa_flow_exec_run" ON "whatsapp_flow_executions" USING btree ("automation_run_id");--> statement-breakpoint
CREATE INDEX "idx_wa_flow_exec_status_expiry" ON "whatsapp_flow_executions" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wa_flow_sub_meta_message" ON "whatsapp_flow_submissions" USING btree ("organization_id","meta_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wa_flow_sub_execution" ON "whatsapp_flow_submissions" USING btree ("execution_id") WHERE "whatsapp_flow_submissions"."execution_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_wa_flow_sub_org_flow" ON "whatsapp_flow_submissions" USING btree ("organization_id","flow_id","submitted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_wa_flow_sub_org_submitted" ON "whatsapp_flow_submissions" USING btree ("organization_id","submitted_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wa_flow_versions_flow_number" ON "whatsapp_flow_versions" USING btree ("flow_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wa_flow_versions_meta_flow_id" ON "whatsapp_flow_versions" USING btree ("meta_flow_id") WHERE "whatsapp_flow_versions"."meta_flow_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_wa_flow_versions_org_status" ON "whatsapp_flow_versions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "idx_wa_flows_org_status" ON "whatsapp_flows" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "idx_wa_flows_org_updated" ON "whatsapp_flows" USING btree ("organization_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wa_templates_meta_id" ON "whatsapp_templates" USING btree ("meta_template_id") WHERE "whatsapp_templates"."meta_template_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_wa_templates_waba_name_lang" ON "whatsapp_templates" USING btree ("waba_id","name","language");--> statement-breakpoint
CREATE INDEX "idx_wa_templates_org_status" ON "whatsapp_templates" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "idx_wa_templates_flow" ON "whatsapp_templates" USING btree ("flow_id");