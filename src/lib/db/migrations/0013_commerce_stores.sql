-- Platform-agnostic store connections (WooCommerce first; Shopify can move here later as platform = 'shopify').
-- Idempotent so it can also be applied by hand on databases where earlier migrations were run manually.
CREATE TABLE IF NOT EXISTS "commerce_stores" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"platform" varchar(30) NOT NULL,
	"store_url" text NOT NULL,
	"store_host" varchar(255) NOT NULL,
	"external_id" varchar(255),
	"name" varchar(255),
	"email" varchar(255),
	"currency_code" varchar(10),
	"credentials" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scopes" text,
	"status" varchar(30) DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"last_verified_at" timestamp with time zone,
	"connected_by_id" integer,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_commerce_stores_org_platform_host" UNIQUE("organization_id","platform","store_host"),
	CONSTRAINT "uq_commerce_stores_org_id" UNIQUE("organization_id","id")
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commerce_stores_organization_id_organizations_id_fk') THEN
    ALTER TABLE "commerce_stores" ADD CONSTRAINT "commerce_stores_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commerce_stores_connected_by_id_users_id_fk') THEN
    ALTER TABLE "commerce_stores" ADD CONSTRAINT "commerce_stores_connected_by_id_users_id_fk" FOREIGN KEY ("connected_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_commerce_stores_org_platform" ON "commerce_stores" USING btree ("organization_id","platform");
--> statement-breakpoint
-- uq_channels_org_id is the target of the composite channel foreign key (added in 0009; repeated in case it's missing)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_channels_org_id') THEN
    ALTER TABLE "channels" ADD CONSTRAINT "uq_channels_org_id" UNIQUE("organization_id","id");
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commerce_store_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"store_id" integer NOT NULL,
	"channel_id" integer NOT NULL,
	"created_by_id" integer,
	"updated_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_commerce_store_channels_channel" UNIQUE("channel_id")
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commerce_store_channels_organization_id_organizations_id_fk') THEN
    ALTER TABLE "commerce_store_channels" ADD CONSTRAINT "commerce_store_channels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commerce_store_channels_created_by_id_users_id_fk') THEN
    ALTER TABLE "commerce_store_channels" ADD CONSTRAINT "commerce_store_channels_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commerce_store_channels_updated_by_id_users_id_fk') THEN
    ALTER TABLE "commerce_store_channels" ADD CONSTRAINT "commerce_store_channels_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_commerce_store_channels_store') THEN
    ALTER TABLE "commerce_store_channels" ADD CONSTRAINT "fk_commerce_store_channels_store" FOREIGN KEY ("organization_id","store_id") REFERENCES "public"."commerce_stores"("organization_id","id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_commerce_store_channels_channel') THEN
    ALTER TABLE "commerce_store_channels" ADD CONSTRAINT "fk_commerce_store_channels_channel" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."channels"("organization_id","id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_commerce_store_channels_org_store" ON "commerce_store_channels" USING btree ("organization_id","store_id");
