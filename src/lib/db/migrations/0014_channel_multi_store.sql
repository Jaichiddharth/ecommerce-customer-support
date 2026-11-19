-- A channel can be connected to several stores: any number of Shopify stores and any number of WooCommerce (commerce)
-- stores at the same time. The unique key moves from channel_id alone to the (store, channel) pair, so a channel
-- is still connected to a given store at most once. Idempotent so it can also be applied by hand.
ALTER TABLE "shopify_store_channels" DROP CONSTRAINT IF EXISTS "uq_shopify_store_channels_channel";
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_shopify_store_channels_store_channel') THEN
    ALTER TABLE "shopify_store_channels" ADD CONSTRAINT "uq_shopify_store_channels_store_channel" UNIQUE("shopify_store_id","channel_id");
  END IF;
END $$;
--> statement-breakpoint
-- Looked up by channel for every inbox conversation (the unique index on channel_id used to serve this)
CREATE INDEX IF NOT EXISTS "idx_shopify_store_channels_org_channel" ON "shopify_store_channels" USING btree ("organization_id","channel_id");
--> statement-breakpoint
ALTER TABLE "commerce_store_channels" DROP CONSTRAINT IF EXISTS "uq_commerce_store_channels_channel";
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_commerce_store_channels_store_channel') THEN
    ALTER TABLE "commerce_store_channels" ADD CONSTRAINT "uq_commerce_store_channels_store_channel" UNIQUE("store_id","channel_id");
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_commerce_store_channels_org_channel" ON "commerce_store_channels" USING btree ("organization_id","channel_id");
