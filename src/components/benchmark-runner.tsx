"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildRunTools } from "@/lib/task/run-tools";
import { createJudgeRunner, type CaseResult, type PyRuntime } from "@/lib/task/judge-runner";
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

  // Tool closures are registered once and must see live state, not the
  // state of the render that registered them.
  const payloadRef = useRef<Payload | null>(null);
  const resultsRef = useRef<CaseResult[]>([]);
  payloadRef.current = payload;
  resultsRef.current = results;

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
      setBusy(caseId);
      try {
        const runner = await judgeRunner();
        const result = runner.judgeCase(caseId, answer);
        const next = [...resultsRef.current.filter((r) => r.case_id !== caseId), result];
        resultsRef.current = next;
        setResults(next);
        return result;
      } finally {
        setBusy(null);
      }
    },
    [judgeRunner],
  );

  const grade = useCallback(async () => {
    const runner = await judgeRunner();
    const out = runner.grade(resultsRef.current);
    setFinal(out);
    return out;
  }, [judgeRunner]);

  // WebMCP registration. Inert in every browser that has no modelContext,
  // which today is all of them except ChatGPT's and Chrome behind a flag.
  useEffect(() => {
    const mc = document.modelContext;
    if (typeof mc?.registerTool !== "function") return;

    const controller = new AbortController();
    const undo: Array<() => void> = [];
    const teardown = () => {
      controller.abort();
      undo.splice(0).forEach((fn) => fn());
    };

    const tools = buildRunTools({
      taskId,
      runnable: () => payloadRef.current?.runnable === true,
      reason: () => payloadRef.current?.reason ?? null,
      cases: () => payloadRef.current?.cases ?? [],
      results: () => resultsRef.current,
      judge,
      grade,
    });

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
  }, [taskId, judge, grade]);

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
          reimplementation, no approximation. Nothing here is submitted anywhere: a
          run with no provenance does not belong on a board.
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
          <p className="mt-2 text-[14px] text-[var(--mut)]">
            It still runs locally.{" "}
            <a href="https://trapstreet.run/docs/quickstart" target="_blank" rel="noreferrer">Install the CLI and run it properly on trapstreet →</a>
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
                      <span className={r.passed ? "text-[var(--acc)]" : "text-[var(--sec)]"}>
                        {r.passed ? "passed" : "failed"} · {r.score}
                      </span>
                    )}
                  </div>
                  <pre className="max-h-[16rem] overflow-auto whitespace-pre-wrap text-[13px] leading-[1.55] text-[var(--sec)]">
                    {c.question}
                  </pre>
                  <form
                    className="mt-3 flex flex-col gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setCaseError((m) => ({ ...m, [c.id]: "" }));
                      void judge(c.id, drafts[c.id] ?? "")
                        .then(() => {
                          if (resultsRef.current.length >= cases.length) return grade();
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
