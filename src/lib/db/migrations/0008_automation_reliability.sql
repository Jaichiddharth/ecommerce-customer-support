CREATE TABLE "automation_graph_versions" (
	"automation_id" integer NOT NULL,
	"version" integer NOT NULL,
	"graph" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_graph_versions_automation_id_version_pk" PRIMARY KEY("automation_id","version")
);
--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN "graph_version" integer;--> statement-breakpoint
ALTER TABLE "automations" ADD COLUMN "graph_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "automation_pending_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "automation_graph_versions" ADD CONSTRAINT "automation_graph_versions_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Existing data: keep the oldest unfinished run per (automation, customer), cancel the extra ones,
-- so the one-open-run unique index can be created
UPDATE "automation_runs" SET "status" = 'cancelled', "waiting_for" = NULL, "last_error" = 'Duplicate open run (closed by migration 0008).', "completed_at" = now(), "updated_at" = now()
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (PARTITION BY "automation_id", "customer_id" ORDER BY "id") AS rn
    FROM "automation_runs" WHERE "status" IN ('running', 'waiting')
  ) d WHERE d.rn > 1
);--> statement-breakpoint
-- Runs already running get a fresh lease; ones that never finish are released by the sweep once it passes
UPDATE "automation_runs" SET "locked_until" = now() + interval '15 minutes' WHERE "status" = 'running';--> statement-breakpoint
-- Version 1 of every existing graph
INSERT INTO "automation_graph_versions" ("automation_id", "version", "graph") SELECT "id", "graph_version", "graph" FROM "automations" ON CONFLICT DO NOTHING;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_automation_runs_open" ON "automation_runs" USING btree ("automation_id","customer_id") WHERE "automation_runs"."status" IN ('running', 'waiting');--> statement-breakpoint
CREATE INDEX "idx_automation_runs_lease" ON "automation_runs" USING btree ("locked_until") WHERE "automation_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "idx_automation_runs_completed" ON "automation_runs" USING btree ("completed_at") WHERE "automation_runs"."completed_at" IS NOT NULL;--> statement-breakpoint
-- Existing data: a wamid stored twice (webhook retry race) keeps it on the oldest row only. No rows are deleted.
UPDATE "messages" SET "meta_message_id" = NULL
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (PARTITION BY "organization_id", "meta_message_id" ORDER BY "id") AS rn
    FROM "messages" WHERE "meta_message_id" IS NOT NULL
  ) d WHERE d.rn > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_messages_org_meta_id" ON "messages" USING btree ("organization_id","meta_message_id") WHERE "messages"."meta_message_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_messages_automation_pending" ON "messages" USING btree ("automation_pending_since") WHERE "messages"."automation_pending_since" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_wa_flow_sub_received" ON "whatsapp_flow_submissions" USING btree ("created_at") WHERE "whatsapp_flow_submissions"."processing_status" = 'received';