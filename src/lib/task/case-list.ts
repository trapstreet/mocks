// How much of a case list to put on screen at once.
//
// A one-case task is a page. A twenty-three-case task is a page with
// twenty-three questions and twenty-three answer boxes on it, and the board
// underneath is a very long way down — far enough that scrolling to your own
// result stops being worth it. So a long list collapses, and says what it is
// hiding.
//
// The summary deliberately withholds the same thing `submit_answer` does: how
// many cases have passed, while the run is still going. A count on screen is
// feedback a person can relay to the agent, which is the leak the tool layer
// was changed to close.

/** At or below this, the whole list is on screen; above it, it collapses. */
export const INLINE_CASES = 3;

export function startsOpen(total: number): boolean {
  return total <= INLINE_CASES;
}

export interface CaseListState {
  total: number;
  answered: number;
  passed: number;
  /** True once the task's grader has scored the whole set. */
  graded: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function caseListSummary({ total, answered, passed, graded }: CaseListState): string {
  if (graded) {
    const failed = Math.max(0, answered - passed);
    return `${plural(total, "case")} · ${passed} passed, ${failed} failed`;
  }
  if (answered === 0) return plural(total, "case");
  return `${plural(total, "case")} · ${answered} answered`;
}
