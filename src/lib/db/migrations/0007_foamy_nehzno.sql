ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "waba_id" varchar(100);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_channels_waba_id" ON "channels" USING btree ("waba_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_channels_meta_phone_id" ON "channels" USING btree ("meta_phone_number_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_channels_phone_number" ON "channels" USING btree ("phone_number");