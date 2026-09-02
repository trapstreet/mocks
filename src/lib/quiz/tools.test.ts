import { describe, expect, it, vi } from "vitest";
import { generateQuiz } from "./generate";
import { buildQuizTools, type QuizToolDeps } from "./tools";

const quiz = generateQuiz({ seed: 42, hops: 3, distractors: 8 });

function deps(over: Partial<QuizToolDeps> = {}): QuizToolDeps {
  return {
    quiz: () => quiz,
    reads: () => [],
    onRead: vi.fn(),
    onAnswer: vi.fn(),
    ...over,
  };
}
const tool = (d: QuizToolDeps, name: string) => {
  const t = buildQuizTools(d).find((x) => x.name === name);
  if (!t) throw new Error(`no tool ${name}`);
  return t;
};

describe("search_wiki", () => {
  // The whole difficulty rests here: if search returned bodies, one query
  // would hand over the next key and the chain would collapse into a lookup.
  it("returns titles only, never body text", async () => {
    const d = deps();
    const out = (await tool(d, "search_wiki").execute({ query: quiz.chain[0].key })) as {
      results: Array<{ id: string; title: string }>;
    };

    expect(out.results.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(out);
    for (const s of quiz.sections) {
      expect(serialised).not.toContain(s.body.slice(0, 40));
    }
    expect(serialised).not.toContain(quiz.answer);
  });

  it("finds the first hop from the request type named in the question", async () => {
    const out = (await tool(deps(), "search_wiki").execute({
      query: quiz.chain[0].key,
    })) as { results: Array<{ id: string }> };
    expect(out.results.map((r) => r.id)).toContain(quiz.chain[0].sectionId);
  });

  it("caps how much one query can drag back", async () => {
    const out = (await tool(deps(), "search_wiki").execute({ query: "a" })) as {
      results: unknown[];
      truncated?: boolean;
    };
    expect(out.results.length).toBeLessThanOrEqual(6);
  });

  it("says so plainly when nothing matches", async () => {
    const out = (await tool(deps(), "search_wiki").execute({
      query: "zzzz-nothing-here",
    })) as { results: unknown[] };
    expect(out.results).toEqual([]);
  });
});

describe("read_section", () => {
  it("hands over one section's full text", async () => {
    const d = deps();
    const out = (await tool(d, "read_section").execute({
      id: quiz.chain[0].sectionId,
    })) as { body: string };

    expect(out.body).toBe(quiz.sections.find((s) => s.id === quiz.chain[0].sectionId)!.body);
    expect(d.onRead).toHaveBeenCalledWith(quiz.chain[0].sectionId);
  });

  it("refuses an id that is not in this instance", async () => {
    const out = (await tool(deps(), "read_section").execute({ id: "nope" })) as {
      error?: string;
    };
    expect(out.error).toContain("nope");
  });
});

describe("answer_question", () => {
  it("accepts the answer the chain leads to", async () => {
    const d = deps();
    const out = (await tool(d, "answer_question").execute({ answer: quiz.answer })) as {
      correct: boolean;
    };
    expect(out.correct).toBe(true);
    expect(d.onAnswer).toHaveBeenCalledWith(quiz.answer, true);
  });

  it("is forgiving about case and surrounding space, nothing else", async () => {
    const ok = (await tool(deps(), "answer_question").execute({
      answer: `  ${quiz.answer.toUpperCase()} `,
    })) as { correct: boolean };
    expect(ok.correct).toBe(true);

    const no = (await tool(deps(), "answer_question").execute({
      answer: quiz.answer.split(" ")[0],
    })) as { correct: boolean };
    expect(no.correct).toBe(false);
  });

  // A wrong answer must not become a hint, or the second guess is free.
  it("does not reveal the right answer when the guess is wrong", async () => {
    const out = await tool(deps(), "answer_question").execute({ answer: "Someone Else" });
    expect(JSON.stringify(out)).not.toContain(quiz.answer);
  });

  it("reports how many sections were read, as a difficulty signal", async () => {
    const d = deps({ reads: () => ["s1", "s2", "s3"] });
    const out = (await tool(d, "answer_question").execute({ answer: quiz.answer })) as {
      sections_read: number;
    };
    expect(out.sections_read).toBe(3);
  });
});

describe("tool descriptors", () => {
  it("declares three tools with closed schemas", () => {
    const tools = buildQuizTools(deps());
    expect(tools.map((t) => t.name)).toEqual([
      "search_wiki",
      "read_section",
      "answer_question",
    ]);
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.inputSchema.additionalProperties).toBe(false);
    }
  });
});

// End to end through the tool surface an agent actually sees. If a perfect
// player cannot get there with search + read alone, the instance is not a
// hard question — it is a broken one.
describe("the chain is walkable with nothing but the tools", () => {
  it.each([2, 3, 4, 5])("solves a %i-hop instance", async (hops) => {
    for (const seed of [1, 17, 250, 9001]) {
      const q = generateQuiz({ seed, hops });
      const reads: string[] = [];
      const d: QuizToolDeps = {
        quiz: () => q,
        reads: () => reads,
        onRead: (id) => reads.push(id),
        onAnswer: () => {},
      };
      const search = tool(d, "search_wiki");
      const read = tool(d, "read_section");

      // The only thing the player starts with is the request type in the
      // question — exactly what an agent has.
      let key = q.chain[0].key;
      let body = "";
      for (let hop = 0; hop < hops; hop++) {
        const found = (await search.execute({ query: key })) as {
          results: Array<{ id: string; title: string }>;
        };
        const target = found.results.find((r) => r.id === q.chain[hop].sectionId);
        expect(target, `hop ${hop} of seed ${seed} was not findable by "${key}"`).toBeTruthy();
        const got = (await read.execute({ id: target!.id })) as { body: string };
        body = got.body;
        if (hop + 1 < hops) key = q.chain[hop + 1].key;
      }
      expect(body).toContain(q.answer);
      expect(reads).toHaveLength(hops);
    }
  });
});
