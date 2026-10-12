ALTER TABLE "messages" ADD COLUMN "status" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN IF EXISTS "is_read";--> statement-breakpoint
CREATE INDEX "idx_messages_status" ON "messages" USING btree ("status");
