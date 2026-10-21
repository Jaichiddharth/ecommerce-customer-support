ALTER TABLE "channels" ADD COLUMN "handle" varchar(255);--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "external_account_id" varchar(100);--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "status" varchar(30) DEFAULT 'connected' NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "handle" varchar(255);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "external_id" varchar(255);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "language" varchar(20);--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "handled_by" varchar(20) DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "needs_human" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "ai_summary" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "ai_intent" varchar(100);--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "ai_confidence" real;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "ai_actions_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "ai_model" varchar(100);--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "ai_suggestions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "language" varchar(20);--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
CREATE INDEX "idx_channels_external_account" ON "channels" USING btree ("external_account_id");--> statement-breakpoint
CREATE INDEX "idx_customers_org_external" ON "customers" USING btree ("organization_id","external_id");--> statement-breakpoint
CREATE INDEX "idx_tickets_org_customer" ON "tickets" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "idx_tickets_org_handled_by" ON "tickets" USING btree ("organization_id","handled_by");--> statement-breakpoint
CREATE INDEX "idx_tickets_org_last_message" ON "tickets" USING btree ("organization_id","last_message_at" DESC NULLS LAST);--> statement-breakpoint
-- Backfill: one conversation (ticket) per existing customer, carrying the latest message
INSERT INTO "tickets" ("organization_id", "ticket_number", "customer_id", "channel_id", "status", "last_message_text", "last_message_at", "created_at", "updated_at")
SELECT c."organization_id",
       'C-' || c."id" || '-0',
       c."id",
       c."channel_id",
       'OPEN',
       lm."text_content",
       COALESCE(lm."created_at", c."created_at"),
       c."created_at",
       now()
FROM "customers" c
LEFT JOIN LATERAL (
  SELECT m."text_content", m."created_at"
  FROM "messages" m
  WHERE m."customer_id" = c."id" AND m."is_internal_note" = false
  ORDER BY m."created_at" DESC
  LIMIT 1
) lm ON true
WHERE NOT EXISTS (SELECT 1 FROM "tickets" t WHERE t."customer_id" = c."id");--> statement-breakpoint
-- Link existing messages to their customer's conversation
UPDATE "messages" m
SET "ticket_id" = t."id"
FROM "tickets" t
WHERE m."ticket_id" IS NULL AND t."customer_id" = m."customer_id";
