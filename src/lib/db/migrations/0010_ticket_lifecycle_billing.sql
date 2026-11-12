-- Ticket lifecycle & mock billing: a ticket becomes billable (one ticket credit) on the first teammate reply.
-- Existing tickets start unbilled, so every workspace starts with its full mock allowance.
ALTER TABLE "tickets" ADD COLUMN "billable_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "billable_by_id" integer;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_billable_by_id_users_id_fk" FOREIGN KEY ("billable_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_tickets_org_billable" ON "tickets" USING btree ("organization_id","billable_at") WHERE "tickets"."billable_at" IS NOT NULL;
