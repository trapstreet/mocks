import { describe, expect, it, vi } from "vitest";
import { buildRunTools, type RunToolDeps } from "./run-tools";

const CASES = [
  { id: "c1", description: "only DRIVE passes", question: "walk or drive?", files: [] },
  { id: "c2", description: "second", question: "second question" },
];

const PDF_CASES = [
  {
    id: "pdf_case",
    description: "contains the answer",
    question: "",
    files: [
      {
        id: "inputs/pdf_case/source.pdf",
        name: "source.pdf",
        path: "inputs/pdf_case/source.pdf",
        url: "https://raw.example/source.pdf",
        view_url: "https://github.example/source.pdf",
        kind: "pdf" as const,
      },
    ],
  },
];

function deps(over: Partial<RunToolDeps> = {}): RunToolDeps {
  const results: Array<{ case_id: string; passed: boolean; score: number }> = [];
  let persona = "";
  return {
    taskId: "karpathys-jagged-questions",
    persona: () => persona,
    setPersona: (name: string) => {
      persona = name;
    },
    runnable: () => true,
    reason: () => null,
    cases: () => CASES,
    results: () => results,
    readPdfPageText: vi.fn(async (caseId: string, fileId: string, page: number) => ({
      case_id: caseId,
      file_id: fileId,
      page,
      pages: 2,
      text: "the page text",
    })),
    searchPdfText: vi.fn(async (caseId: string, fileId: string, query: string) => ({
      case_id: caseId,
      file_id: fileId,
      query,
      pages: 2,
      results: [{ page: 1, snippet: "a matching snippet" }],
    })),
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
    expect(JSON.stringify(out)).not.toMatch(/expected|verdict|gold|answer_key|only DRIVE passes/i);
    expect(out).not.toHaveProperty("description");
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
  it("records with the task's judge and reports progress without the case verdict", async () => {
    const d = deps();
    const out = (await tool(d, "submit_answer").execute({
      case_id: "c1",
      answer: "DRIVE — the car has to get there",
    })) as Record<string, unknown>;

    expect(d.judge).toHaveBeenCalledWith("c1", "DRIVE — the car has to get there");
    expect(out).toMatchObject({ case_id: "c1", recorded: true, answered: 1, total: 2 });
    expect(out).not.toHaveProperty("passed");
    expect(out).not.toHaveProperty("score");
  });

  it("records a wrong answer without returning feedback", async () => {
    const d = deps();
    const out = (await tool(d, "submit_answer").execute({
      case_id: "c1",
      answer: "WALK",
    })) as Record<string, unknown>;

    expect(out).toMatchObject({ recorded: true, answered: 1 });
    expect(out).not.toHaveProperty("passed");
    expect(out).not.toHaveProperty("score");
  });

  it("refuses to re-score the same case as an answer oracle", async () => {
    const d = deps();
    await tool(d, "submit_answer").execute({ case_id: "c1", answer: "WALK" });

    expect(await tool(d, "submit_answer").execute({ case_id: "c1", answer: "DRIVE" })).toMatchObject(
      { error: expect.stringContaining("already has an answer") },
    );
    expect(d.judge).toHaveBeenCalledTimes(1);
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

describe("PDF tools", () => {
  it("lists case files without fetching their contents", async () => {
    const d = deps({ cases: () => PDF_CASES });
    const out = (await tool(d, "list_case_files").execute({ case_id: "pdf_case" })) as {
      files: Array<{ file_id: string; name: string; kind: string; view_url?: string }>;
    };

    expect(out.files).toEqual([
      {
        file_id: "inputs/pdf_case/source.pdf",
        name: "source.pdf",
        kind: "pdf",
        view_url: "https://github.example/source.pdf",
      },
    ]);
    expect(JSON.stringify(out)).not.toContain("raw.example");
    expect(d.readPdfPageText).not.toHaveBeenCalled();
  });

  it("reads one PDF page on demand", async () => {
    const d = deps({ cases: () => PDF_CASES });
    const out = await tool(d, "read_pdf_page_text").execute({
      case_id: "pdf_case",
      file_id: "inputs/pdf_case/source.pdf",
      page: 2,
    });

    expect(d.readPdfPageText).toHaveBeenCalledWith("pdf_case", "inputs/pdf_case/source.pdf", 2);
    expect(out).toMatchObject({ page: 2, pages: 2, text: "the page text" });
  });

  it("searches PDF text on demand", async () => {
    const d = deps({ cases: () => PDF_CASES });
    const out = await tool(d, "search_pdf_text").execute({
      case_id: "pdf_case",
      file_id: "inputs/pdf_case/source.pdf",
      query: "matching",
    });

    expect(d.searchPdfText).toHaveBeenCalledWith(
      "pdf_case",
      "inputs/pdf_case/source.pdf",
      "matching",
    );
    expect(out).toMatchObject({ results: [{ page: 1, snippet: "a matching snippet" }] });
  });

  it("refuses a PDF file id that is not on the case", async () => {
    const d = deps({ cases: () => PDF_CASES });
    expect(
      await tool(d, "read_pdf_page_text").execute({
        case_id: "pdf_case",
        file_id: "missing.pdf",
        page: 1,
      }),
    ).toMatchObject({ error: expect.stringContaining("missing.pdf") });
  });
});

describe("tool descriptors", () => {
  it("declares every tool with a closed schema", () => {
    const tools = buildRunTools(deps());
    // start_run comes first because it is what an agent should call first.
    expect(tools.map((t) => t.name)).toEqual([
      "start_run",
      "get_next_case",
      "list_case_files",
      "read_pdf_page_text",
      "search_pdf_text",
      "submit_answer",
    ]);
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

describe("start_run", () => {
  it("lets the agent name the configuration it is about to run under", async () => {
    const d = deps();
    const [start] = buildRunTools(d);

    expect(start.name).toBe("start_run");
    const out = (await start.execute({ persona: "gpt-5.6 + code-review skill" })) as {
      persona: string;
    };

    expect(out.persona).toBe("gpt-5.6 + code-review skill");
    expect(d.persona()).toBe("gpt-5.6 + code-review skill");
  });

  it("trims a padded name rather than starting a second configuration", async () => {
    const d = deps();
    await buildRunTools(d)[0].execute({ persona: "  baseline  " });
    expect(d.persona()).toBe("baseline");
  });

  // An unnamed configuration cannot be compared with anything, which is the
  // one thing the board is for.
  it("refuses an empty name instead of recording a blank configuration", async () => {
    const d = deps();
    const out = (await buildRunTools(d)[0].execute({ persona: "   " })) as { error?: string };

    expect(out.error).toMatch(/needs a name/);
    expect(d.persona()).toBe("");
  });
});

describe("naming the configuration without being asked", () => {
  // An agent whose prompt never mentioned start_run answers the task
  // perfectly and has the run dropped — which reads as a fault in the page
  // rather than a missing name. The tool layer says so instead.
  it("tells an unnamed agent what it is about to lose", async () => {
    const out = (await tool(deps(), "get_next_case").execute({})) as {
      configuration?: string;
      running_as?: string;
    };

    expect(out.configuration).toMatch(/start_run/);
    expect(out.configuration).toMatch(/NOT recorded/);
    expect(out.running_as).toBeUndefined();
  });

  it("says nothing about it once a configuration has a name", async () => {
    const d = deps();
    d.setPersona("gpt-5.5 baseline");
    const out = (await tool(d, "get_next_case").execute({})) as {
      configuration?: string;
      running_as?: string;
    };

    expect(out.configuration).toBeUndefined();
    expect(out.running_as).toBe("gpt-5.5 baseline");
  });
});

describe("what list_case_files says about reading a PDF", () => {
  const pdfDeps = () =>
    deps({
      cases: () => [
        {
          id: "c1",
          description: "",
          question: "q",
          files: [
            {
              id: "inputs/c1/document.pdf",
              name: "document.pdf",
              kind: "pdf",
              view_url: "https://github.example/document.pdf",
            },
          ],
        },
      ],
    } as Partial<RunToolDeps>);

  // Measured, not guessed: two full runs of pdf-chart-reasoning on this site,
  // one following the old nudge towards the text layer and one told to open
  // the document, scored 14/23 and 17/23. Every `read_length` case — the ones
  // that need looking at a figure — went from failed to passed.
  it("does not steer an agent to the text layer for a figure", async () => {
    const out = (await tool(pdfDeps(), "list_case_files").execute({ case_id: "c1" })) as {
      note: string;
    };

    expect(out.note).toMatch(/open view_url and look at the document yourself/);
    expect(out.note).toMatch(/not text and will not be in it/);
  });

  it("still hands over the link the agent needs to do that", async () => {
    const out = (await tool(pdfDeps(), "list_case_files").execute({ case_id: "c1" })) as {
      files: Array<{ view_url?: string }>;
    };

    expect(out.files[0].view_url).toBe("https://github.example/document.pdf");
  });
});
