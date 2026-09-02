import { NextResponse } from "next/server";
import { sql } from "@/lib/db/client";
import { recordRun } from "@/lib/db/runs";
import { InvalidRun, parseSubmission } from "@/lib/db/submission";

// Recording a run on this site's own board.
//
// Open to anyone, on purpose and for now: sign-in is the next step, and a
// board with no records is worth less this week than a board that anybody can
// write to. What that costs is worth naming — a name on this board proves
// only that somebody typed it — and the page says so beside every row.

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
