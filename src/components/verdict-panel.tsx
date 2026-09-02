"use client";

import { summarizeVerdict, hasSubstance } from "@/lib/task/verdict";

// What the judge said, past pass/fail.
//
// Laid out by shape, not by task: a scalar is a line, a map of numeric maps is
// a row of bars, a flat map is a footnote. The MBTI task is why this exists —
// its score is 1.0 for anything well-formed, so the derived type is the whole
// result — but nothing here names it.

function Bar({ pct }: { pct: number }) {
  return (
    <span className="relative block h-[3px] w-full bg-[var(--bd)]">
      <span
        className="absolute inset-y-0 left-0 bg-[var(--acc)]"
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}

export function VerdictPanel({ metrics }: { metrics: Record<string, unknown> }) {
  const v = summarizeVerdict(metrics);
  if (!hasSubstance(v)) return null;

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-[var(--bd)] pt-3">
      {v.failures.length > 0 && (
        <ul className="flex flex-col gap-1">
          {v.failures.map((f, i) => (
            <li key={i} className="font-mono text-[12px] leading-[1.5] text-[var(--sec)]">
              <span className="text-[var(--mut)]">judge: </span>
              {f}
            </li>
          ))}
        </ul>
      )}

      {v.facets.length > 0 && (
        <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-1.5">
          {v.facets.map((f) => (
            <div key={f.key} className="flex items-baseline gap-2">
              <dt className="font-mono text-[11px] uppercase tracking-[0.1em] text-[var(--mut)]">
                {f.key.replace(/_/g, " ")}
              </dt>
              <dd className="text-[18px] font-bold tracking-[-0.02em] text-[var(--head)]">
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {v.gauges.length > 0 && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 sm:grid-cols-4">
          {v.gauges.map((g) => {
            const [a, b] = g.entries;
            if (!a) return null;
            return (
              <div key={g.name} className="flex flex-col gap-1">
                <div className="flex justify-between font-mono text-[11px] text-[var(--sec)]">
                  <span>
                    {a.label} {a.pct}
                  </span>
                  {b && (
                    <span className="text-[var(--mut)]">
                      {b.pct} {b.label}
                    </span>
                  )}
                </div>
                <Bar pct={a.pct} />
              </div>
            );
          })}
        </div>
      )}

      {v.details.map((d) => (
        <div key={d.name} className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-[var(--mut)]">
          {d.entries.map((e) => (
            <span key={e.key}>
              {e.key.replace(/_/g, " ")} <span className="text-[var(--sec)]">{e.value}</span>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
