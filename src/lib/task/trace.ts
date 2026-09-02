import type { ToolDescriptor } from "./run-tools";

// What the agent did, as a line on the page.
//
// The tools themselves report to the agent and nothing else; without this the
// page jumps from "0/1 answered" straight to a verdict and the whole middle of
// a run is invisible. Someone watching over the agent's shoulder — which is
// the entire point of putting a benchmark in a browser rather than a terminal
// — should see each call land as it happens.
//
// This wraps rather than edits the tools: the payload an agent receives is the
// tool's own return value, untouched. A trace that could change what the agent
// sees would be a trace that changes the run it is documenting.

export type TraceStep =
  | { kind: "fetch"; caseId: string; index: number; total: number }
  | { kind: "exhausted"; answered: number; total: number }
  | { kind: "answer"; caseId: string; answer: string; passed: boolean; score: number }
  | { kind: "graded"; passed: boolean; score: number }
  | { kind: "refused"; tool: string; error: string };

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback = 0) => (typeof v === "number" ? v : fallback);

/** Answers can be long; the trace is a glance, not a transcript. */
export const ELLIPSIS_AT = 120;
export function abbreviate(answer: string, at = ELLIPSIS_AT): string {
  const flat = answer.replace(/\s+/g, " ").trim();
  return flat.length <= at ? flat : `${flat.slice(0, at - 1)}…`;
}

function stepFor(
  tool: string,
  input: Record<string, unknown>,
  out: unknown,
): TraceStep | null {
  if (!out || typeof out !== "object") return null;
  const o = out as Record<string, unknown>;

  // An error is a thing that happened and belongs on the trace: a run that
  // stalls because the agent kept being refused should look stalled, not idle.
  if (typeof o.error === "string") return { kind: "refused", tool, error: o.error };

  if (tool === "get_next_case") {
    if (o.done === true) {
      return { kind: "exhausted", answered: num(o.answered), total: num(o.total) };
    }
    if (typeof o.case_id === "string") {
      return { kind: "fetch", caseId: o.case_id, index: num(o.index), total: num(o.total) };
    }
    return null;
  }

  if (tool === "submit_answer" && typeof o.case_id === "string") {
    return {
      kind: "answer",
      caseId: o.case_id,
      answer: abbreviate(str(input.answer)),
      passed: o.passed === true,
      score: num(o.score),
    };
  }

  return null;
}

/** The grader verdict rides inside the last submit_answer, so it needs its own line. */
function finalStep(out: unknown): TraceStep | null {
  if (!out || typeof out !== "object") return null;
  const fin = (out as Record<string, unknown>).final;
  if (!fin || typeof fin !== "object") return null;
  const f = fin as Record<string, unknown>;
  return { kind: "graded", passed: f.passed === true, score: num(f.score) };
}

export function traceRunTools(
  tools: ToolDescriptor[],
  push: (step: TraceStep) => void,
): ToolDescriptor[] {
  return tools.map((tool) => ({
    ...tool,
    execute: async (input: Record<string, unknown>) => {
      const out = await tool.execute(input);
      // A trace is documentation. If reading the output throws, the agent
      // still gets its answer — losing a line beats losing the call.
      try {
        const step = stepFor(tool.name, input, out);
        if (step) push(step);
        const done = finalStep(out);
        if (done) push(done);
      } catch {
        /* the run matters more than its narration */
      }
      return out;
    },
  }));
}
