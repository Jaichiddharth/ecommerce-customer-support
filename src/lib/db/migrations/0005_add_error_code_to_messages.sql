ALTER TABLE "messages" ADD COLUMN "error_code" integer;--> statement-breakpoint
CREATE INDEX "idx_messages_error_code" ON "messages" USING btree ("error_code");
