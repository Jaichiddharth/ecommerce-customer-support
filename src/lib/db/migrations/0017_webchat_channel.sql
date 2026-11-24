-- Website chat as an inbox channel: the organisation's chat widget belongs to a `webchat` channel, so its visitor
-- conversations land in the inbox like WhatsApp ones. Existing widgets get their channel here. Idempotent.
ALTER TABLE "ai_widgets" ADD COLUMN IF NOT EXISTS "channel_id" integer REFERENCES "channels"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_widgets_channel" ON "ai_widgets" USING btree ("channel_id") WHERE "channel_id" IS NOT NULL;
--> statement-breakpoint
WITH created AS (
	INSERT INTO "channels" ("organization_id", "type", "name", "status", "is_active")
	SELECT w."organization_id", 'webchat', 'Website chat', CASE WHEN w."enabled" THEN 'connected' ELSE 'disconnected' END, w."enabled"
	FROM "ai_widgets" w
	WHERE w."channel_id" IS NULL
	RETURNING "id", "organization_id"
)
UPDATE "ai_widgets" w SET "channel_id" = created."id" FROM created WHERE created."organization_id" = w."organization_id" AND w."channel_id" IS NULL;
--> statement-breakpoint
-- Visitors of the website chat are contacts found by their visitor id (customers.external_id = 'web:<id>')
CREATE INDEX IF NOT EXISTS "idx_customers_org_channel_external" ON "customers" USING btree ("organization_id", "channel_id", "external_id") WHERE "external_id" IS NOT NULL;
