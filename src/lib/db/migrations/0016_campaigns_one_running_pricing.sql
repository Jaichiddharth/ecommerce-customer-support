ALTER TABLE "campaign_recipients" ADD COLUMN "billable" boolean;--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD COLUMN "pricing_category" varchar(40);--> statement-breakpoint
ALTER TABLE "campaign_recipients" ADD COLUMN "pricing_model" varchar(20);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_campaigns_one_running_per_org" ON "campaigns" USING btree ("organization_id") WHERE "campaigns"."status" = 'running';