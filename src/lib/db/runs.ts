import type { Sql } from "./client";

// Reading and writing this site's own run records.
//
// A run is one agent sitting one task once, under one named configuration.
// The configuration is the point: the board is not a ranking of who is
// strongest — the expected answers to these tasks are public, so a ranking
// would be a column of full marks — it is a record of which setup did better
// on the same questions.

export interface CaseRecord {
  case_id: string;
  passed: boolean;
  score: number;
  answer: string;
  metrics: Record<string, unknown>;
}

export interface NewRun {
  task_id: string;
  task_commit: string;
  persona: string;
  score: number | null;
  passed: boolean | null;
  cases: CaseRecord[];
  user_github_id?: string | null;
  user_login?: string | null;
}

export interface RunRow {
  id: string;
  task_id: string;
  task_commit: string;
  persona: string;
  score: number | null;
  passed: boolean | null;
  cases_total: number;
  cases_passed: number;
  user_login: string | null;
  started_at: string;
  /**
   * The judge's metrics for this run's first case. Carried because on a task
   * that grades format only — MBTI scores 1.0 for anything well-formed — the
   * score column says nothing and the derived result is the whole point.
   */
  metrics: Record<string, unknown> | null;
}

/** An answer is kept for reading, not for replay; the full text is unbounded. */
export const ANSWER_LIMIT = 2000;

export async function recordRun(db: Sql, run: NewRun): Promise<string> {
  const casesPassed = run.cases.filter((c) => c.passed).length;

  const rows = (await db`
    insert into runs (
      task_id, task_commit, persona, score, passed,
      cases_total, cases_passed, user_github_id, user_login, finished_at
    ) values (
      ${run.task_id}, ${run.task_commit}, ${run.persona}, ${run.score}, ${run.passed},
      ${run.cases.length}, ${casesPassed},
      ${run.user_github_id ?? null}, ${run.user_login ?? null}, now()
    )
    returning id
  `) as Array<{ id: string }>;

  const id = rows[0]?.id;
  if (!id) throw new Error("the run was not recorded");

  for (const c of run.cases) {
    await db`
      insert into run_cases (run_id, case_id, passed, score, answer, metrics)
      values (
        ${id}, ${c.case_id}, ${c.passed}, ${c.score},
        ${c.answer.slice(0, ANSWER_LIMIT)}, ${JSON.stringify(c.metrics)}
      )
      on conflict (run_id, case_id) do nothing
    `;
  }

  return id;
}

// Postgres timestamps arrive from the driver as Date objects, not as the
// strings RunRow promises. Left alone the lie surfaced downstream as
// `b.latest.localeCompare is not a function` — and only once a second
// configuration existed, because a one-element sort never calls its
// comparator. Normalised here, at the one place rows enter the program.
function isoTime(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return new Date(String(value)).toISOString();
}

export async function runsForTask(db: Sql, taskId: string, limit = 100): Promise<RunRow[]> {
  const rows = (await db`
    select r.id, r.task_id, r.task_commit, r.persona, r.score, r.passed,
           r.cases_total, r.cases_passed, r.user_login, r.started_at,
           (select c.metrics from run_cases c
             where c.run_id = r.id order by c.case_id limit 1) as metrics
      from runs r
     where r.task_id = ${taskId}
     order by r.started_at desc
     limit ${limit}
  `) as unknown as Array<Omit<RunRow, "started_at"> & { started_at: unknown }>;

  return rows.map((r) => ({ ...r, started_at: isoTime(r.started_at) }));
}
