-- Add organization_id to message_reactions for complete tenant isolation
ALTER TABLE "message_reactions" ADD COLUMN IF NOT EXISTS "organization_id" integer;

-- Backfill organization_id from the parent messages table
UPDATE "message_reactions" r
SET "organization_id" = m."organization_id"
FROM "messages" m
WHERE r."message_id" = m."id" AND r."organization_id" IS NULL;

-- Remove any orphaned reactions that cannot be mapped to an organization
DELETE FROM "message_reactions" WHERE "organization_id" IS NULL;

-- Enforce NOT NULL and foreign key constraint
ALTER TABLE "message_reactions" ALTER COLUMN "organization_id" SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE "message_reactions" 
    ADD CONSTRAINT "message_reactions_organization_id_organizations_id_fk" 
    FOREIGN KEY ("organization_id") 
    REFERENCES "public"."organizations"("id") 
    ON DELETE cascade 
    ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create tenant index for high-performance scoped reaction lookups
CREATE INDEX IF NOT EXISTS "idx_reactions_org_message" ON "message_reactions" ("organization_id", "message_id");
