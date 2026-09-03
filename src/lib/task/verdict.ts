// Reading a judge's own words back to the person watching.
//
// Every judge prints one JSON object and the runner keeps all of it, but the
// page has been showing two fields of it — passed and score — and dropping the
// rest. For a task graded pass/fail that loses a little. For a task whose
// score is only "your answer parsed" it loses everything: the MBTI judge
// grades format and surfaces the derived type, so `1.0 passed` is the least
// interesting thing it said.
//
// Nothing here knows what a task is. It sorts a judge's metrics by SHAPE —
// scalars, maps of scalars, maps of maps of numbers — so a task published
// tomorrow that surfaces something new renders without a line of new code.
// The contract keys below are skipped because the page shows them elsewhere.

const CONTRACT = new Set([
  "score",
  "passed",
  "matcher_results",
  "matchers",
  "agent_answer", // the page already shows what was submitted
  "reason",
  "id",
  // `category` used to be skipped as noise. On pdf-chart-reasoning it is the
  // capability the case was written to probe — read_length, semantic,
  // cross_figure — and it is the single most informative thing the judge
  // prints, because the failures cluster by it.
  "difficulty",
  "raw_responses", // the answer itself, in another spelling
  // Fields a solution reports about itself. They travel with a local run;
  // in a browser there is no usage.json, so they arrive empty or not at all.
  "model",
  "persona",
  "input_tokens",
  "output_tokens",
  "cache_creation_input_tokens",
  "cache_read_input_tokens",
  "usd_cost",
]);

export interface Gauge {
  name: string;
  entries: Array<{ label: string; pct: number }>;
}

export interface Verdict {
  /** Why it did not pass, in the judge's words. */
  failures: string[];
  /** Checks that did pass — evidence the judge ran, not just that we said so. */
  cleared: string[];
  /** Whatever else the judge chose to surface: `mbti_type` and its kin. */
  facets: Array<{ key: string; value: string }>;
  /** Nested numeric maps, e.g. per-axis percentages. */
  gauges: Gauge[];
  /** Flat nested maps, e.g. bias statistics. */
  details: Array<{ name: string; entries: Array<{ key: string; value: string }> }>;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const scalar = (v: unknown): string | null => {
  if (typeof v === "string") return v;
  // toFixed pads: 28.1 became "28.10" beside a bare "50". Round, then let
  // Number drop whatever trailing zeros the rounding created.
  if (typeof v === "number") return String(Number(v.toFixed(2)));
  if (typeof v === "boolean") return v ? "yes" : "no";
  return null;
};

const allNumbers = (o: Record<string, unknown>) =>
  Object.keys(o).length > 0 && Object.values(o).every((v) => typeof v === "number");

export function summarizeVerdict(metrics: Record<string, unknown>): Verdict {
  const out: Verdict = { failures: [], cleared: [], facets: [], gauges: [], details: [] };

  // A judge that refused before scoring says so at the top level.
  if (typeof metrics.reason === "string" && metrics.reason) out.failures.push(metrics.reason);

  // Judges do not agree on how to spell a matcher. One writes
  // {check, pass, reason}; pdf-chart-reasoning writes {kind, passed, detail}
  // under `matchers`. Reading only the first spelling silently dropped every
  // per-matcher explanation the second kind prints.
  const checks = metrics.matcher_results ?? metrics.matchers;
  if (Array.isArray(checks)) {
    for (const c of checks) {
      if (!isObj(c)) continue;
      const name =
        typeof c.check === "string" ? c.check : typeof c.kind === "string" ? c.kind : "check";
      const why =
        typeof c.reason === "string" ? c.reason : typeof c.detail === "string" ? c.detail : "";
      const failed = c.pass === false || c.passed === false;
      if (failed) out.failures.push(why ? `${name}: ${why}` : name);
      else out.cleared.push(name);
    }
  }

  for (const [key, value] of Object.entries(metrics)) {
    if (CONTRACT.has(key)) continue;

    const flat = scalar(value);
    if (flat !== null) {
      out.facets.push({ key, value: flat });
      continue;
    }
    if (!isObj(value)) continue;

    const nested = Object.entries(value).filter(([, v]) => isObj(v)) as Array<
      [string, Record<string, unknown>]
    >;
    // A map of numeric maps reads as proportions — the shape `percentages`
    // uses. Rendered as bars rather than as sixteen key/value rows.
    if (nested.length === Object.keys(value).length && nested.every(([, v]) => allNumbers(v))) {
      for (const [name, axis] of nested) {
        out.gauges.push({
          name,
          entries: Object.entries(axis).map(([label, pct]) => ({
            label,
            pct: Math.max(0, Math.min(100, pct as number)),
          })),
        });
      }
      continue;
    }

    const entries = Object.entries(value)
      .map(([k, v]) => ({ key: k, value: scalar(v) }))
      .filter((e): e is { key: string; value: string } => e.value !== null);
    if (entries.length) out.details.push({ name: key, entries });
  }

  return out;
}

/** True when the judge said something worth showing beyond pass/fail. */
export function hasSubstance(v: Verdict): boolean {
  return (
    v.failures.length > 0 || v.facets.length > 0 || v.gauges.length > 0 || v.details.length > 0
  );
}
