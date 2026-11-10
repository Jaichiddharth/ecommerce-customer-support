-- Store ↔ channel connections, default store, order associations and store-level isolation keys
ALTER TABLE "shopify_stores" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Existing data: the store the inbox already used (oldest connected one, else the oldest needing
-- re-authorization) becomes each workspace's default store, so nothing changes for existing workspaces
UPDATE "shopify_stores" SET "is_default" = true
WHERE "id" IN (
  SELECT DISTINCT ON ("organization_id") "id" FROM "shopify_stores"
  WHERE "status" <> 'disconnected'
  ORDER BY "organization_id", ("status" = 'connected') DESC, "connected_at", "id"
);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_shopify_stores_org_default" ON "shopify_stores" USING btree ("organization_id") WHERE "shopify_stores"."is_default" = true;--> statement-breakpoint
-- Targets of the composite (organization_id, id) foreign keys
ALTER TABLE "shopify_stores" ADD CONSTRAINT "uq_shopify_stores_org_id" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "uq_channels_org_id" UNIQUE("organization_id","id");--> statement-breakpoint
CREATE TABLE "shopify_store_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"shopify_store_id" integer NOT NULL,
	"channel_id" integer NOT NULL,
	"created_by_id" integer,
	"updated_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_shopify_store_channels_channel" UNIQUE("channel_id")
);
--> statement-breakpoint
ALTER TABLE "shopify_store_channels" ADD CONSTRAINT "shopify_store_channels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_store_channels" ADD CONSTRAINT "shopify_store_channels_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_store_channels" ADD CONSTRAINT "shopify_store_channels_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_store_channels" ADD CONSTRAINT "fk_shopify_store_channels_store" FOREIGN KEY ("organization_id","shopify_store_id") REFERENCES "public"."shopify_stores"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_store_channels" ADD CONSTRAINT "fk_shopify_store_channels_channel" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."channels"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_shopify_store_channels_org_store" ON "shopify_store_channels" USING btree ("organization_id","shopify_store_id");--> statement-breakpoint
CREATE TABLE "shopify_order_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"shopify_store_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"channel_id" integer,
	"shopify_order_id" varchar(100) NOT NULL,
	"order_name" varchar(100),
	"source" varchar(20) DEFAULT 'manual' NOT NULL,
	"linked_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_shopify_order_links_store_order" UNIQUE("shopify_store_id","shopify_order_id")
);
--> statement-breakpoint
ALTER TABLE "shopify_order_links" ADD CONSTRAINT "shopify_order_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_order_links" ADD CONSTRAINT "shopify_order_links_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_order_links" ADD CONSTRAINT "shopify_order_links_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_order_links" ADD CONSTRAINT "shopify_order_links_linked_by_id_users_id_fk" FOREIGN KEY ("linked_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_order_links" ADD CONSTRAINT "fk_shopify_order_links_org_store" FOREIGN KEY ("organization_id","shopify_store_id") REFERENCES "public"."shopify_stores"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_shopify_order_links_org_customer" ON "shopify_order_links" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "idx_shopify_order_links_channel" ON "shopify_order_links" USING btree ("channel_id");--> statement-breakpoint
-- Existing contact links: a link's store must belong to the link's workspace. Added NOT VALID (no long lock),
-- then validated; the app has always written links with a store of the same workspace.
ALTER TABLE "shopify_customer_links" ADD CONSTRAINT "fk_shopify_customer_links_org_store" FOREIGN KEY ("organization_id","shopify_store_id") REFERENCES "public"."shopify_stores"("organization_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "shopify_customer_links" VALIDATE CONSTRAINT "fk_shopify_customer_links_org_store";
