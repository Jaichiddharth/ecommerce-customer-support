// Apply one hand-written, idempotent migration file in a single transaction.
// For databases that were not created through `drizzle-kit migrate` (no drizzle.__drizzle_migrations
// table), where `npm run db:migrate` would try to replay every migration from 0000.
//
//   npm run db:apply -- src/lib/db/migrations/0013_ai_agent.sql
import postgres from "postgres";
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run db:apply -- <path to .sql file>");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set (.env / .env.local)");
  process.exit(1);
}

const statements = readFileSync(file, "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
try {
  await sql.begin(async (tx) => {
    for (const statement of statements) await tx.unsafe(statement);
  });
  console.log(`Applied ${statements.length} statement(s) from ${file}`);
} catch (err) {
  console.error(`Failed, nothing was changed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
