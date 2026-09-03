import type { CaseInputFile } from "./fetch-task";

// The tools that let an agent sit the benchmark itself.
//
// The page holds the task bundle — questions AND expected answers, since the
// judge cannot run without them — and these tools are the seam that keeps the
// second half away from the agent. A model handed the expected verdict scores
// full marks and the result means nothing, so `get_next_case` returns only the
// prompt and the input handles needed to inspect the case.
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
  persona(): string;
  setPersona(name: string): void;
  runnable(): boolean;
  reason(): string | null;
  cases(): Array<{ id: string; description: string; question: string; files?: CaseInputFile[] }>;
  results(): Array<{ case_id: string; passed: boolean; score: number }>;
  readPdfPageText(
    caseId: string,
    fileId: string,
    page: number,
  ): Promise<{ case_id: string; file_id: string; page: number; pages: number; text: string }>;
  searchPdfText(
    caseId: string,
    fileId: string,
    query: string,
  ): Promise<{
    case_id: string;
    file_id: string;
    query: string;
    pages: number;
    results: Array<{ page: number; snippet: string }>;
  }>;
  judge(
    caseId: string,
    answer: string,
  ): Promise<{ case_id: string; passed: boolean; score: number }>;
  grade(): Promise<{ passed: boolean; score: number }>;
}

const message = (e: unknown) =>
  e instanceof Error ? e.message : "the judge could not be run";

const caseById = (
  cases: Array<{ id: string; files?: CaseInputFile[] }>,
  caseId: string,
) => cases.find((c) => c.id === caseId);

