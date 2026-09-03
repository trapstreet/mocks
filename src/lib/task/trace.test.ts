import { describe, expect, it, vi } from "vitest";
import { traceRunTools, abbreviate, type TraceStep } from "./trace";
import type { ToolDescriptor } from "./run-tools";

const tool = (name: string, out: unknown): ToolDescriptor => ({
  name,
  description: "",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  execute: vi.fn(async () => out),
});

const collect = () => {
  const steps: TraceStep[] = [];
  return { steps, push: (s: TraceStep) => steps.push(s) };
};

describe("traceRunTools", () => {
  it("puts fetching a case on the page", async () => {
    const { steps, push } = collect();
    const [t] = traceRunTools(
      [tool("get_next_case", { case_id: "baseline_32q", index: 1, total: 1 })],
      push,
    );
    await t.execute({});

    expect(steps).toEqual([{ kind: "fetch", caseId: "baseline_32q", index: 1, total: 1 }]);
  });

  it("puts a submitted answer on the page without a verdict", async () => {
    const { steps, push } = collect();
    const [t] = traceRunTools(
      [tool("submit_answer", { case_id: "c1", recorded: true, answered: 1, total: 2 })],
      push,
    );
    await t.execute({ case_id: "c1", answer: '{"responses": [4, 2]}' });

    expect(steps).toEqual([
      { kind: "answer", caseId: "c1", answer: '{"responses": [4, 2]}' },
    ]);
  });

  // The grader's verdict rides inside the last submit_answer; on its own line
  // it reads as the end of the run rather than as part of one case.
  it("gives the grader its own line when the set completes", async () => {
    const { steps, push } = collect();
    const [t] = traceRunTools(
      [
        tool("submit_answer", {
          case_id: "c2",
          passed: true,
          score: 1,
          final: { passed: true, score: 0.8 },
        }),
      ],
      push,
    );
    await t.execute({ case_id: "c2", answer: "x" });

    expect(steps.at(-1)).toEqual({ kind: "graded", passed: true, score: 0.8 });
  });

  // A run that stalls because the agent kept being refused should look
  // stalled on screen, not idle.
  it("shows a refusal rather than swallowing it", async () => {
    const { steps, push } = collect();
    const [t] = traceRunTools([tool("submit_answer", { error: 'no case "typo"' })], push);
    await t.execute({ case_id: "typo", answer: "x" });

    expect(steps).toEqual([{ kind: "refused", tool: "submit_answer", error: 'no case "typo"' }]);
  });

  it("marks the set exhausted", async () => {
    const { steps, push } = collect();
    const [t] = traceRunTools([tool("get_next_case", { done: true, answered: 3, total: 3 })], push);
    await t.execute({});

    expect(steps).toEqual([{ kind: "exhausted", answered: 3, total: 3 }]);
  });

  it("shows PDF file and page reads", async () => {
    const { steps, push } = collect();
    const tools = traceRunTools(
      [
        tool("list_case_files", { case_id: "case_01", files: [{ file_id: "document.pdf" }] }),
        tool("read_pdf_page_text", {
          case_id: "case_01",
          file_id: "document.pdf",
          page: 3,
          pages: 11,
          text: "x",
        }),
        tool("search_pdf_text", {
          case_id: "case_01",
          file_id: "document.pdf",
          query: "treasury custody",
          results: [{ page: 3, snippet: "Treasury" }],
        }),
      ],
      push,
    );

    await tools[0].execute({ case_id: "case_01" });
    await tools[1].execute({ case_id: "case_01", file_id: "document.pdf", page: 3 });
    await tools[2].execute({ case_id: "case_01", file_id: "document.pdf", query: "x" });

    expect(steps).toEqual([
      { kind: "files", caseId: "case_01", count: 1 },
      { kind: "pdfRead", caseId: "case_01", fileId: "document.pdf", page: 3, pages: 11 },
      {
        kind: "pdfSearch",
        caseId: "case_01",
        fileId: "document.pdf",
        query: "treasury custody",
        hits: 1,
      },
    ]);
  });

  // A trace is documentation. It must not become a way for the page to change
  // the run it is documenting.
  it("hands the agent the tool's own output, untouched", async () => {
    const payload = { case_id: "c1", index: 1, total: 1, question: "q" };
    const [t] = traceRunTools([tool("get_next_case", payload)], () => {
      throw new Error("a broken trace must not break the run");
    });

    await expect(t.execute({})).resolves.toBe(payload);
  });

  it("keeps the tool's name and schema so registration is unchanged", () => {
    const original = tool("submit_answer", {});
    const [wrapped] = traceRunTools([original], () => {});

    expect(wrapped.name).toBe("submit_answer");
    expect(wrapped.inputSchema).toBe(original.inputSchema);
  });
});

describe("abbreviate", () => {
  it("flattens a multi-line answer into one glanceable line", () => {
    expect(abbreviate("a\n  b\t c")).toBe("a b c");
  });

  it("cuts a long answer to the given width", () => {
    expect(abbreviate("x".repeat(200), 10)).toBe(`${"x".repeat(9)}…`);
  });
});
