import { describe, expect, it } from "vitest";
import { generateQuiz } from "./generate";

describe("generateQuiz", () => {
  it("is fully determined by its seed", () => {
    expect(generateQuiz({ seed: 7 })).toEqual(generateQuiz({ seed: 7 }));
  });

  // The whole anti-cheat claim: this instance did not exist until now, so
  // there is nothing to look up.
  it("gives different seeds different answers", () => {
    const answers = new Set(
      Array.from({ length: 20 }, (_, i) => generateQuiz({ seed: i }).answer),
    );
    expect(answers.size).toBeGreaterThan(10);
  });

  it("never puts the answer in the question", () => {
    for (let seed = 0; seed < 30; seed++) {
      const q = generateQuiz({ seed });
      expect(q.question).not.toContain(q.answer);
    }
  });

  // The property that makes searching necessary: hop N's search key appears
  // ONLY in hop N-1's section. An agent that cannot read cannot guess it.
  it("hides each hop's key inside the previous hop's section", () => {
    const q = generateQuiz({ seed: 3, hops: 3 });
    for (let i = 1; i < q.chain.length; i++) {
      const key = q.chain[i].key;
      const holders = q.sections.filter((s) => s.body.includes(key));
      expect(holders.map((s) => s.id)).toContain(q.chain[i - 1].sectionId);
      // And it is not simply lying around in the question either.
      expect(q.question).not.toContain(key);
    }
  });

  it("is solvable by following the chain and nothing else", () => {
    const q = generateQuiz({ seed: 11, hops: 3 });
    const last = q.sections.find((s) => s.id === q.chain[q.chain.length - 1].sectionId);
    expect(last?.body).toContain(q.answer);
  });

  // Distractors are the reason a sloppy search fails: same shape, wrong value.
  it("plants near-miss sections that a careless search will surface", () => {
    const q = generateQuiz({ seed: 5, hops: 3, distractors: 6 });
    const chainIds = new Set(q.chain.map((c) => c.sectionId));
    const decoys = q.sections.filter((s) => !chainIds.has(s.id));
    expect(decoys.length).toBeGreaterThanOrEqual(6);
    // A decoy must look like a real hop, or it fools nobody.
    expect(decoys.some((s) => /desk|escalat|sign/i.test(s.body))).toBe(true);
    // And none of them may carry the real answer.
    expect(decoys.every((s) => !s.body.includes(q.answer))).toBe(true);
  });

  it("grows the chain when asked for more hops", () => {
    expect(generateQuiz({ seed: 2, hops: 2 }).chain).toHaveLength(2);
    expect(generateQuiz({ seed: 2, hops: 4 }).chain).toHaveLength(4);
  });
  // "A equipment write-off request" was the first sentence on the page.
  it("gets the article right in front of a vowel", () => {
    const questions = Array.from(
      { length: 60 },
      (_, i) => generateQuiz({ seed: i }).question,
    );
    expect(questions.some((q) => /^An [aeiou]/i.test(q))).toBe(true);
    expect(questions.every((q) => !/^A [aeiou]/i.test(q))).toBe(true);
  });
});
