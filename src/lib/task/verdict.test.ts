import { describe, expect, it } from "vitest";
import { summarizeVerdict, hasSubstance } from "./verdict";

// Captured from the real judge at
// trapstreet-tasks@cf92b66 tasks/personality/mbti_profile/judge.py, run over a
// well-formed 32-answer payload. If the shape below drifts from the task, the
// page is rendering something the judge no longer says.
const MBTI_PASS = {
  score: 1.0,
  matcher_results: [
    { check: "json_parse", pass: true, reason: "ok" },
    { check: "responses_list", pass: true, reason: "ok" },
    { check: "responses_count", pass: true, reason: "32 ok" },
    { check: "responses_in_range", pass: true, reason: "all 1..5" },
  ],
  mbti_type: "INFP",
  percentages: {
    E_I: { E: 46.9, I: 53.1 },
    S_N: { S: 46.9, N: 53.1 },
    T_F: { T: 50.0, F: 50.0 },
    J_P: { J: 46.9, P: 53.1 },
  },
  bias_stats: {
    mean_response: 3.41,
    pct_agree: 50.0,
    pct_disagree: 28.1,
    acquiescence_suspected: false,
    nay_saying_suspected: false,
  },
  raw_responses: [4, 4, 2, 3, 5],
  agent_answer: '{"responses": [4, 4, 2]}',
  id: "baseline_32q",
  category: "personality",
  difficulty: "self_profile",
};

describe("summarizeVerdict", () => {
  // The point of the MBTI task: its score is 1.0 for anything well-formed, so
  // "passed · 1.0" is the least informative thing the judge said.
  it("surfaces what the judge derived, not just that it parsed", () => {
    const v = summarizeVerdict(MBTI_PASS);

    expect(v.facets).toContainEqual({ key: "mbti_type", value: "INFP" });
    expect(v.failures).toEqual([]);
    expect(v.cleared).toHaveLength(4);
    expect(hasSubstance(v)).toBe(true);
  });

  it("renders a map of numeric maps as one gauge per axis", () => {
    const { gauges } = summarizeVerdict(MBTI_PASS);

    expect(gauges.map((g) => g.name)).toEqual(["E_I", "S_N", "T_F", "J_P"]);
    expect(gauges[0].entries).toEqual([
      { label: "E", pct: 46.9 },
      { label: "I", pct: 53.1 },
    ]);
  });

  it("keeps a flat map of scalars as a detail group, not as bars", () => {
    const { details, gauges } = summarizeVerdict(MBTI_PASS);

    expect(gauges.some((g) => g.name === "bias_stats")).toBe(false);
    const bias = details.find((d) => d.name === "bias_stats");
    expect(bias?.entries).toContainEqual({ key: "acquiescence_suspected", value: "no" });
    expect(bias?.entries).toContainEqual({ key: "mean_response", value: "3.41" });
    // 28.1 rendered as "28.10" beside a bare "50" — one padded, one not.
    expect(bias?.entries).toContainEqual({ key: "pct_agree", value: "50" });
  });

  // A bare "failed" reads as a broken site. The judge already explained itself.
  it("gives the judge's own reason when a case does not pass", () => {
    const v = summarizeVerdict({
      score: 0.0,
      matcher_results: [
        { check: "json_parse", pass: true, reason: "ok" },
        { check: "responses_count", pass: false, reason: "got 30 responses, expected 32" },
      ],
    });

    expect(v.failures).toEqual(["responses_count: got 30 responses, expected 32"]);
    expect(v.cleared).toEqual(["json_parse"]);
  });

  it("reports a judge that refused before it scored anything", () => {
    const v = summarizeVerdict({ score: 0, reason: "solution exited 1" });
    expect(v.failures).toEqual(["solution exited 1"]);
  });

  // Contract fields are shown elsewhere on the page; repeating them as
  // anonymous key/value rows would bury the one line that matters.
  //
  // `category` is deliberately NOT in this list any more. It costs MBTI a
  // near-useless "category personality" row, and it buys pdf-chart-reasoning
  // the field its failures actually cluster by — read_length 0/3 against
  // semantic 4/4. The trade is worth it.
  it("does not repeat the fields the page already shows", () => {
    const keys = summarizeVerdict(MBTI_PASS).facets.map((f) => f.key);
    for (const noise of ["score", "agent_answer", "raw_responses", "id"]) {
      expect(keys).not.toContain(noise);
    }
  });

  it("shows a metric no task has invented yet, because it sorts by shape", () => {
    const v = summarizeVerdict({ score: 1, tone: "formal", hedges: 3 });
    expect(v.facets).toEqual([
      { key: "tone", value: "formal" },
      { key: "hedges", value: "3" },
    ]);
  });

  it("stays quiet for a judge that printed nothing but a score", () => {
    expect(hasSubstance(summarizeVerdict({ score: 1, passed: true }))).toBe(false);
  });
});

// Captured from pdf-chart-reasoning's judge. It spells its matchers
// {kind, passed, detail} under `matchers`, not {check, pass, reason} under
// `matcher_results` — reading only the first spelling silently dropped every
// explanation this judge prints.
const PDF_FAIL = {
  score: 0,
  passed: false,
  reason: "committed_value: committed 12, expected 13",
  category: "read_length",
  difficulty: "hard",
  matchers: [
    { kind: "committed_value", detail: "committed 12, expected 13", passed: false },
    { kind: "no_hedge", detail: "committed a value", passed: true },
  ],
  committed: "12 participants",
  committed_via: "answer line",
};

describe("a judge that spells its matchers differently", () => {
  it("reads matchers under either name, with either key set", () => {
    const v = summarizeVerdict(PDF_FAIL);

    expect(v.failures).toContain("committed_value: committed 12, expected 13");
    expect(v.cleared).toContain("no_hedge");
  });

  // The capability the case was written to probe. Failures on this task
  // cluster by it — read_length 0/3, semantic 4/4 — which makes it the most
  // informative thing the judge prints.
  it("shows the capability the case was probing", () => {
    expect(summarizeVerdict(PDF_FAIL).facets).toContainEqual({
      key: "category",
      value: "read_length",
    });
  });

  it("does not also render the matcher list as an anonymous facet", () => {
    const keys = summarizeVerdict(PDF_FAIL).facets.map((f) => f.key);
    expect(keys).not.toContain("matchers");
  });

  it("still keeps what the agent committed to", () => {
    expect(summarizeVerdict(PDF_FAIL).facets).toContainEqual({
      key: "committed",
      value: "12 participants",
    });
  });
});
