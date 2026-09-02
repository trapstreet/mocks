// Apply db/schema.sql. The file is the source of truth; this only carries it.
//
// Statements are sent one at a time because the HTTP driver takes one per
// request. The schema is written to be re-runnable (`if not exists`
// throughout), so this is safe to run against a database that already has it.
import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set.\n" +
      "Put the pooled Neon connection string in mocks/.env.local as:\n" +
      "  DATABASE_URL=postgresql://…-pooler.…neon.tech/neondb?sslmode=require",
  );
  process.exit(1);
}

const sql = neon(url);
const source = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");

// Strip comments before splitting: a `;` inside one is not a statement end.
const statements = source
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

for (const statement of statements) {
  const [head] = statement.split("\n");
  process.stdout.write(`  ${head.slice(0, 68)}…\n`);
  await sql.query(statement);
}
console.log(`\napplied ${statements.length} statements`);
