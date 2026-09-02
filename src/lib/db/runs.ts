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

export async function runsForTask(db: Sql, taskId: string, limit = 100): Promise<RunRow[]> {
  return (await db`
    select id, task_id, task_commit, persona, score, passed,
           cases_total, cases_passed, user_login, started_at
      from runs
     where task_id = ${taskId}
     order by started_at desc
     limit ${limit}
  `) as unknown as RunRow[];
}
