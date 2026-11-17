-- Prerequisite: ensure shopify_stores(organization_id, id) is unique for composite FK references
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_shopify_stores_org_id') THEN
    ALTER TABLE "shopify_stores" ADD CONSTRAINT "uq_shopify_stores_org_id" UNIQUE("organization_id", "id");
  END IF;
END $$;--> statement-breakpoint

-- Add missing unique constraints on shopify_customer_links
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_shopify_links_store_customer') THEN
    ALTER TABLE "shopify_customer_links" ADD CONSTRAINT "uq_shopify_links_store_customer" UNIQUE("shopify_store_id", "customer_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_shopify_links_store_shopify_customer') THEN
    ALTER TABLE "shopify_customer_links" ADD CONSTRAINT "uq_shopify_links_store_shopify_customer" UNIQUE("shopify_store_id", "shopify_customer_id");
  END IF;
END $$;--> statement-breakpoint

-- Add missing composite foreign key on shopify_customer_links
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_shopify_customer_links_org_store') THEN
    ALTER TABLE "shopify_customer_links" ADD CONSTRAINT "fk_shopify_customer_links_org_store" FOREIGN KEY ("organization_id", "shopify_store_id") REFERENCES "shopify_stores"("organization_id", "id") ON DELETE CASCADE;
  END IF;
END $$;--> statement-breakpoint

-- Add missing unique constraint on shopify_order_links
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_shopify_order_links_store_order') THEN
    ALTER TABLE "shopify_order_links" ADD CONSTRAINT "uq_shopify_order_links_store_order" UNIQUE("shopify_store_id", "shopify_order_id");
  END IF;
END $$;--> statement-breakpoint

-- Add missing composite foreign key on shopify_order_links
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_shopify_order_links_org_store') THEN
    ALTER TABLE "shopify_order_links" ADD CONSTRAINT "fk_shopify_order_links_org_store" FOREIGN KEY ("organization_id", "shopify_store_id") REFERENCES "shopify_stores"("organization_id", "id") ON DELETE CASCADE;
  END IF;
END $$;

