import { neon } from "@neondatabase/serverless";

// The database is optional, and every caller has to treat it that way.
//
// This site was deployed and demoed before it had one, and the parts that
// matter most — sitting a benchmark, watching the agent work, the judge's
// verdict — never touch it. Only the record of past runs does. So a missing
// or unreachable database costs the board and nothing else: `sql()` returns
// null rather than throwing, and the pages that use it render without it.

export type Sql = ReturnType<typeof neon>;

let cached: Sql | null | undefined;

export function sql(): Sql | null {
  if (cached !== undefined) return cached;
  const url = process.env.DATABASE_URL;
  cached = url ? neon(url) : null;
  return cached;
}

/** Test seam: swap the connection, or clear it back to the environment's. */
export function setSql(next: Sql | null | undefined): void {
  cached = next;
}
