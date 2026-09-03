import { summarizeVerdict } from "../task/verdict";
import type { RunRow } from "./runs";

// Turning a list of runs into the comparison the board exists to show.
//
// The statistic is the MEDIAN of a configuration's runs, not its best. A best
// rewards whoever ran the most times — one lucky sample beats a steadier
// setup — and the question here is which configuration works better, not
// which one got lucky once. trapstreet's own boards take medians for the same
// reason.
//
// Runs are grouped per (persona, task_commit): the same words in front of the
// model, judged against the same version of the task. A comparison across
// commits is not a comparison, and quietly merging them would be the same
// class of mistake as reading a field the judges never print.

export interface PersonaSummary {
  persona: string;
  task_commit: string;
  runs: number;
  /** Median score, or null when no run of this configuration was scored. */
  median: number | null;
  best: number | null;
  worst: number | null;
  latest: string;
  /** Distinct signed-in names behind these runs; empty while sign-in is off. */
  people: string[];
  /**
   * What the judge derived, when a score cannot say it. The MBTI task grades
   * format only and hands every well-formed answer a 1.0, so a board that
   * showed scores alone would be a column of 1.00 next to two configurations
   * that in fact produced different results. Taken from the most recent run
   * of the configuration, and only for a single-case task, where one result
   * belongs to the whole run.
   */
  result: { key: string; value: string } | null;
  /**
   * How many cases the most recent run of this configuration got right. The
   * score alone does not say it — a task with partial credit can score 0.61
   * from fourteen clean passes or from twenty-three near misses, and those are
   * not the same run. Taken from the latest run, like `result`.
   */
  cases: { passed: number; total: number } | null;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function newest(rs: RunRow[]): RunRow {
  return rs.reduce((a, r) => (r.started_at > a.started_at ? r : a), rs[0]);
}

function headlineResult(rs: RunRow[]): { key: string; value: string } | null {
  const latest = newest(rs);
  if (latest.cases_total !== 1 || !latest.metrics) return null;
  // Sorted by shape, exactly as the verdict panel does it — nothing here
  // knows what an MBTI type is, only that the judge surfaced a scalar.
  return summarizeVerdict(latest.metrics).facets[0] ?? null;
}

export function byPersona(rows: RunRow[]): PersonaSummary[] {
  const groups = new Map<string, RunRow[]>();
  for (const r of rows) {
    const key = `${r.persona} ${r.task_commit}`;
    const at = groups.get(key);
    if (at) at.push(r);
    else groups.set(key, [r]);
  }

  const out: PersonaSummary[] = [];
  for (const rs of groups.values()) {
    const scored = rs
      .map((r) => r.score)
      .filter((s): s is number => typeof s === "number");
    out.push({
      persona: rs[0].persona,
      task_commit: rs[0].task_commit,
      runs: rs.length,
      median: median(scored),
      best: scored.length ? Math.max(...scored) : null,
      worst: scored.length ? Math.min(...scored) : null,
      latest: rs.reduce((a, r) => (r.started_at > a ? r.started_at : a), rs[0].started_at),
      people: [...new Set(rs.map((r) => r.user_login).filter((n): n is string => !!n))],
      result: headlineResult(rs),
      cases:
        newest(rs).cases_total > 0
          ? { passed: newest(rs).cases_passed, total: newest(rs).cases_total }
          : null,
    });
  }

  // Best median first; an unscored configuration sorts last rather than as a
  // zero, because "never produced a score" is not the same as "scored zero".
  return out.sort((a, b) => {
    if (a.median === null && b.median === null) return b.latest.localeCompare(a.latest);
    if (a.median === null) return 1;
    if (b.median === null) return -1;
    if (b.median !== a.median) return b.median - a.median;
    // A configuration proven over more runs outranks one that matched it once.
    if (b.runs !== a.runs) return b.runs - a.runs;
    return b.latest.localeCompare(a.latest);
  });
}
