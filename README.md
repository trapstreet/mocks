# mocks

Let your agent sit a trapstreet benchmark in a browser tab.

[mocks.trapstreet.run](https://mocks.trapstreet.run) is a small, public
[WebMCP](https://webmachinelearning.github.io/webmcp/) app for the
[OpenAI WebMCP Challenge](https://openai.com/webmcp-challenge/). It reads real
tasks from [trapstreet.run](https://trapstreet.run), fetches each task's pinned
public `repo@commit`, and scores answers with that task's own `judge.py` in
Pyodide.

These are mock exams. The result can be recorded on this site's own board under
a configuration name, but it is never submitted to trapstreet. For an attempt
with provenance, run the task through `tp` on trapstreet.

## Surfaces

Surface | Use it to
--- | ---
`/tasks/<id>` | Sit a real trapstreet task in the browser. Text cases are handed over directly; PDF cases expose file handles, viewer links, and text-layer helpers.
`/arena` | Try a fresh synthetic wiki-routing question with no public answer key. Search returns titles only, so the agent has to walk the chain.

There is no per-task solution code here. The task page reads `traptask.yaml` for
case ids and directories, uses the pinned `judge.py`/`grader.py`, and refuses a
task only when the browser cannot honestly run what the judge is asking for.

## WebMCP Tools

Page | Tools
--- | ---
`/tasks/<id>` | `start_run`, `get_next_case`, `list_case_files`, `read_pdf_page_text`, `search_pdf_text`, `submit_answer`
`/arena` | `search_wiki`, `read_section`, `answer_question`

`get_next_case` returns the case prompt, position, and file list. It does not
return manifest descriptions, expected answers, verdicts, gold labels, or raw
file URLs. PDF files include a GitHub viewer URL so an agent can inspect the
page visually with its browser. PDF contents stay out of the main payload: an
agent lists files, then either opens the viewer URL or reads/searches the PDF
text layer through separate read-only tools.

`submit_answer` runs the task's own judge against exactly what a solution would
print to stdout. When every case has an answer, the task's grader scores the set.

## Safeguards

Boundary | What happens
--- | ---
Trapstreet data | Reads only trapstreet's public API and public GitHub task files. No trapstreet database, credentials, or platform source.
Expected answers | Kept in page state so the judge can run, but never returned by WebMCP tools.
PDF inputs | Exposed as files and read on demand, not embedded as megabytes of JSON.
Anonymous board writes | Shape-checked, length-limited, rate-limited per IP, and exact duplicate submissions are rejected for a short window.
Browser execution | Pyodide loads only on first answer. Obvious blocking judges are refused until judge execution moves to a worker with a hard timeout.

## Local Development

```bash
pnpm install
pnpm dev        # http://localhost:3100
pnpm test       # vitest
pnpm typecheck
pnpm build
```

The mocks database is optional. Without `DATABASE_URL`, agents can still sit
benchmarks and see judge verdicts; only this site's run board is hidden.

Pyodide is fetched from a pinned CDN on the first answer, not on page load. Its
version is tied to `package.json` by a test so local tests and browser judging
use the same Python runtime.

## License

MIT — see [LICENSE](./LICENSE).
