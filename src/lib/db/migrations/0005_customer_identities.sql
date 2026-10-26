ALTER TABLE "shopify_customer_links" ALTER COLUMN "shopify_customer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "primary_customer_id" integer;--> statement-breakpoint
ALTER TABLE "shopify_customer_links" ADD COLUMN "source" varchar(20) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_primary_customer_id_customers_id_fk" FOREIGN KEY ("primary_customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_customers_primary" ON "customers" USING btree ("primary_customer_id");