ALTER TABLE "customers" ADD COLUMN "channel_id" integer;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_customers_org_channel" ON "customers" USING btree ("organization_id","channel_id");--> statement-breakpoint
CREATE INDEX "idx_customers_channel" ON "customers" USING btree ("channel_id");