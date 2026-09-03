import { describe, expect, it } from "vitest";
import { caseListSummary, startsOpen, INLINE_CASES } from "./case-list";

describe("startsOpen", () => {
  it("keeps a short list on screen", () => {
    expect(startsOpen(1)).toBe(true);
    expect(startsOpen(INLINE_CASES)).toBe(true);
  });

  // Twenty-three questions and twenty-three answer boxes put the board a very
  // long way down the page — far enough that people stopped scrolling to it.
  it("collapses a long one", () => {
    expect(startsOpen(INLINE_CASES + 1)).toBe(false);
    expect(startsOpen(23)).toBe(false);
  });
});

describe("caseListSummary", () => {
  const s = (over: Partial<Parameters<typeof caseListSummary>[0]> = {}) =>
    caseListSummary({ total: 23, answered: 0, passed: 0, graded: false, ...over });

  it("says how many cases there are before anything has been answered", () => {
    expect(s()).toBe("23 cases");
  });

  it("counts progress while the run is going", () => {
    expect(s({ answered: 7 })).toBe("23 cases · 7 answered");
  });

  // The same thing submit_answer withholds: a running pass count on screen is
  // feedback a person can relay to the agent, which is the leak the tool layer
  // was changed to close.
  it("does not report passes until the grader has scored the set", () => {
    expect(s({ answered: 7, passed: 5 })).toBe("23 cases · 7 answered");
    expect(s({ answered: 7, passed: 5 })).not.toContain("passed");
  });

  it("reports the split once the set is graded", () => {
    expect(s({ answered: 23, passed: 14, graded: true })).toBe("23 cases · 14 passed, 9 failed");
  });

  it("says case, singular, when there is one", () => {
    expect(caseListSummary({ total: 1, answered: 0, passed: 0, graded: false })).toBe("1 case");
  });

  // A judge that crashed leaves a case answered but unscored; a negative
  // "failed" count would be worse than an approximate one.
  it("never reports a negative failure count", () => {
    expect(s({ answered: 2, passed: 5, graded: true })).toContain("0 failed");
  });
});
