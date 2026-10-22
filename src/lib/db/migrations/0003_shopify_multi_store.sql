DROP INDEX "uq_shopify_stores_org_active";--> statement-breakpoint
CREATE INDEX "idx_shopify_stores_org" ON "shopify_stores" USING btree ("organization_id");