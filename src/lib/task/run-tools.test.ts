import { describe, expect, it, vi } from "vitest";
import { buildRunTools, type RunToolDeps } from "./run-tools";

const CASES = [
  { id: "c1", description: "first", question: "walk or drive?" },
  { id: "c2", description: "second", question: "second question" },
];

function deps(over: Partial<RunToolDeps> = {}): RunToolDeps {
  const results: Array<{ case_id: string; passed: boolean; score: number }> = [];
  return {
    taskId: "karpathys-jagged-questions",
    runnable: () => true,
    reason: () => null,
    cases: () => CASES,
    results: () => results,
    judge: vi.fn(async (caseId: string, answer: string) => {
      const r = { case_id: caseId, passed: /^drive/i.test(answer.trim()), score: 0, metrics: {} };
      r.score = r.passed ? 1 : 0;
      results.push(r);
      return r;
    }),
    grade: vi.fn(async () => ({
      passed: results.every((r) => r.passed),
      score: results.length ? results.reduce((a, b) => a + b.score, 0) / results.length : 0,
    })),
    ...over,
  };
}

const tool = (d: RunToolDeps, name: string) => {
  const t = buildRunTools(d).find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};

describe("get_next_case", () => {
  it("hands over the question and nothing that gives the answer away", async () => {
    const d = deps();
    const out = (await tool(d, "get_next_case").execute({})) as Record<string, unknown>;

    expect(out).toMatchObject({ case_id: "c1", index: 1, total: 2, question: "walk or drive?" });
    // The whole point of the exercise: an agent handed the expected answer
    // scores full marks and the result means nothing.
    expect(JSON.stringify(out)).not.toMatch(/expected|verdict|gold|answer_key/i);
  });

  it("moves on once a case has been answered", async () => {
    const d = deps();
    await tool(d, "submit_answer").execute({ case_id: "c1", answer: "DRIVE" });
    expect(await tool(d, "get_next_case").execute({})).toMatchObject({ case_id: "c2" });
  });

  it("reports completion instead of looping on the last case", async () => {
    const d = deps();
    for (const c of CASES) {
      await tool(d, "submit_answer").execute({ case_id: c.id, answer: "DRIVE" });
    }
    expect(await tool(d, "get_next_case").execute({})).toMatchObject({ done: true });
  });

  it("explains a task that cannot be attempted here rather than offering it", async () => {
    const d = deps({ runnable: () => false, reason: () => "its cases carry .pdf inputs" });
    expect(await tool(d, "get_next_case").execute({})).toMatchObject({
      error: expect.stringContaining(".pdf"),
    });
  });
});

describe("submit_answer", () => {
  it("scores with the task's judge and reports progress", async () => {
    const d = deps();
    const out = (await tool(d, "submit_answer").execute({
      case_id: "c1",
      answer: "DRIVE — the car has to get there",
    })) as Record<string, unknown>;

    expect(d.judge).toHaveBeenCalledWith("c1", "DRIVE — the car has to get there");
    expect(out).toMatchObject({ case_id: "c1", passed: true, score: 1, answered: 1, total: 2 });
  });

  it("reports a failure as a result, not as an error", async () => {
    const d = deps();
    expect(await tool(d, "submit_answer").execute({ case_id: "c1", answer: "WALK" })).toMatchObject(
      { passed: false, score: 0 },
    );
  });

  it("refuses a case id that is not on this task", async () => {
    const d = deps();
    expect(await tool(d, "submit_answer").execute({ case_id: "nope", answer: "x" })).toMatchObject({
      error: expect.stringContaining("nope"),
    });
    expect(d.judge).not.toHaveBeenCalled();
  });

  it("surfaces a judge that blew up instead of scoring it as a failure", async () => {
    const d = deps({
      judge: vi.fn(async () => {
        throw new Error("the judge printed nothing");
      }),
    });
    expect(await tool(d, "submit_answer").execute({ case_id: "c1", answer: "x" })).toMatchObject({
      error: expect.stringContaining("printed nothing"),
    });
  });

  it("runs the task's grader once every case has an answer", async () => {
    const d = deps();
    await tool(d, "submit_answer").execute({ case_id: "c1", answer: "DRIVE" });
    const last = (await tool(d, "submit_answer").execute({
      case_id: "c2",
      answer: "WALK",
    })) as Record<string, unknown>;

    expect(d.grade).toHaveBeenCalled();
    expect(last.final).toMatchObject({ passed: false, score: 0.5 });
  });
});

describe("tool descriptors", () => {
  it("declares both tools with closed schemas", () => {
    const tools = buildRunTools(deps());
    expect(tools.map((t) => t.name)).toEqual(["get_next_case", "submit_answer"]);
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.inputSchema.additionalProperties).toBe(false);
    }
  });

  it("marks reading a case read-only and answering not", () => {
    const d = deps();
    expect(tool(d, "get_next_case").annotations?.readOnlyHint).toBe(true);
    expect(tool(d, "submit_answer").annotations?.readOnlyHint).toBe(false);
  });
});
