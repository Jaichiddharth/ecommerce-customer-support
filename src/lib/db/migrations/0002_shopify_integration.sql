CREATE TABLE "shopify_customer_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"shopify_store_id" integer NOT NULL,
	"customer_id" integer NOT NULL,
	"shopify_customer_id" varchar(100) NOT NULL,
	"linked_by_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_shopify_links_store_customer" UNIQUE("shopify_store_id","customer_id"),
	CONSTRAINT "uq_shopify_links_store_shopify_customer" UNIQUE("shopify_store_id","shopify_customer_id")
);
--> statement-breakpoint
CREATE TABLE "shopify_stores" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"shop_domain" varchar(255) NOT NULL,
	"shopify_shop_id" varchar(100),
	"name" varchar(255),
	"email" varchar(255),
	"currency_code" varchar(10),
	"primary_domain_url" text,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp with time zone,
	"scopes" text,
	"status" varchar(30) DEFAULT 'connected' NOT NULL,
	"last_error" text,
	"connected_by_id" integer,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_shopify_stores_org_domain" UNIQUE("organization_id","shop_domain")
);
--> statement-breakpoint
ALTER TABLE "shopify_customer_links" ADD CONSTRAINT "shopify_customer_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_customer_links" ADD CONSTRAINT "shopify_customer_links_shopify_store_id_shopify_stores_id_fk" FOREIGN KEY ("shopify_store_id") REFERENCES "public"."shopify_stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_customer_links" ADD CONSTRAINT "shopify_customer_links_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_customer_links" ADD CONSTRAINT "shopify_customer_links_linked_by_id_users_id_fk" FOREIGN KEY ("linked_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_stores" ADD CONSTRAINT "shopify_stores_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_stores" ADD CONSTRAINT "shopify_stores_connected_by_id_users_id_fk" FOREIGN KEY ("connected_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_shopify_links_org_customer" ON "shopify_customer_links" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_shopify_stores_org_active" ON "shopify_stores" USING btree ("organization_id") WHERE "shopify_stores"."status" <> 'disconnected';--> statement-breakpoint
CREATE INDEX "idx_shopify_stores_domain" ON "shopify_stores" USING btree ("shop_domain");