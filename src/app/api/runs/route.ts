import { NextResponse } from "next/server";
import { sql } from "@/lib/db/client";
import { recordRun } from "@/lib/db/runs";
import { InvalidRun, parseSubmission } from "@/lib/db/submission";
import { checkRunWrite } from "@/lib/db/write-guard";

// Recording a run on this site's own board.
//
// Open to anyone, on purpose and for now. The write guard is a speed bump, not
// identity: it stops accidental double-submits and casual spam, while the page
// still says plainly that a name here proves only that somebody typed it.

export const runtime = "nodejs";

export async function POST(request: Request) {
  const db = sql();
  // No database configured is a fact about the deployment, not a fault in the
  // request. The attempt itself already happened in the visitor's browser and
  // was scored there; only the record is lost.
  if (!db) {
    return NextResponse.json(
      { error: "this deployment has no board configured — the run was not recorded" },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "the body is not JSON" }, { status: 400 });
  }

  try {
    const run = parseSubmission(body);
    const write = checkRunWrite(request, run);
    if (!write.ok) {
      return NextResponse.json(
        { error: write.error },
        { status: write.status, headers: { "Retry-After": String(write.retryAfter) } },
      );
    }
    const id = await recordRun(db, run);
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    if (e instanceof InvalidRun) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    // A failure to write is ours. Reporting it as a bad request would send
    // whoever ran it looking for a mistake they did not make.
    console.error("[runs] could not record a run:", e);
    return NextResponse.json({ error: "the run could not be recorded" }, { status: 500 });
  }
}
