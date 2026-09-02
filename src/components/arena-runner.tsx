"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { generateQuiz, type Quiz } from "@/lib/quiz/generate";
import { buildQuizTools } from "@/lib/quiz/tools";

// A benchmark instance minted for this visit.
//
// Every other board here grades against a public commit, which means its
// expected answers are one search away. That is fine where provenance and
// reproduction do the work, and useless for an attempt made in a browser
// where nothing can be verified. This instance is computed from a seed and
// exists nowhere else, so there is no answer key to find.
//
// The page shows every search and every section opened. That trace is the
// point: a leaderboard tells you who won, and this tells you how.

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

type Step =
  | { kind: "search"; query: string; hits: number }
  | { kind: "read"; id: string; title: string }
  | { kind: "answer"; answer: string; correct: boolean };

export function ArenaRunner({ seed, hops }: { seed: number; hops: number }) {
  const quiz = useMemo<Quiz>(() => generateQuiz({ seed, hops }), [seed, hops]);

  const [steps, setSteps] = useState<Step[]>([]);
  const [settled, setSettled] = useState<null | { correct: boolean; reads: number }>(null);
  const [hasAgent, setHasAgent] = useState(false);

  // Tools register once; their closures must see live state.
  const quizRef = useRef(quiz);
  const readsRef = useRef<string[]>([]);
  quizRef.current = quiz;

  // A new instance is a new attempt.
  useEffect(() => {
    readsRef.current = [];
    setSteps([]);
    setSettled(null);
  }, [seed, hops]);

  const push = useCallback((s: Step) => setSteps((prev) => [...prev, s]), []);

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

    const tools = buildQuizTools({
      quiz: () => quizRef.current,
      reads: () => readsRef.current,
      onRead: (id) => {
        if (!readsRef.current.includes(id)) readsRef.current.push(id);
        const s = quizRef.current.sections.find((x) => x.id === id);
        push({ kind: "read", id, title: s?.title ?? id });
      },
      onAnswer: (answer, correct) => {
        push({ kind: "answer", answer, correct });
        setSettled({ correct, reads: readsRef.current.length });
      },
    });

    // The trace is the demo, so a search has to show up on screen even
    // though the tool itself only reports hits back to the agent.
    const traced = tools.map((t) =>
      t.name !== "search_wiki"
        ? t
        : {
            ...t,
            execute: async (input: Record<string, unknown>) => {
              const out = (await t.execute(input)) as { results?: unknown[] };
              push({
                kind: "search",
                query: String(input.query ?? ""),
                hits: out.results?.length ?? 0,
              });
              return out;
            },
          },
    );

    void (async () => {
      try {
        for (const tool of traced) {
          const handle = await mc.registerTool!(tool, { signal: controller.signal });
          if (handle?.unregister) undo.push(() => handle.unregister!());
        }
      } catch (e) {
        console.warn("[webmcp] tool registration failed:", e);
        teardown();
      }
    })();

    return teardown;
  }, [push]);

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="text-[24px] font-bold tracking-[-0.03em] text-[var(--head)]">
          One question. No answer key anywhere.
        </h1>
        <p className="max-w-[64ch] text-[14px] leading-[1.65] text-[var(--sec)]">
          Every board on this site grades against a public commit, so its
          expected answers are one search away — fine where provenance and
          reproduction do the work, useless for an attempt in a browser. This
          instance was computed from seed{" "}
          <span className="font-mono text-[var(--head)]">{seed}</span> when you
          opened the page and exists nowhere else. There is nothing to look up.
        </p>
      </header>

      <div className="border border-[var(--bd)] bg-[var(--deep)] p-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--mut)]">
          the question
        </p>
        <p className="mt-2 text-[15px] leading-[1.6] text-[var(--head)]">{quiz.question}</p>
        <p className="mt-3 text-[13px] leading-[1.6] text-[var(--mut)]">
          The wiki is {quiz.sections.length} sections. Search returns titles
          only — what to search for next is written inside the sections, so the
          chain has to be walked, not guessed.
        </p>
      </div>

      {!hasAgent && (
        <p className="border border-[var(--bd)] p-3.5 text-[14px] leading-[1.6] text-[var(--sec)]">
          This browser has no WebMCP, so no tools are registered. Open the page
          in ChatGPT&apos;s built-in browser and ask it to answer the question —
          it will search and read on its own, and every step will appear below.
        </p>
      )}

      <div className="flex flex-col gap-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--mut)]">
          what the agent did {steps.length > 0 && `· ${steps.length} steps`}
        </p>
        {steps.length === 0 ? (
          <p className="font-mono text-[12px] text-[var(--mut)]">nothing yet</p>
        ) : (
          <ol className="flex flex-col gap-1.5 font-mono text-[12px]">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-2.5 text-[var(--sec)]">
                <span className="text-[var(--mut)]">{String(i + 1).padStart(2, "0")}</span>
                {s.kind === "search" && (
                  <span>
                    searched <span className="text-[var(--head)]">{s.query}</span> · {s.hits}{" "}
                    {s.hits === 1 ? "title" : "titles"}
                  </span>
                )}
                {s.kind === "read" && (
                  <span>
                    opened <span className="text-[var(--head)]">{s.title}</span>
                  </span>
                )}
                {s.kind === "answer" && (
                  <span className={s.correct ? "text-[var(--acc)]" : ""}>
                    answered <span className="text-[var(--head)]">{s.answer}</span> ·{" "}
                    {s.correct ? "correct" : "wrong"}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {settled && (
        <div className="border border-[var(--bd)] p-4">
          <p className="text-[15px] text-[var(--head)]">
            {settled.correct ? "Solved it." : "Did not get there."}{" "}
            <span className="text-[var(--sec)]">
              {settled.reads} of {quiz.sections.length} sections read; the chain is{" "}
              {quiz.chain.length} deep.
            </span>
          </p>
          <p className="mt-2 text-[13px] text-[var(--mut)]">
            <a href={`/arena?seed=${seed + 1}&hops=${hops}`}>Another instance →</a>
            {"  ·  "}
            <a href={`/arena?seed=${seed}&hops=${hops + 1}`}>One hop deeper →</a>
          </p>
        </div>
      )}
    </section>
  );
}
