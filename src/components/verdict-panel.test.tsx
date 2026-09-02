import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { VerdictPanel } from "./verdict-panel";

// vitest runs without `globals`, so testing-library's auto-cleanup never
// installs itself and one test's DOM leaks into the next.
afterEach(cleanup);

// The exact object the MBTI judge printed for a well-formed answer, captured
// by running trapstreet-tasks@cf92b66 judge.py locally.
const MBTI = {
  score: 1.0,
  matcher_results: [{ check: "json_parse", pass: true, reason: "ok" }],
  mbti_type: "INFP",
  percentages: {
    E_I: { E: 46.9, I: 53.1 },
    S_N: { S: 46.9, N: 53.1 },
    T_F: { T: 50.0, F: 50.0 },
    J_P: { J: 46.9, P: 53.1 },
  },
  bias_stats: { mean_response: 3.41, pct_agree: 50.0, acquiescence_suspected: false },
  raw_responses: [4, 4, 2],
  agent_answer: '{"responses": [4, 4, 2]}',
};

describe("VerdictPanel", () => {
  // This task scores 1.0 for anything well-formed, so a page that shows only
  // "passed · 1" has shown the visitor nothing they came for.
  it("puts the derived type on screen, not just the score", () => {
    render(<VerdictPanel metrics={MBTI} />);
    expect(screen.getByText("INFP")).toBeTruthy();
  });

  it("draws each axis with both sides and its proportion", () => {
    const { container } = render(<VerdictPanel metrics={MBTI} />);

    expect(screen.getByText("E 46.9")).toBeTruthy();
    expect(screen.getByText("53.1 I")).toBeTruthy();
    const filled = Array.from(container.querySelectorAll<HTMLElement>("[style*='width']"));
    expect(filled).toHaveLength(4);
    expect(filled[0].style.width).toBe("46.9%");
  });

  it("shows the bias statistics as a footnote rather than as bars", () => {
    render(<VerdictPanel metrics={MBTI} />);
    expect(screen.getByText("no")).toBeTruthy(); // acquiescence_suspected
    expect(screen.getByText("3.41")).toBeTruthy();
  });

  // A bare "failed" reads as a broken site rather than a wrong answer.
  it("explains a failure in the judge's own words", () => {
    render(
      <VerdictPanel
        metrics={{
          score: 0,
          matcher_results: [
            { check: "responses_count", pass: false, reason: "got 30 responses, expected 32" },
          ],
        }}
      />,
    );
    expect(screen.getByText(/got 30 responses, expected 32/)).toBeTruthy();
  });

  it("renders nothing when the judge said nothing worth showing", () => {
    const { container } = render(<VerdictPanel metrics={{ score: 1, passed: true }} />);
    expect(container.firstChild).toBeNull();
  });
});
