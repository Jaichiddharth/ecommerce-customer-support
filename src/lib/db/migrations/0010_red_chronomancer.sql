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
CREATE TABLE "invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"role" varchar(50) DEFAULT 'AGENT' NOT NULL,
	"custom_permissions" jsonb,
	"teams" text[] DEFAULT '{}'::text[],
	"languages" text[] DEFAULT '{"EN"}'::text[],
	"stores" text[] DEFAULT '{}'::text[],
	"token" varchar(255) NOT NULL,
	"invited_by_id" integer,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "plan" SET DEFAULT 'growth';--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "max_seats" integer DEFAULT 10;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "role_permissions" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "teams" text[] DEFAULT '{}'::text[];--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "languages" text[] DEFAULT '{"EN"}'::text[];--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stores" text[] DEFAULT '{}'::text[];--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "custom_permissions" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "two_factor_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "two_factor_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "two_factor_backup_codes" text[] DEFAULT '{}'::text[];--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" varchar(50) DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "message_reactions" ADD COLUMN "organization_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "shopify_stores" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shopify_order_links" ADD CONSTRAINT "shopify_order_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_order_links" ADD CONSTRAINT "shopify_order_links_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_order_links" ADD CONSTRAINT "shopify_order_links_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_order_links" ADD CONSTRAINT "shopify_order_links_linked_by_id_users_id_fk" FOREIGN KEY ("linked_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_order_links" ADD CONSTRAINT "fk_shopify_order_links_org_store" FOREIGN KEY ("organization_id","shopify_store_id") REFERENCES "public"."shopify_stores"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_store_channels" ADD CONSTRAINT "shopify_store_channels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_store_channels" ADD CONSTRAINT "shopify_store_channels_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_store_channels" ADD CONSTRAINT "shopify_store_channels_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_store_channels" ADD CONSTRAINT "fk_shopify_store_channels_store" FOREIGN KEY ("organization_id","shopify_store_id") REFERENCES "public"."shopify_stores"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_store_channels" ADD CONSTRAINT "fk_shopify_store_channels_channel" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."channels"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_id_users_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_shopify_order_links_org_customer" ON "shopify_order_links" USING btree ("organization_id","customer_id");--> statement-breakpoint
CREATE INDEX "idx_shopify_order_links_channel" ON "shopify_order_links" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_shopify_store_channels_org_store" ON "shopify_store_channels" USING btree ("organization_id","shopify_store_id");--> statement-breakpoint
CREATE INDEX "idx_invitations_token" ON "invitations" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_invitations_org_email" ON "invitations" USING btree ("organization_id","email");--> statement-breakpoint
CREATE INDEX "idx_invitations_org_status" ON "invitations" USING btree ("organization_id","status");--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_customer_links" ADD CONSTRAINT "fk_shopify_customer_links_org_store" FOREIGN KEY ("organization_id","shopify_store_id") REFERENCES "public"."shopify_stores"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_reactions_org_message" ON "message_reactions" USING btree ("organization_id","message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_shopify_stores_org_default" ON "shopify_stores" USING btree ("organization_id") WHERE "shopify_stores"."is_default" = true;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "uq_channels_org_id" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "shopify_stores" ADD CONSTRAINT "uq_shopify_stores_org_id" UNIQUE("organization_id","id");