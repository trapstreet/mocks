import { describe, expect, it } from "vitest";
import { InvalidRun, LIMITS, parseSubmission } from "./submission";

const good = (over: Record<string, unknown> = {}) => ({
  task_id: "do-llms-dream-of-intj",
  task_commit: "cf92b6690b7c8b3430602dd3b72a8528c96e636b",
  persona: "gpt-5.6 + no extra prompt",
  score: 1,
  passed: true,
  cases: [
    {
      case_id: "baseline_32q",
      passed: true,
      score: 1,
      answer: '{"responses": [4, 4, 2]}',
      metrics: { mbti_type: "INFP" },
    },
  ],
  ...over,
});

const rejects = (body: unknown, why: RegExp) =>
  expect(() => parseSubmission(body)).toThrow(why);

describe("parseSubmission", () => {
  it("reads a well-formed run, keeping the judge's metrics whole", () => {
    const run = parseSubmission(good());

    expect(run.task_id).toBe("do-llms-dream-of-intj");
    expect(run.persona).toBe("gpt-5.6 + no extra prompt");
    expect(run.cases[0].metrics).toEqual({ mbti_type: "INFP" });
  });

  it("trims a padded configuration name rather than storing the padding", () => {
    expect(parseSubmission(good({ persona: "  baseline  " })).persona).toBe("baseline");
  });

  // Tasks are pinned per commit; a record that cannot name its commit cannot
  // be compared with anything.
  it("insists a run says which version of the task it answered", () => {
    rejects(good({ task_commit: "" }), /task_commit is required/);
    rejects(good({ task_commit: "main" }), /commit sha/);
  });

  it("refuses an id that is not a task slug", () => {
    rejects(good({ task_id: "../../etc/passwd" }), /task slug/);
  });

  it("refuses a run with no cases in it", () => {
    rejects(good({ cases: [] }), /no cases/);
    rejects(good({ cases: "lots" }), /no cases/);
  });

  it("refuses the same case twice, which would be one answer counted twice", () => {
    const c = good().cases[0];
    rejects(good({ cases: [c, { ...c }] }), /appears twice/);
  });

  // The name goes on a public board and is typed by whoever ran it.
  it("refuses anything that could read as markup", () => {
    rejects(good({ persona: "<script>alert(1)</script>" }), /unsupported characters/);
    rejects(good({ persona: "a\u0000b" }), /unsupported characters/);
  });

  // The first rule here was an allowlist of a dozen punctuation marks, and it
  // threw out an ordinary name for containing quotes.
  it("accepts the punctuation a real configuration name uses", () => {
    for (const name of [
      'gpt-5.6 + "answer as your true self" prompt',
      "claude-opus-5 · CLAUDE.md v2",
      "o3 [high effort] @ 2026-09",
      "小模型 baseline",
    ]) {
      expect(parseSubmission(good({ persona: name })).persona).toBe(name);
    }
  });

  it("refuses a name longer than the column", () => {
    rejects(good({ persona: "x".repeat(LIMITS.persona + 1) }), /longer than/);
  });

  it("refuses a score that is not a number", () => {
    rejects(good({ cases: [{ ...good().cases[0], score: "1.0" }] }), /must be a number/);
    rejects(good({ score: Number.NaN }), /must be a number/);
  });

  // A task with no overall score is ordinary — the grader may not have run —
  // and is not the same as one that scored zero.
  it("accepts a run with no overall score", () => {
    expect(parseSubmission(good({ score: null, passed: null }))).toMatchObject({
      score: null,
      passed: null,
    });
  });

  it("cuts an answer to what will be stored instead of rejecting the run", () => {
    const long = { ...good().cases[0], answer: "y".repeat(LIMITS.answer + 500) };
    expect(parseSubmission(good({ cases: [long] })).cases[0].answer).toHaveLength(
      LIMITS.answer,
    );
  });

  it("keeps an answer's whitespace, which a judge may be grading on", () => {
    const c = { ...good().cases[0], answer: "  42\n" };
    expect(parseSubmission(good({ cases: [c] })).cases[0].answer).toBe("  42\n");
  });

  it("treats a missing or non-object metrics as no metrics", () => {
    const c = { ...good().cases[0], metrics: "nope" };
    expect(parseSubmission(good({ cases: [c] })).cases[0].metrics).toEqual({});
  });

  it("refuses metrics too large to store", () => {
    const c = { ...good().cases[0], metrics: { blob: "z".repeat(LIMITS.metrics) } };
    rejects(good({ cases: [c] }), /more metrics than will be stored/);
  });

  it("throws InvalidRun so a route can answer 400 with the reason", () => {
    expect(() => parseSubmission(null)).toThrow(InvalidRun);
    expect(() => parseSubmission("a string")).toThrow(/JSON object/);
  });
});
