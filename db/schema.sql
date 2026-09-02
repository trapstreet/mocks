-- The mocks board. Applied with `pnpm db:push`, which is the only thing that
-- writes it: a schema kept in the repo and a schema kept in the Neon console
-- drift, and nothing catches the drift until a query fails in production.
--
-- Nothing here mirrors trapstreet. The tasks are shared, the run records are
-- not: what this table holds is what people answered ON THIS SITE, and no row
-- is ever copied in either direction.

create table if not exists runs (
  id             uuid primary key default gen_random_uuid(),

  task_id        text not null,
  -- The commit the task was fetched and judged at. Tasks are pinned per
  -- commit, and a run scored against cf92b66 is not comparable to one scored
  -- against a later version of the same task — without this the board would
  -- silently mix generations and call it a comparison.
  task_commit    text not null,

  -- The A/B axis: what the agent was told, what harness it wore, which model.
  -- The name is the task authors' own (`persona` in the MBTI judge's usage
  -- whitelist) — "same model, different persona renders as two identical
  -- rows" is exactly the problem this column exists to solve. A column, not a
  -- key inside a JSON blob, because every comparison groups on it.
  persona        text not null,

  score          double precision,
  passed         boolean,
  cases_total    integer not null default 0,
  cases_passed   integer not null default 0,

  -- Null until GitHub sign-in lands. The board ships before auth does, and a
  -- run with no name attached is still a usable record of a configuration.
  user_github_id text,
  user_login     text,

  started_at     timestamptz not null default now(),
  finished_at    timestamptz
);

-- The two orderings the board actually asks for: one task's runs, newest
-- first; and one configuration's history, for the A/B comparison.
create index if not exists runs_task_started_idx on runs (task_id, started_at desc);
create index if not exists runs_task_persona_idx on runs (task_id, persona, started_at desc);

create table if not exists run_cases (
  run_id      uuid not null references runs (id) on delete cascade,
  case_id     text not null,

  passed      boolean not null,
  score       double precision not null,
  -- What was submitted, and everything the judge printed about it. The
  -- verdict panel already renders any judge's metrics by shape, so storing
  -- the object whole means a task published tomorrow needs no schema change
  -- to have its result shown on the board.
  answer      text,
  metrics     jsonb,

  answered_at timestamptz not null default now(),

  primary key (run_id, case_id)
);
