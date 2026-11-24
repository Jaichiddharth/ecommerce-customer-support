-- Shared rate-limit counters (fixed one-minute windows), so limits hold across server instances and restarts.
-- Used by the public chat widget. Rows older than a few minutes are deleted as new ones are written. Idempotent.
CREATE TABLE IF NOT EXISTS "rate_limit_hits" (
	"key" varchar(200) NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limit_hits_pk" PRIMARY KEY ("key", "window_start")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_rate_limit_hits_window" ON "rate_limit_hits" USING btree ("window_start");
