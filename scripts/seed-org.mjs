/**
 * Seeds the default organization. Safe to run repeatedly.
 *
 *   npm run db:seed
 *
 * Override with DEFAULT_ORG_SLUG / DEFAULT_ORG_NAME in .env.local.
 * The slug must match DEFAULT_ORG_SLUG in src/lib/services/organization.service.ts.
 */
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not configured");
  process.exit(1);
}

const org = {
  name: process.env.DEFAULT_ORG_NAME || "La Confianza Tech",
  slug: process.env.DEFAULT_ORG_SLUG || "la-confianza-tech",
  plan: "starter",
  sla_response_minutes: 15,
};

const sql = postgres(connectionString, { max: 1 });

try {
  await sql`
    INSERT INTO organizations ${sql(org)}
    ON CONFLICT (slug) DO NOTHING
  `;

  // Rows inserted earlier with an explicit id (e.g. id = 1) do not advance the
  // serial sequence; realign it so the next organization gets a free id.
  await sql`
    SELECT setval(
      pg_get_serial_sequence('organizations', 'id'),
      GREATEST((SELECT MAX(id) FROM organizations), 1)
    )
  `;

  const [row] = await sql`SELECT id, name, slug FROM organizations WHERE slug = ${org.slug}`;
  console.log(`Organization ready: "${row.name}" (slug: ${row.slug}, id: ${row.id})`);
} catch (err) {
  console.error("Seeding failed:", err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
