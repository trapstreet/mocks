import { describe, expect, it } from "vitest";
import { byPersona, median } from "./compare";
import type { RunRow } from "./runs";

let seq = 0;
const run = (over: Partial<RunRow>): RunRow => ({
  id: `run-${++seq}`,
  task_id: "python-bugfix-diff",
  task_commit: "cf92b66",
  persona: "baseline",
  score: 0.5,
  passed: false,
  cases_total: 10,
  cases_passed: 5,
  user_login: null,
  started_at: "2026-09-02T10:00:00Z",
  metrics: null,
  ...over,
});

describe("median", () => {
  it("takes the middle of an odd count", () => {
    expect(median([0.1, 0.9, 0.5])).toBe(0.5);
  });

  it("averages the two middles of an even count", () => {
    expect(median([0.2, 0.4, 0.6, 0.8])).toBeCloseTo(0.5);
  });

  it("has nothing to report for no values", () => {
    expect(median([])).toBeNull();
  });
});

describe("byPersona", () => {
  // The whole point of the board: same task, two configurations, which did
  // better.
  it("groups runs by configuration and reports each one's median", () => {
    const out = byPersona([
      run({ persona: "with-skill", score: 0.8 }),
      run({ persona: "with-skill", score: 0.7 }),
      run({ persona: "with-skill", score: 0.9 }),
      run({ persona: "baseline", score: 0.6 }),
    ]);

    expect(out.map((p) => p.persona)).toEqual(["with-skill", "baseline"]);
    expect(out[0]).toMatchObject({ median: 0.8, best: 0.9, worst: 0.7, runs: 3 });
  });

  // A best-of would let one lucky sample beat a steadier configuration, and
  // reward whoever ran the most times.
  it("ranks on the median, so one lucky run does not win", () => {
    const out = byPersona([
      run({ persona: "lucky", score: 1.0 }),
      run({ persona: "lucky", score: 0.1 }),
      run({ persona: "lucky", score: 0.1 }),
      run({ persona: "steady", score: 0.6 }),
      run({ persona: "steady", score: 0.6 }),
    ]);

    expect(out[0].persona).toBe("steady");
    expect(out[1].best).toBe(1.0);
  });

  // The tasks are pinned per commit. Two runs of "the same" configuration
  // judged against different versions were not asked the same questions.
  it("does not merge runs judged against different commits", () => {
    const out = byPersona([
      run({ persona: "baseline", task_commit: "aaa", score: 0.9 }),
      run({ persona: "baseline", task_commit: "bbb", score: 0.2 }),
    ]);

    expect(out).toHaveLength(2);
    expect(out.map((p) => p.task_commit)).toEqual(["aaa", "bbb"]);
  });

  // "Never produced a score" is not "scored zero", and must not outrank a
  // configuration that actually scored something.
  it("sorts an unscored configuration last rather than as a zero", () => {
    const out = byPersona([
      run({ persona: "broken", score: null }),
      run({ persona: "works", score: 0.05 }),
    ]);

    expect(out.map((p) => p.persona)).toEqual(["works", "broken"]);
    expect(out[1].median).toBeNull();
  });

  it("breaks a tie towards the configuration proven over more runs", () => {
    const out = byPersona([
      run({ persona: "once", score: 0.7 }),
      run({ persona: "thrice", score: 0.7 }),
      run({ persona: "thrice", score: 0.7 }),
      run({ persona: "thrice", score: 0.7 }),
    ]);

    expect(out[0].persona).toBe("thrice");
  });

  it("names the people behind a configuration, without repeating one", () => {
    const out = byPersona([
      run({ persona: "p", user_login: "ruqii" }),
      run({ persona: "p", user_login: "ruqii" }),
      run({ persona: "p", user_login: null }),
    ]);

    expect(out[0].people).toEqual(["ruqii"]);
  });
});

describe("the headline result", () => {
  // MBTI grades format only: every well-formed answer scores 1.0, so a board
  // showing scores alone would be a column of 1.00 beside two configurations
  // that produced genuinely different results.
  it("surfaces what the judge derived when the score cannot tell them apart", () => {
    const out = byPersona([
      run({
        persona: "baseline",
        score: 1,
        cases_total: 1,
        metrics: { score: 1, mbti_type: "INFP" },
      }),
      run({
        persona: "with-prompt",
        score: 1,
        cases_total: 1,
        metrics: { score: 1, mbti_type: "ISFJ" },
      }),
    ]);

    expect(out.map((c) => c.result?.value).sort()).toEqual(["INFP", "ISFJ"]);
  });

  it("takes the most recent run's result, not an older one", () => {
    const out = byPersona([
      run({ cases_total: 1, started_at: "2026-09-02T09:00:00Z", metrics: { mbti_type: "INFP" } }),
      run({ cases_total: 1, started_at: "2026-09-02T11:00:00Z", metrics: { mbti_type: "ENTP" } }),
    ]);

    expect(out[0].result?.value).toBe("ENTP");
  });

  // On a task with many cases, one case's derived value does not describe the
  // run; the score already does.
  it("has no headline result for a multi-case task", () => {
    const out = byPersona([run({ cases_total: 10, metrics: { mbti_type: "INFP" } })]);
    expect(out[0].result).toBeNull();
  });

  it("has none when the judge surfaced nothing beyond a score", () => {
    const out = byPersona([run({ cases_total: 1, metrics: { score: 1, passed: true } })]);
    expect(out[0].result).toBeNull();
  });
});

describe("cases passed", () => {
  // A score alone does not say how many cases were right: 0.61 can come from
  // fourteen clean passes or from twenty-three near misses, and a person
  // reading the board wants the count.
  it("reports the latest run's passed-of-total", () => {
    const out = byPersona([
      run({ cases_passed: 14, cases_total: 23, started_at: "2026-09-03T09:31:00Z" }),
      run({ cases_passed: 3, cases_total: 23, started_at: "2026-09-03T08:00:00Z" }),
    ]);

    expect(out[0].cases).toEqual({ passed: 14, total: 23 });
  });

  it("has nothing to report for a run that recorded no cases", () => {
    expect(byPersona([run({ cases_total: 0 })])[0].cases).toBeNull();
  });
});

describe("what counts as the derived result", () => {
  // Postgres jsonb does not preserve key order — it sorts by key length — so
  // the 8-character `category` floated above the 9-character `mbti_type` on
  // the way back out, and the board showed "personality" where "INTJ"
  // belonged. Nothing may depend on the order a judge printed its keys.
  it("skips case metadata however the keys happen to be ordered", () => {
    const out = byPersona([
      run({
        cases_total: 1,
        metrics: { category: "personality", difficulty: "hard", mbti_type: "INTJ" },
      }),
    ]);

    expect(out[0].result).toEqual({ key: "mbti_type", value: "INTJ" });
  });

  it("has no result when metadata is all the judge surfaced", () => {
    const out = byPersona([
      run({ cases_total: 1, metrics: { category: "read_length", difficulty: "hard" } }),
    ]);
    expect(out[0].result).toBeNull();
  });
});
