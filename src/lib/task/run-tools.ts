// The two tools that let an agent sit the benchmark itself.
//
// The page holds the task bundle — questions AND expected answers, since the
// judge cannot run without them — and these tools are the seam that keeps the
// second half away from the agent. A model handed the expected verdict scores
// full marks and the result means nothing, so `get_next_case` returns the
// question and only the question.
//
// Everything arrives through RunToolDeps: no browser globals, no Pyodide, so
// the behaviour below is testable without either.

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
  annotations?: { readOnlyHint?: boolean };
  execute: (inputs: Record<string, unknown>) => Promise<unknown>;
}

export interface RunToolDeps {
  taskId: string;
  runnable(): boolean;
  reason(): string | null;
  cases(): Array<{ id: string; description: string; question: string }>;
  results(): Array<{ case_id: string; passed: boolean; score: number }>;
  judge(
    caseId: string,
    answer: string,
  ): Promise<{ case_id: string; passed: boolean; score: number }>;
  grade(): Promise<{ passed: boolean; score: number }>;
}

const message = (e: unknown) =>
  e instanceof Error ? e.message : "the judge could not be run";

export function buildRunTools(deps: RunToolDeps): ToolDescriptor[] {
  const answered = () => new Set(deps.results().map((r) => r.case_id));
  const blocked = () =>
    deps.runnable()
      ? null
      : {
          error:
            deps.reason() ??
            "this task cannot be attempted in a browser — run it locally with tp",
        };

  return [
    {
      name: "get_next_case",
      description:
        "Fetch the next unanswered case of this benchmark: its question, its " +
        "position in the set, and how many cases there are. Returns the " +
        "question only — the expected answer is never included, because an " +
        "agent that is handed it scores full marks and the attempt means " +
        "nothing. Call submit_answer with your answer, then call this again.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: async () => {
        const stop = blocked();
        if (stop) return stop;

        const done = answered();
        const cases = deps.cases();
        const index = cases.findIndex((c) => !done.has(c.id));
        if (index === -1) {
          return {
            done: true,
            answered: done.size,
            total: cases.length,
            note: "every case has an answer — the task's grader has scored the set.",
          };
        }
        const c = cases[index];
        return {
          case_id: c.id,
          index: index + 1,
          total: cases.length,
          description: c.description,
          question: c.question,
        };
      },
    },
    {
      name: "submit_answer",
      description:
        "Answer one case. The answer is scored on this page by the task's own " +
        "judge.py, fetched from the commit the leaderboard grades against and " +
        "run unmodified — the same scoring a local `tp run` would apply. " +
        "Returns whether the case passed and how far through the set you are.",
      inputSchema: {
        type: "object",
        properties: {
          case_id: {
            type: "string",
            description: "The case_id given by get_next_case.",
          },
          answer: {
            type: "string",
            description:
              "Exactly what a solution would print to stdout. Formatting " +
              "instructions in the question are part of what the judge checks.",
          },
        },
        required: ["case_id", "answer"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: async ({ case_id, answer }) => {
        const stop = blocked();
        if (stop) return stop;

        const cases = deps.cases();
        const id = String(case_id);
        if (!cases.some((c) => c.id === id)) {
          return {
            error: `no case "${id}" on this task — call get_next_case for the current one`,
          };
        }

        let result;
        try {
          result = await deps.judge(id, String(answer ?? ""));
        } catch (e) {
          // A judge that crashed did not score a failure — saying so would
          // put a zero on the board for a fault that is ours, not the answer's.
          return { error: message(e) };
        }

        const answeredNow = answered();
        const total = cases.length;
        const complete = answeredNow.size >= total;

        return {
          case_id: id,
          passed: result.passed,
          score: result.score,
          answered: answeredNow.size,
          total,
          ...(complete ? { final: await deps.grade() } : {}),
        };
      },
    },
  ];
}
