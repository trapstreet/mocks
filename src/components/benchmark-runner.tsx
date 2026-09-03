"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { buildRunTools } from "@/lib/task/run-tools";
import { traceRunTools, abbreviate, type TraceStep } from "@/lib/task/trace";
import { VerdictPanel } from "./verdict-panel";
import { createJudgeRunner, type CaseResult, type PyRuntime } from "@/lib/task/judge-runner";
import { createPdfReader } from "@/lib/task/pdf-reader";
import { PYODIDE_INDEX_URL } from "@/lib/pyodide-cdn";
import type { TaskBundle } from "@/lib/task/fetch-task";

// Sit a trapstreet benchmark in the browser, scored by the task's own judge.
//
// The page holds the whole bundle — questions and expected answers, because
// the judge needs both — and the WebMCP tools registered here hand an agent
// the questions only. Nothing is submitted to the leaderboard: a run with no
// provenance has no business on a board whose whole claim is provenance.

type Payload = TaskBundle & {
  task: { id: string; title: string; commit_sha?: string; repo_url?: string; repo_path?: string };
};

type Phase = "loading" | "ready" | "unavailable" | "error";

declare global {
  interface Document {
    modelContext?: {
      registerTool?: (
        tool: unknown,
        options?: { signal?: AbortSignal },
      ) => Promise<{ unregister?: () => void } | void>;
    };
  }
}

