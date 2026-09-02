# mocks

**Let your agent sit the exam.** Real benchmarks from
[trapstreet.run](https://trapstreet.run), answered in your browser by an agent
with [WebMCP](https://webmachinelearning.github.io/webmcp/) — and scored by
**the task's own `judge.py`**, fetched from the commit its leaderboard grades
against and run unmodified in Pyodide.

No install, no CLI, no API key. Built for the
[OpenAI WebMCP Challenge](https://openai.com/webmcp-challenge/).

They are *mocks*: nothing here is submitted anywhere, and the answers to the
real tasks are public at their pinned commits. For evaluation that counts,
run it properly on trapstreet.

## Two kinds of exam

**`/tasks/<id>` — a real board.** The page reads the task's pinned
`repo@commit` from trapstreet's public API, fetches its cases and its judge
from public GitHub, and scores the agent's answers with that judge.

There is **no per-task code in this repository**. Every trapstreet task ships
the same contract — `traptask.yaml` naming the cases, `judge.py` reading
`TRAPTASK_MANIFEST` and printing `{passed, score}` — so a task published
tomorrow becomes attemptable the moment its manifest is readable. Against the
live boards today that is **12 of 15 tasks and 256 cases**; the three
refusals are computed from each task's own judge source (one shells out, two
carry PDF cases), not from a list.

**`/arena` — a question with no answer key anywhere.** The real tasks pin to
public commits, so their expected answers are one search away: fine where
provenance and reproduction do the work, useless for an attempt in a browser.
So the arena mints a fresh instance per seed, computed when the page opens.

Difficulty deliberately does not come from the content. A probe handed a
model an entire synthetic corpus and asked for a three-step lookup: it scored
10/10, and flipping whether the answer sat in the text verbatim moved nothing.
What is hard is *not seeing everything at once* — so each hop's search key
appears **only inside the previous hop's section**, and `search_wiki` returns
titles, never body text:

```
search "vendor onboarding"   → read: handled by the LX-4471 desk     ← a code you did not have
search "LX-4471"             → read: escalates to Regional Controller ← a role you did not have
search "Regional Controller" → read: signed off by Mira Okonkwo       ← the answer
```

One query cannot hand over the next key. Near-miss sections carry the same
vocabulary with different values, so a search that stops at the first
plausible hit produces a confident wrong answer.

## The tools

| Page | Tools |
|---|---|
| `/tasks/<id>` | `get_next_case`, `submit_answer` |
| `/arena` | `search_wiki`, `read_section`, `answer_question` |

`get_next_case` returns a question and deliberately nothing else. The page
holds the expected answers because the judge cannot run without them, and an
agent handed them scores full marks on an attempt that means nothing — a test
asserts the payload carries no `expected` / `verdict` / `gold`.

Every page also works without WebMCP: there is a box to type an answer into,
so a browser with no agent can still sit the exam.

## What it touches

Nothing private. trapstreet's **public API** for the task list and pinned
commits, **public GitHub** for the task files, and Pyodide from a pinned CDN.
No database, no sign-in, no credentials, and no platform source — which is why
this repository is the whole application.

## Local development

```bash
pnpm install
pnpm dev        # http://localhost:3100
pnpm test       # vitest
pnpm typecheck
```

Pyodide (~12 MB) is fetched from its CDN on the first answer, not on page
load, so a visitor who only reads the questions never pays for it. Its version
is pinned to `package.json` by a test — judging on a different Python than the
tests exercise would be a silent lie.
