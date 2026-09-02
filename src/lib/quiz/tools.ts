import type { Quiz } from "./generate";

// Three tools that make the corpus reachable only a piece at a time.
//
// search_wiki returns TITLES ONLY. That single choice is what the difficulty
// rests on: a search that returned body text would hand over the next hop's
// key, and the chain would collapse back into the one-pass lookup a model
// already solves 10/10. Here the agent has to read, notice the code it did
// not have before, search that, and read again.

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

export interface QuizToolDeps {
  quiz(): Quiz;
  reads(): string[];
  onRead(id: string): void;
  onAnswer(answer: string, correct: boolean): void;
}

/** How much one query may drag back. Small enough that a broad search is
 *  not a substitute for reading; large enough to be usable. */
const MAX_RESULTS = 6;

const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function buildQuizTools(deps: QuizToolDeps): ToolDescriptor[] {
  return [
    {
      name: "search_wiki",
      description:
        "Search this organisation's internal wiki. Returns matching section " +
        "titles and ids — titles only, never the text. Read a section to see " +
        "what it says. Start from the request type named in the question; " +
        "what you need next is written inside the sections, not in the index.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Words, a desk code, or a role name." },
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: async ({ query }) => {
        const q = normalise(String(query ?? ""));
        if (!q) return { results: [], note: "empty query" };
        const terms = q.split(" ").filter(Boolean);

        const scored = deps
          .quiz()
          .sections.map((s) => {
            const hay = normalise(`${s.title} ${s.body}`);
            const hits = terms.filter((t) => hay.includes(t)).length;
            // Title matches are what a person would call a hit; body matches
            // still surface the section, but never leak what it says.
            const inTitle = terms.filter((t) => normalise(s.title).includes(t)).length;
            return { s, score: hits + inTitle * 2 };
          })
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score || a.s.id.localeCompare(b.s.id));

        return {
          results: scored.slice(0, MAX_RESULTS).map(({ s }) => ({ id: s.id, title: s.title })),
          ...(scored.length > MAX_RESULTS
            ? { truncated: true, note: `${scored.length} sections matched; narrow the query` }
            : {}),
        };
      },
    },
    {
      name: "read_section",
      description:
        "Read one section of the wiki in full. This is the only way to see " +
        "what a section actually says, and the only place the next thing to " +
        "search for is written down.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "A section id from search_wiki." },
        },
        required: ["id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: async ({ id }) => {
        const wanted = String(id ?? "");
        const section = deps.quiz().sections.find((s) => s.id === wanted);
        if (!section) {
          return { error: `no section "${wanted}" in this wiki — search_wiki lists the ids` };
        }
        deps.onRead(section.id);
        return { id: section.id, title: section.title, body: section.body };
      },
    },
    {
      name: "answer_question",
      description:
        "Give the final answer. Scored immediately against this instance, " +
        "which was generated for this visit and exists nowhere else — there " +
        "is no answer key to find. A wrong answer is reported as wrong and " +
        "nothing more.",
      inputSchema: {
        type: "object",
        properties: {
          answer: { type: "string", description: "The person's full name, nothing else." },
        },
        required: ["answer"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: async ({ answer }) => {
        const given = String(answer ?? "");
        const quiz = deps.quiz();
        // Case and surrounding space are noise; anything else is a miss.
        // Loosening this further would start scoring near-misses as hits,
        // which is how a benchmark quietly stops discriminating.
        const correct = normalise(given) === normalise(quiz.answer);
        deps.onAnswer(given, correct);
        return {
          correct,
          sections_read: deps.reads().length,
          // Deliberately no hint: a wrong answer that names the right one
          // makes the second guess free.
          note: correct
            ? "correct — the chain led here"
            : "not the person this instance routes to",
        };
      },
    },
  ];
}