const pdfById = (
  cases: Array<{ id: string; files?: CaseInputFile[] }>,
  caseId: string,
  fileId: string,
) => caseById(cases, caseId)?.files?.find((f) => f.id === fileId && f.kind === "pdf");

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
      name: "start_run",
      description:
        "Name the configuration you are about to sit this benchmark under — " +
        "the model, and anything in front of it: a system prompt, a skill, a " +
        "harness, or nothing. The board on this page groups runs by that name, " +
        "so answering the same task twice under two names is how you compare " +
        "them. Call this before get_next_case. Optional: an unnamed run is " +
        "still scored, it just cannot be compared with anything.",
      inputSchema: {
        type: "object",
        properties: {
          persona: {
            type: "string",
            description:
              "A short name for this configuration, e.g. \"gpt-5.6 baseline\" " +
              "or \"gpt-5.6 + code-review skill\". Describe the setup, not the run.",
          },
        },
        required: ["persona"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: async ({ persona }) => {
        const name = String(persona ?? "").trim();
        if (!name) return { error: "a configuration needs a name" };
        deps.setPersona(name);
        return {
          persona: name,
          note:
            "Recorded for this run. Answer every case, and the result is saved " +
            "under this name when the task's grader has scored the set.",
        };
      },
    },
    {
      name: "get_next_case",
      description:
        "Fetch the next unanswered case of this benchmark: its question, its " +
        "input file handles, its position in the set, and how many cases " +
        "there are. The expected answer is never included, because an agent " +
        "that is handed it scores full marks and the attempt means nothing. " +
        "Call submit_answer with your answer, then call this again.",
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
          question:
            c.question ||
            "The prompt and source document are in the case files. Use list_case_files, then read_pdf_page_text or search_pdf_text to inspect them.",
          files: (c.files ?? []).map((f) => ({
            file_id: f.id,
            name: f.name,
            kind: f.kind,
            ...(f.kind === "pdf" ? { view_url: f.view_url } : {}),
          })),
          // Said here rather than left to whoever wrote the prompt. An agent
          // that was never told about start_run answers the task perfectly
          // and the run is dropped, which looks like a fault in the page.
          ...(deps.persona().trim()
            ? { running_as: deps.persona() }
            : {
                configuration:
                  "unnamed — this run will be scored but NOT recorded on the " +
                  "board. Call start_run with a short name for your setup " +
                  "(model, and any prompt, skill or harness in front of it) " +
                  "before you submit, and it will be.",
              }),
        };
      },
    },
    {
      name: "list_case_files",
      description:
        "List the input files for one case. Text tasks usually have their prompt " +
        "in get_next_case. PDF tasks keep the document out of the main payload; " +
        "use read_pdf_page_text or search_pdf_text on a listed PDF file.",
      inputSchema: {
        type: "object",
        properties: {
          case_id: {
            type: "string",
            description: "The case_id given by get_next_case.",
          },
        },
        required: ["case_id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: async ({ case_id }) => {
        const stop = blocked();
        if (stop) return stop;
        const id = String(case_id ?? "");
        const c = caseById(deps.cases(), id);
        if (!c) return { error: `no case "${id}" on this task — call get_next_case first` };
        return {
          case_id: id,
          files: (c.files ?? []).map((f) => ({
            file_id: f.id,
            name: f.name,
            kind: f.kind,
            ...(f.kind === "pdf" ? { view_url: f.view_url } : {}),
          })),
          note:
            c.files?.some((f) => f.kind === "pdf")
              ? "Use read_pdf_page_text for a page, or search_pdf_text to find pages mentioning a term."
              : "This case has no PDF files; the text prompt is in get_next_case.",
        };
      },
    },
    {
      name: "read_pdf_page_text",
      description:
        "Extract the text of one page from a case PDF. Pages are 1-indexed. " +
        "Use this when a PDF case needs inspection instead of loading the whole " +
        "document into get_next_case.",
      inputSchema: {
        type: "object",
        properties: {
          case_id: { type: "string", description: "The case_id given by get_next_case." },
          file_id: { type: "string", description: "A PDF file_id from list_case_files." },
          page: { type: "number", description: "1-indexed page number." },
        },
        required: ["case_id", "file_id", "page"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: async ({ case_id, file_id, page }) => {
        const stop = blocked();
        if (stop) return stop;
        const caseId = String(case_id ?? "");
        const fileId = String(file_id ?? "");
        if (!pdfById(deps.cases(), caseId, fileId)) {
          return { error: `no PDF file "${fileId}" on case "${caseId}"` };
        }
        try {
          return await deps.readPdfPageText(caseId, fileId, Number(page));
        } catch (e) {
          return { error: message(e) };
        }
      },
    },
    {
      name: "search_pdf_text",
      description:
        "Search a case PDF's extracted text and return page-level snippets. " +
        "This is for finding the relevant page before reading it; it returns " +
        "snippets, not the whole document.",
      inputSchema: {
        type: "object",
        properties: {
          case_id: { type: "string", description: "The case_id given by get_next_case." },
          file_id: { type: "string", description: "A PDF file_id from list_case_files." },
          query: { type: "string", description: "Text to search for inside the PDF." },
        },
        required: ["case_id", "file_id", "query"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: async ({ case_id, file_id, query }) => {
        const stop = blocked();
        if (stop) return stop;
        const caseId = String(case_id ?? "");
        const fileId = String(file_id ?? "");
        if (!pdfById(deps.cases(), caseId, fileId)) {
          return { error: `no PDF file "${fileId}" on case "${caseId}"` };
        }
        const q = String(query ?? "").trim();
        if (!q) return { error: "query is required" };
        try {
          return await deps.searchPdfText(caseId, fileId, q);
        } catch (e) {
          return { error: message(e) };
        }
      },
    },
    {
      name: "submit_answer",
      description:
        "Answer one case. The answer is scored on this page by the task's own " +
        "judge.py, fetched from the commit the leaderboard grades against and " +
        "run unmodified — the same scoring a local `tp run` would apply. " +
        "Returns whether the case passed and how far through the set you are. " +
        "Each case accepts one answer per run; repeated submissions are refused.",
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
        if (answered().has(id)) {
          return {
            error: `case "${id}" already has an answer in this run — call get_next_case for the next case`,
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
