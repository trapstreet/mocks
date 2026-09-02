import { createHash } from "node:crypto";

// A thin in-process guard for the anonymous board write path.
//
// It is not identity, and it is not pretending to be. Serverless instances do
// not share memory, so this is a speed bump rather than a wall. That is enough
// for the demo shape: stop accidental double-submits and casual refresh spam
// without adding sign-in to a site whose main job is still the browser run.

export const RUN_WRITE_LIMIT = {
  max: 10,
  windowMs: 10 * 60 * 1000,
  duplicateMs: 15 * 60 * 1000,
} as const;

interface SeenWrite {
  at: number;
  hash: string;
}

interface Bucket {
  writes: SeenWrite[];
}

const buckets = new Map<string, Bucket>();

function ip(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    forwarded ||
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function hash(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("base64url");
}

export function checkRunWrite(
  request: Request,
  body: unknown,
  now = Date.now(),
):
  | { ok: true }
  | { ok: false; status: 409 | 429; retryAfter: number; error: string } {
  const key = ip(request);
  const h = hash(body);
  const bucket = buckets.get(key) ?? { writes: [] };
  bucket.writes = bucket.writes.filter((w) => now - w.at < RUN_WRITE_LIMIT.windowMs);

  const duplicate = bucket.writes.find(
    (w) => w.hash === h && now - w.at < RUN_WRITE_LIMIT.duplicateMs,
  );
  if (duplicate) {
    buckets.set(key, bucket);
    return {
      ok: false,
      status: 409,
      retryAfter: Math.ceil((RUN_WRITE_LIMIT.duplicateMs - (now - duplicate.at)) / 1000),
      error: "this exact run was already recorded recently",
    };
  }

  if (bucket.writes.length >= RUN_WRITE_LIMIT.max) {
    const oldest = bucket.writes[0];
    buckets.set(key, bucket);
    return {
      ok: false,
      status: 429,
      retryAfter: Math.ceil((RUN_WRITE_LIMIT.windowMs - (now - oldest.at)) / 1000),
      error: "too many runs from this browser recently; try again later",
    };
  }

  bucket.writes.push({ at: now, hash: h });
  buckets.set(key, bucket);
  return { ok: true };
}

export function resetRunWriteGuard(): void {
  buckets.clear();
}
