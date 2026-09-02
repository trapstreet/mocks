import { Fragment, type ReactNode } from "react";

// Task summaries come from trapstreet's API as markdown, and this site has no
// markdown renderer — so `**32-question Likert MBTI questionnaire**` was
// showing its asterisks on the page a demo points at. Bold is the only markup
// the summaries actually use; pulling in a renderer to serve one construct
// would cost more than it returns.

const BOLD = /\*\*([^*]+)\*\*/g;

export function emphasise(text: string): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(BOLD)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(<strong key={at} className="font-semibold text-[var(--brt)]">{m[1]}</strong>);
    last = at + m[0].length;
  }
  if (last === 0) return text;
  if (last < text.length) out.push(text.slice(last));
  return <Fragment>{out}</Fragment>;
}