export function BenchmarkRunner({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [failure, setFailure] = useState<string | null>(null);
  const [results, setResults] = useState<CaseResult[]>([]);
  const [final, setFinal] = useState<{ passed: boolean; score: number } | null>(null);
  const [python, setPython] = useState<"idle" | "loading" | "ready">("idle");
  const [busy, setBusy] = useState<string | null>(null);
  // Typed answers, so the page works for a visitor whose browser has no
  // WebMCP — and so a failed tool registration degrades to "answer it
  // yourself" rather than to a page that can only be read.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // A judge that crashes is our fault, not the answer's — show what broke
  // rather than letting it surface as an unhandled rejection and scoring
  // nothing.
  const [caseError, setCaseError] = useState<Record<string, string>>({});
  // What the agent did, in order. Without it the page jumps from "0/1
  // answered" to a verdict and the middle of the run is invisible — which is
  // most of the reason to sit a benchmark in a browser rather than a terminal.
  const [steps, setSteps] = useState<TraceStep[]>([]);
  // The A/B axis: what this agent was running under. Typed here, or named by
  // the agent itself through start_run. Without one a run is still scored —
  // it just has nothing to be compared against, so it is not recorded.
  const [persona, setPersona] = useState("");
  const [saved, setSaved] = useState<null | { ok: boolean; detail: string }>(null);
  const [hasAgent, setHasAgent] = useState(false);
  const push = useCallback((s: TraceStep) => setSteps((prev) => [...prev, s]), []);

  // Tool closures are registered once and must see live state, not the
  // state of the render that registered them.
  const payloadRef = useRef<Payload | null>(null);
  const resultsRef = useRef<CaseResult[]>([]);
  const personaRef = useRef("");
  // What was actually submitted per case. The results carry the verdict, not
  // the answer, and the board keeps both.
  const answersRef = useRef<Record<string, string>>({});
  const pdfRef = useRef<ReturnType<typeof createPdfReader> | null>(null);
  payloadRef.current = payload;
  resultsRef.current = results;
  personaRef.current = persona;
  if (!pdfRef.current) {
    pdfRef.current = createPdfReader(() => payloadRef.current?.cases.flatMap((c) => c.files) ?? []);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/benchmark/${encodeURIComponent(taskId)}`);
        const body = (await res.json()) as Payload & { error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setFailure(body.error ?? `could not load this task (${res.status})`);
          setPhase("error");
          return;
        }
        setPayload(body);
        setPhase(body.runnable ? "ready" : "unavailable");
      } catch (e) {
        if (!cancelled) {
          setFailure(e instanceof Error ? e.message : "could not load this task");
          setPhase("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // Pyodide is ~12 MB, so it is fetched on the first answer rather than on
  // page load — a visitor who only reads the questions never pays for it.
  const runnerRef = useRef<ReturnType<typeof createJudgeRunner> | null>(null);
  const bootRef = useRef<Promise<ReturnType<typeof createJudgeRunner>> | null>(null);

  const judgeRunner = useCallback(async () => {
    if (runnerRef.current) return runnerRef.current;
    if (bootRef.current) return bootRef.current;
    const bundle = payloadRef.current;
    if (!bundle) throw new Error("the task has not finished loading");

    setPython("loading");
    bootRef.current = (async () => {
      const mod = (await import(
        /* webpackIgnore: true */ `${PYODIDE_INDEX_URL}pyodide.mjs`
      )) as { loadPyodide: (o: { indexURL: string }) => Promise<PyRuntime> };
      const py = await mod.loadPyodide({ indexURL: PYODIDE_INDEX_URL });
      // Some stdlib modules are inert without their data package — zoneinfo
      // imports and then fails every lookup until tzdata is loaded.
      for (const name of bundle.packages ?? []) {
        await (py as unknown as { loadPackage(n: string): Promise<void> }).loadPackage(name);
      }
      const runner = createJudgeRunner(py, bundle);
      runnerRef.current = runner;
      setPython("ready");
      return runner;
    })();
    return bootRef.current;
  }, []);

  const judge = useCallback(
    async (caseId: string, answer: string) => {
      if (resultsRef.current.some((r) => r.case_id === caseId)) {
        throw new Error("this case already has an answer in this run");
      }
      setBusy(caseId);
      try {
        const runner = await judgeRunner();
        const result = runner.judgeCase(caseId, answer);
        answersRef.current[caseId] = answer;
        const next = [...resultsRef.current, result];
        resultsRef.current = next;
        setResults(next);
        return result;
      } finally {
        setBusy(null);
      }
    },
    [judgeRunner],
  );

  // Recording happens here rather than in either caller, because answering by
  // tool and answering by hand are the same run and must be saved the same
  // way. It is deliberately not awaited by the tool: an agent should get its
  // verdict back whether or not this site's board is reachable.
  const record = useCallback(
    async (final: { passed: boolean; score: number }) => {
      const bundle = payloadRef.current;
      const name = personaRef.current.trim();
      if (!bundle) return;
      if (!name) {
        const detail = "not recorded — name the configuration to put it on the board";
        setSaved({ ok: false, detail });
        push({ kind: "recorded", ok: false, detail });
        return;
      }
      try {
        const res = await fetch("/api/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            task_id: bundle.task.id,
            task_commit: bundle.task.commit_sha,
            persona: name,
            score: final.score,
            passed: final.passed,
            cases: resultsRef.current.map((r) => ({
              case_id: r.case_id,
              passed: r.passed,
              score: r.score,
              answer: answersRef.current[r.case_id] ?? "",
              metrics: r.metrics,
            })),
          }),
        });
        const body = (await res.json()) as { error?: string };
        const detail = res.ok
          ? `recorded as "${name}"`
          : `not recorded — ${body.error ?? res.status}`;
        setSaved({ ok: res.ok, detail });
        push({ kind: "recorded", ok: res.ok, detail });
        // The board below is server-rendered; without this the run that was
        // just recorded is missing from it until someone reloads.
        if (res.ok) router.refresh();
      } catch (e) {
        const detail = `not recorded — ${e instanceof Error ? e.message : "the board is unreachable"}`;
        setSaved({ ok: false, detail });
        push({ kind: "recorded", ok: false, detail });
      }
    },
    [push, router],
  );

  const grade = useCallback(async () => {
    const runner = await judgeRunner();
    const out = runner.grade(resultsRef.current);
    setFinal(out);
    void record(out);
    return out;
  }, [judgeRunner, record]);

  // WebMCP registration. Inert in every browser that has no modelContext,
  // which today is all of them except ChatGPT's and Chrome behind a flag.
  useEffect(() => {
    const mc = document.modelContext;
    if (typeof mc?.registerTool !== "function") return;
    setHasAgent(true);

    const controller = new AbortController();
    const undo: Array<() => void> = [];
    const teardown = () => {
      controller.abort();
      undo.splice(0).forEach((fn) => fn());
    };

    const tools = traceRunTools(
      buildRunTools({
        taskId,
        persona: () => personaRef.current,
        setPersona,
        runnable: () => payloadRef.current?.runnable === true,
        reason: () => payloadRef.current?.reason ?? null,
        cases: () => payloadRef.current?.cases ?? [],
        results: () => resultsRef.current,
        readPdfPageText: (caseId, fileId, page) => pdfRef.current!.readPage(caseId, fileId, page),
        searchPdfText: (caseId, fileId, query) => pdfRef.current!.search(caseId, fileId, query),
        judge,
        grade,
      }),
      push,
    );

    void (async () => {
      try {
        for (const tool of tools) {
          const handle = await mc.registerTool!(tool, { signal: controller.signal });
          if (handle?.unregister) undo.push(() => handle.unregister!());
        }
      } catch (e) {
        console.warn("[webmcp] tool registration failed:", e);
        teardown();
      }
    })();

    return teardown;
  }, [taskId, judge, grade, push]);

  const cases = payload?.cases ?? [];
  const byId = new Map(results.map((r) => [r.case_id, r]));
  const answered = results.length;
  const passed = results.filter((r) => r.passed).length;

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-1.5">
        <h2 className="text-[18px] font-bold tracking-[-0.02em] text-[var(--head)]">
          Sit this benchmark here
        </h2>
        <p className="max-w-[62ch] text-[14px] leading-[1.6] text-[var(--sec)]">
          An agent with WebMCP can answer these cases on this page. Answers are
          scored by <strong>this task&apos;s own judge</strong>, fetched from the
          commit the leaderboard grades against and run unmodified — no
          reimplementation, no approximation. What you answer goes on{" "}
          <em className="not-italic text-[var(--sec)]">this site&apos;s</em> board,
          under the configuration you name — never on trapstreet&apos;s, where a
          run with no provenance does not belong.
        </p>
      </header>

      {phase === "loading" && (
        <p className="font-mono text-[12px] text-[var(--mut)]">reading the task…</p>
      )}

      {phase === "error" && (
        <p className="text-[14px] text-[var(--sec)]">{failure}</p>
      )}

      {phase === "unavailable" && (
        <div className="border border-[var(--bd)] bg-[var(--deep)] p-4">
          <p className="text-[14px] leading-[1.6] text-[var(--sec)]">
            This one cannot be attempted in a browser — {payload?.reason}.
          </p>
          <p className="mt-2 text-[14px] leading-[1.6] text-[var(--mut)]">
            It still runs properly elsewhere.{" "}
            {payload?.alternative && (
              <>
                <a href={payload.alternative.href} target="_blank" rel="noreferrer">
                  {payload.alternative.label} →
                </a>
                {" · "}
              </>
            )}
            <a href="https://trapstreet.run/docs/quickstart" target="_blank" rel="noreferrer">
              Install the CLI and run it on trapstreet →
            </a>
          </p>
        </div>
      )}

      {phase === "ready" && (
        <>
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-y border-[var(--bd)] py-2.5 font-mono text-[12px] text-[var(--mut)]">
            <span>
              {answered}/{cases.length} answered
            </span>
            <span>{passed} passed</span>
            {final && (
              <span className="text-[var(--head)]">
                grader: {final.score.toFixed(3)} · {final.passed ? "passed" : "failed"}
              </span>
            )}
            {python === "loading" && <span>loading Python…</span>}
            {saved && (
              <span className={saved.ok ? "text-[var(--ok)]" : "text-[var(--mut)]"}>
                {saved.detail}
              </span>
            )}
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--mut)]">
              configuration
            </span>
            <input
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              maxLength={60}
              spellCheck={false}
              placeholder="e.g. gpt-5.6 baseline — or let the agent name it with start_run"
              className="w-full max-w-[52ch] border border-[var(--bd)] bg-[var(--deep)] p-2 font-mono text-[12px] text-[var(--sec)] focus:border-[var(--btn)] focus:outline-none"
            />
            <span className="max-w-[62ch] text-[12px] leading-[1.55] text-[var(--mut)]">
              The board groups runs by this name, so sitting the same task
              twice under two names is how you compare them. Leave it empty and
              the run is still scored — it just is not recorded, because there
              is nothing to compare it with.
            </span>
          </label>

          <div className="flex flex-col gap-2">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--mut)]">
              what the agent did {steps.length > 0 && `· ${steps.length} steps`}
            </p>
            {steps.length === 0 ? (
              <p className="font-mono text-[12px] leading-[1.6] text-[var(--mut)]">
                {hasAgent
                  ? "nothing yet — ask your agent to sit this benchmark"
                  : "this browser has no WebMCP, so no tools are registered. Open the page in ChatGPT’s built-in browser and ask it to answer — every call will appear here. You can also answer by hand below."}
              </p>
            ) : (
              <ol className="flex flex-col gap-1.5 font-mono text-[12px]">
                {steps.map((s, i) => (
                  <li key={i} className="flex gap-2.5 text-[var(--sec)]">
                    <span className="text-[var(--mut)]">{String(i + 1).padStart(2, "0")}</span>
                    {s.kind === "persona" && (
                      <span>
                        running as <span className="text-[var(--head)]">{s.persona}</span>
                      </span>
                    )}
                    {s.kind === "recorded" && (
                      <span className={s.ok ? "text-[var(--ok)]" : "text-[var(--mut)]"}>
                        {s.detail}
                      </span>
                    )}
                    {s.kind === "fetch" && (
                      <span>
                        took case <span className="text-[var(--head)]">{s.caseId}</span> · {s.index}/
                        {s.total}
                      </span>
                    )}
                    {s.kind === "files" && (
                      <span>
                        listed files for <span className="text-[var(--head)]">{s.caseId}</span> ·{" "}
                        {s.count}
                      </span>
                    )}
                    {s.kind === "pdfRead" && (
                      <span>
                        read PDF page <span className="text-[var(--head)]">{s.page}</span>/
                        {s.pages} · {s.fileId}
                      </span>
                    )}
                    {s.kind === "pdfSearch" && (
                      <span>
                        searched PDF for <span className="text-[var(--head)]">{s.query}</span> ·{" "}
                        {s.hits} hits
                      </span>
                    )}
                    {s.kind === "answer" && (
                      <span className={s.passed ? "text-[var(--ok)]" : "text-[var(--bad)]"}>
                        answered <span className="text-[var(--head)]">{s.answer}</span> ·{" "}
                        {s.passed ? "passed" : "failed"}
                      </span>
                    )}
                    {s.kind === "graded" && (
                      <span className="text-[var(--head)]">
                        grader scored the set · {s.score.toFixed(3)}
                      </span>
                    )}
                    {s.kind === "exhausted" && (
                      <span>
                        no cases left · {s.answered}/{s.total} answered
                      </span>
                    )}
                    {s.kind === "refused" && (
                      <span className="text-[var(--mut)]">
                        {s.tool} refused · {s.error}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>

          <ol className="flex flex-col gap-3">
            {cases.map((c, i) => {
              const r = byId.get(c.id);
              return (
                <li key={c.id} className="border border-[var(--bd)] p-3.5">
                  <div className="mb-2 flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--mut)]">
                    <span>
                      {i + 1}/{cases.length}
                    </span>
                    <span className="text-[var(--sec)]">{c.id}</span>
                    {busy === c.id && <span>judging…</span>}
                    {r && (
                      <span className={r.passed ? "text-[var(--ok)]" : "text-[var(--bad)]"}>
                        {r.passed ? "passed" : "failed"} · {r.score}
                      </span>
                    )}
                  </div>
                  <pre className="max-h-[16rem] overflow-auto whitespace-pre-wrap text-[13px] leading-[1.55] text-[var(--sec)]">
                    {c.question ||
                      "The prompt and source are in the case PDF. Use the PDF tools, or open the file below."}
                  </pre>
                  {c.files?.some((f) => f.kind === "pdf") && (
                    <div className="mt-2 flex flex-col gap-1 border-t border-[var(--bdl)] pt-2 font-mono text-[12px] text-[var(--mut)]">
                      <span>case files</span>
                      {c.files.map((f) => (
                        <a
                          key={f.id}
                          href={f.kind === "pdf" ? f.view_url : f.url}
                          target="_blank"
                          rel="noreferrer"
                          className="break-all text-[var(--sec)]"
                        >
                          {f.name} · {f.kind}
                        </a>
                      ))}
                    </div>
                  )}
                  <form
                    className="mt-3 flex flex-col gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setCaseError((m) => ({ ...m, [c.id]: "" }));
                      const typed = drafts[c.id] ?? "";
                      void judge(c.id, typed)
                        .then(async (r) => {
                          // Answering by hand is the same run as answering by
                          // tool, so it belongs on the same trace.
                          push({
                            kind: "answer",
                            caseId: c.id,
                            answer: abbreviate(typed),
                            passed: r.passed,
                            score: r.score,
                          });
                          if (resultsRef.current.length >= cases.length) {
                            const fin = await grade();
                            push({ kind: "graded", passed: fin.passed, score: fin.score });
                          }
                        })
                        .catch((err: unknown) =>
                          setCaseError((m) => ({
                            ...m,
                            [c.id]:
                              err instanceof Error ? err.message : "the judge could not be run",
                          })),
                        );
                    }}
                  >
                    <textarea
                      value={drafts[c.id] ?? ""}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [c.id]: e.target.value }))
                      }
                      rows={3}
                      spellCheck={false}
                      placeholder="Answer exactly as a solution would print it to stdout"
                      className="w-full border border-[var(--bd)] bg-[var(--deep)] p-2 font-mono text-[12px] text-[var(--sec)]"
                    />
                    <button
                      type="submit"
                      disabled={busy !== null}
                      className="self-start border border-[var(--bd)] px-3 py-1.5 font-mono text-[12px] text-[var(--sec)] hover:border-[var(--btn)] disabled:opacity-50"
                    >
                      {busy === c.id ? "judging…" : "score this answer"}
                    </button>
                    {r && <VerdictPanel metrics={r.metrics} />}
                    {caseError[c.id] && (
                      <p className="font-mono text-[12px] text-[var(--sec)]">
                        the judge failed on this one: {caseError[c.id]}
                      </p>
                    )}
                  </form>
                </li>
              );
            })}
          </ol>

          <p className="text-[13px] leading-[1.6] text-[var(--mut)]">
            Want an attempt that counts? A local run carries provenance and can
            reach the leaderboard.{" "}
            <a href="https://trapstreet.run/docs/quickstart" target="_blank" rel="noreferrer">Run it with tp on trapstreet →</a>
          </p>
        </>
      )}
    </section>
  );
}
