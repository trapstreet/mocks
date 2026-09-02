import { sql } from "@/lib/db/client";
import { runsForTask } from "@/lib/db/runs";
import { byPersona } from "@/lib/db/compare";

// This site's board, for one task.
//
// It is a record, not a ranking. The expected answers to these tasks are
// public at their pinned commits, so ordering people by score would be a
// column of full marks and a lie about what it measured. What it can honestly
// show is which CONFIGURATION did better on the same questions — and, since
// nobody is signed in yet, it says plainly that a name here proves only that
// somebody typed it.

function pct(n: number): string {
  return n.toFixed(2);
}

function when(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace("T", " ");
}

export async function RunBoard({ taskId }: { taskId: string }) {
  const db = sql();
  if (!db) return null;

  let rows;
  try {
    rows = await runsForTask(db, taskId);
  } catch (e) {
    // The board is the least important thing on this page. Losing it must not
    // take the benchmark down with it.
    console.error("[board] could not read runs:", e);
    return null;
  }
  if (rows.length === 0) return null;

  const configs = byPersona(rows);
  const commits = new Set(rows.map((r) => r.task_commit));
  // A task whose judge surfaces a derived result gets a column for it. On the
  // MBTI board that column is the only one that differs: format-only grading
  // hands every well-formed answer a 1.0, so the scores are identical and the
  // types are not.
  const resultKey = configs.find((c) => c.result)?.result?.key ?? null;

  return (
    <section className="flex flex-col gap-3 border-t border-[var(--bd)] pt-6">
      <header className="flex flex-col gap-1.5">
        <h2 className="text-[18px] font-bold tracking-[-0.02em] text-[var(--head)]">
          What has been run here
        </h2>
        <p className="max-w-[64ch] text-[14px] leading-[1.6] text-[var(--sec)]">
          Grouped by configuration and ordered by <strong>median</strong> score
          — not by best, which would reward whoever ran the most times. This is
          a record of which setup did better on the same questions, not a
          ranking of who is strongest: the answers to this task are public, so
          a ranking would be a column of full marks.
          {resultKey && (
            <>
              {" "}
              This task&apos;s judge grades format and derives{" "}
              <strong>{resultKey.replace(/_/g, " ")}</strong>, so the score is
              the same for every valid answer and that column is where the
              configurations actually differ.
            </>
          )}
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse font-mono text-[12px]">
          <thead>
            <tr className="border-y border-[var(--bd)] text-left text-[11px] uppercase tracking-[0.1em] text-[var(--mut)]">
              <th className="py-2 pr-4 font-normal">configuration</th>
              {resultKey && (
                <th className="py-2 pr-4 text-right font-normal">
                  {resultKey.replace(/_/g, " ")}
                </th>
              )}
              <th className="py-2 pr-4 text-right font-normal">median</th>
              <th className="py-2 pr-4 text-right font-normal">range</th>
              <th className="py-2 pr-4 text-right font-normal">runs</th>
              <th className="py-2 text-right font-normal">latest</th>
            </tr>
          </thead>
          <tbody>
            {configs.map((c) => (
              <tr key={`${c.persona} ${c.task_commit}`} className="border-b border-[var(--bdl)]">
                <td className="max-w-[28ch] truncate py-2.5 pr-4 text-[var(--head)]">
                  {c.persona}
                  {c.people.length > 0 && (
                    <span className="text-[var(--mut)]"> · {c.people.join(", ")}</span>
                  )}
                </td>
                {resultKey && (
                  <td className="py-2.5 pr-4 text-right text-[14px] font-semibold text-[var(--head)]">
                    {c.result?.value ?? "—"}
                  </td>
                )}
                <td className="py-2.5 pr-4 text-right text-[14px] text-[var(--sec)]">
                  {c.median === null ? "—" : pct(c.median)}
                </td>
                <td className="py-2.5 pr-4 text-right text-[var(--mut)]">
                  {c.best === null || c.worst === null
                    ? "—"
                    : c.runs === 1
                      ? "—"
                      : `${pct(c.worst)}–${pct(c.best)}`}
                </td>
                <td className="py-2.5 pr-4 text-right text-[var(--sec)]">{c.runs}</td>
                <td className="py-2.5 text-right text-[var(--mut)]">{when(c.latest)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="max-w-[64ch] text-[12px] leading-[1.6] text-[var(--mut)]">
        {/* Said plainly rather than left for someone to discover: sign-in is
            not built yet, so nothing here attests to who ran what. */}
        Nobody is signed in — a name on this board proves only that somebody
        typed it. Runs are grouped per pinned commit as well as per
        configuration
        {commits.size > 1 ? `; this task has runs against ${commits.size} commits` : ""}
        , because a run judged against a different version of the task was not
        asked the same questions.{" "}
        <a href="https://trapstreet.run" target="_blank" rel="noreferrer">
          For an attempt with provenance, run it on trapstreet →
        </a>
      </p>
    </section>
  );
}
