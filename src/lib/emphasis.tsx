import { Fragment, type ReactNode } from "react";

// Task summaries arrive from trapstreet's API as markdown, and this site has
// no markdown renderer. Left alone they showed their own syntax on the page a
// demo points at — `**32-question Likert questionnaire**`, and a Minecraft
// blurb that was more `[link](url)` than prose. Bold and links are all the
// summaries actually use; pulling in a renderer to serve two constructs would
// cost more than it returns.

// The URL branch allows one level of balanced parentheses: the summaries
// link to fandom and Wikipedia, where `..._(disambiguation)` is ordinary,
// and stopping at the first ")" cut those links in half and left the tail
// as visible punctuation.
const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(((?:[^()\s]|\([^()]*\))+)\)|`([^`]+)`/g;

// The summaries nest: the Minecraft blurb is `**[Minecraft](url)**`, bold
// wrapping a link. One pass unwraps the bold and leaves the link syntax
// showing, so both of these keep going until the text stops changing. The
// bound is a guard, not a limit — two levels is all the summaries use.
const MAX_NESTING = 4;

/** Plain text, for somewhere with no room for markup — a card, a <title>. */
export function stripInlineMarkdown(text: string): string {
  let out = text;
  for (let i = 0; i < MAX_NESTING; i++) {
    const next = out.replace(INLINE, (_m, bold, linkText, _url, code) =>
      bold ?? linkText ?? code ?? "",
    );
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * The same text as elements. Only http(s) links become anchors: the URL comes
 * from an API response, and a summary is not a reason to render whatever
 * scheme it happens to contain.
 */
export function emphasise(text: string, depth = 0): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;

  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const [, bold, linkText, url, code] = m;

    if (bold) {
      out.push(
        <strong key={at} className="font-semibold text-[var(--brt)]">
          {/* Bold wraps a link in several summaries, so the inside is parsed
              too rather than printed as syntax. */}
          {depth < MAX_NESTING ? emphasise(bold, depth + 1) : bold}
        </strong>,
      );
    } else if (code) {
      out.push(
        <code key={at} className="text-[var(--brt)]">
          {code}
        </code>,
      );
    } else if (linkText) {
      const safe = /^https?:\/\//i.test(url ?? "");
      out.push(
        safe ? (
          <a key={at} href={url} target="_blank" rel="noreferrer">
            {linkText}
          </a>
        ) : (
          <Fragment key={at}>{linkText}</Fragment>
        ),
      );
    }
    last = at + m[0].length;
  }

  if (last === 0) return text;
  if (last < text.length) out.push(text.slice(last));
  return <Fragment>{out}</Fragment>;
}
