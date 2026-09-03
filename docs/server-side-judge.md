# Future: server-side judge

This is a future architecture note, not part of the current WebMCP demo.

The current site is intentionally lightweight: the browser loads a public
trapstreet task bundle, holds the expected files in page state, and runs the
task's `judge.py` in Pyodide. That is acceptable for a mock exam whose pinned
task commit is public, but it means a curious user can inspect the page payload
and find `expected`.

Server-side judging would tighten that boundary.

## What it fixes

- `expected/` files no longer ship to the browser.
- `judge.py` and `grader.py` do not need to run in the front-end page.
- DevTools inspection cannot reveal the answers from this site's payload.
- `submit_answer` can record an answer without returning any per-case verdict.
- Timeouts, memory limits, run sessions, and duplicate-submission rules can live
  in one server-controlled path.

## What it cannot fix

- If a task's pinned public repository contains `expected/`, an agent that is
  intentionally trying to cheat can still fetch the public GitHub commit.
- This protects the WebMCP/browser boundary; it is not a cryptographic defense
  against a networked adversary.

## Shape

1. The browser loads only public attempt data:
   - task title and summary
   - case ids and questions
   - input file handles
   - PDF viewer links
   - no `expected`
   - no judge/grader source

2. `start_run` creates a server-side run session:
   - `run_id`
   - task id and pinned commit
   - configuration name
   - submitted answers
   - one answer per case

3. `submit_answer` records the answer only:
   - no per-case pass/fail
   - no score until the whole set is complete
   - final scoring runs once all cases have answers

4. The server-side judge loads the pinned task bundle:
   - cache by `repo_url + commit_sha + repo_path`
   - hydrate inputs and expected files into a temporary task directory
   - run `judge.py` per case
   - run `grader.py` over all case verdicts when present

5. Judge execution should be isolated:
   - no network access
   - temporary filesystem
   - hard timeout
   - memory limit
   - explicit package allowlist

## Deployment options

- Vercel server functions plus server-side Pyodide may work, but cold starts and
  package size could be painful.
- A small judge worker is cleaner: Fly.io, Railway, Render, or Cloud Run.
- The Next.js app can stay as the WebMCP/UI surface while the worker owns
  execution and scoring.

## Why this also helps performance

The task bundle is pinned by commit, so the server can cache it aggressively.
Instead of every browser loading a full bundle, the page can stream quickly and
only ask the server for the next visible case. The heavy judge assets are paid
for by the worker, not by every visitor's tab.

