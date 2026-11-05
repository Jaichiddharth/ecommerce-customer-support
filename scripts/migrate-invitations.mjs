import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:mysecretpassword@localhost:5500/postgres';
const sql = postgres(connectionString);

async function run() {
  console.log('Running invitations migration...');
  
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS invitations (
      id SERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      email VARCHAR(255) NOT NULL,
      name VARCHAR(255),
      role VARCHAR(50) NOT NULL DEFAULT 'AGENT',
      custom_permissions JSONB,
      teams TEXT[] DEFAULT '{}'::text[],
      languages TEXT[] DEFAULT '{"EN"}'::text[],
      stores TEXT[] DEFAULT '{}'::text[],
      token VARCHAR(255) NOT NULL UNIQUE,
      invited_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      accepted_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
    CREATE INDEX IF NOT EXISTS idx_invitations_org_email ON invitations(organization_id, email);
    CREATE INDEX IF NOT EXISTS idx_invitations_org_status ON invitations(organization_id, status);

    ALTER TABLE users ADD COLUMN IF NOT EXISTS stores TEXT[] DEFAULT '{}'::text[];
    ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_permissions JSONB;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_backup_codes TEXT[] DEFAULT '{}'::text[];
  `);

  console.log('Migration completed successfully!');
  await sql.end();
  process.exit(0);
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
