ALTER TABLE "automations" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "automations" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "automations" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "idx_automation_runs_automation_created" ON "automation_runs" USING btree ("automation_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_automations_org_updated" ON "automations" USING btree ("organization_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
-- Backfill: automations already switched on count as activated (Paused, not Draft, if later switched off)
UPDATE "automations" SET "activated_at" = "updated_at" WHERE "is_active" = true AND "activated_at" IS NULL;
