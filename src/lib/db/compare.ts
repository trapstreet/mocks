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
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
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
