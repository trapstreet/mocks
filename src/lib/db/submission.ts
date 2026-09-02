import type { NewRun } from "./runs";

// Checking a run before it reaches the table.
//
// The write path is open — sign-in has not landed yet — so this is the only
// thing between a POST and the board. It is deliberately strict about shape
// and lengths and deliberately incurious about content: a run that scored
// badly is a legitimate record, and the board's job is to show what happened,
// not to decide what deserved to.

export const LIMITS = {
  persona: 60,
  taskId: 80,
  commit: 64,
  answer: 2000,
  cases: 200,
  /** A judge's metrics object, serialised. Generous; MBTI's is ~1KB. */
  metrics: 20_000,
} as const;

export class InvalidRun extends Error {}

const SLUG = /^[a-z0-9][a-z0-9-]*$/i;
const SHA = /^[0-9a-f]{7,64}$/i;
// A configuration name is shown on a public board and typed by whoever ran
// it. An allowlist of a dozen punctuation marks was the first attempt and it
// rejected an ordinary name — `gpt-5.6 + "answer as your true self" prompt` —
// because of the quotes. The name is rendered as text by React, which escapes
// it, so the rule that earns its place is narrow: no control characters, and
// no angle brackets, so the string can never read as markup anywhere it is
// later shown.
const PERSONA = /^[^\p{C}<>]+$/u;

function str(v: unknown, field: string, max: number): string {
  if (typeof v !== "string") throw new InvalidRun(`${field} must be a string`);
  const s = v.trim();
  if (!s) throw new InvalidRun(`${field} is required`);
  if (s.length > max) throw new InvalidRun(`${field} is longer than ${max} characters`);
  return s;
}

function finite(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new InvalidRun(`${field} must be a number`);
  }
  return v;
}

/**
 * Reads a POST body into a run, or explains what is wrong with it. Throws
 * InvalidRun so a route can answer 400 with the reason rather than 500 with
 * a stack trace.
 */
export function parseSubmission(body: unknown): NewRun {
  if (!body || typeof body !== "object") throw new InvalidRun("expected a JSON object");
  const b = body as Record<string, unknown>;

  const task_id = str(b.task_id, "task_id", LIMITS.taskId);
  if (!SLUG.test(task_id)) throw new InvalidRun("task_id is not a task slug");

  const task_commit = str(b.task_commit, "task_commit", LIMITS.commit);
  // A run must say which version of the task it answered. Tasks are pinned
  // per commit, and a record that cannot name its commit cannot be compared
  // with anything.
  if (!SHA.test(task_commit)) throw new InvalidRun("task_commit is not a commit sha");

  const persona = str(b.persona, "persona", LIMITS.persona);
  if (!PERSONA.test(persona)) throw new InvalidRun("persona contains unsupported characters");

  if (!Array.isArray(b.cases) || b.cases.length === 0) {
    throw new InvalidRun("a run with no cases is not a run");
  }
  if (b.cases.length > LIMITS.cases) {
    throw new InvalidRun(`a run may not carry more than ${LIMITS.cases} cases`);
  }

  const seen = new Set<string>();
  const cases = b.cases.map((raw, i) => {
    if (!raw || typeof raw !== "object") throw new InvalidRun(`case ${i} is not an object`);
    const c = raw as Record<string, unknown>;
    const case_id = str(c.case_id, `case ${i} case_id`, LIMITS.taskId);
    if (seen.has(case_id)) throw new InvalidRun(`case ${case_id} appears twice`);
    seen.add(case_id);

    const metrics =
      c.metrics && typeof c.metrics === "object" && !Array.isArray(c.metrics)
        ? (c.metrics as Record<string, unknown>)
        : {};
    if (JSON.stringify(metrics).length > LIMITS.metrics) {
      throw new InvalidRun(`case ${case_id} carries more metrics than will be stored`);
    }

    return {
      case_id,
      passed: c.passed === true,
      score: finite(c.score, `case ${case_id} score`),
      // Not trimmed: whitespace can be the difference between a passing
      // answer and a failing one, and this is the record of what was sent.
      answer: typeof c.answer === "string" ? c.answer.slice(0, LIMITS.answer) : "",
      metrics,
    };
  });

  return {
    task_id,
    task_commit,
    persona,
    score: b.score === null || b.score === undefined ? null : finite(b.score, "score"),
    passed: typeof b.passed === "boolean" ? b.passed : null,
    cases,
  };
}
