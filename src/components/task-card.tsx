import { stripInlineMarkdown } from "@/lib/emphasis";
import type { TaskSummary } from "@/lib/trapstreet";

// Directory card, following trapstreet's: a cell in a hairline grid, not a
// floating box. No radius, no shadow, no colour band — the identity is the
// mono ref line at the top and what sits on the bottom rule.
//
// That bottom slot is where trapstreet puts a board's headline score. This
// site has no runs of its own yet, and it must not borrow trapstreet's: the
// tasks are shared, the run records are not, and a figure from that board
// printed here would read as this site's number. So every card sits in the
// open-board state — dimmed, offering the attempt — which is exactly what
// these boards are until someone answers one here.
export function TaskCard({ task, refLabel }: { task: TaskSummary; refLabel: string }) {
  const ranked = task.rankingMetric !== "none";
  const summary = task.summary ? stripInlineMarkdown(task.summary) : "";

  return (
    // On a phone this is a directory row, not a tile: no min-height padding it
    // out to a square. Fifteen boards at the desktop card's height would be
    // three screens of scrolling.
    <a
      href={`/tasks/${task.id}`}
      className="flex h-full flex-col gap-2 border-b border-[var(--bdl)] p-4 transition-colors hover:bg-[var(--hov)] hover:no-underline sm:min-h-[190px] sm:gap-2.5 sm:border-r sm:p-[22px]"
    >
      <div className="flex justify-between gap-2 font-mono text-[11px] text-[var(--mut)]">
        <span className="truncate">
          {refLabel} · {task.id}
        </span>
        {/* Filled for a board that ranks, hollow for one that classifies —
            the MBTI task is `ranking_metric: none` and has no best answer.
            Unlabelled on purpose: an unexplained glyph should not appear to
            assert more than it does. */}
        <span aria-hidden="true" className={ranked ? "text-[var(--accT)]" : "text-[var(--mut)]"}>
          {ranked ? "◼" : "◻"}
        </span>
      </div>

      <span className="text-[16px] font-semibold leading-[1.25] text-[var(--head)]">
        {task.title}
      </span>

      {summary && (
        <span className="line-clamp-2 text-[13px] leading-[1.45] text-[var(--body)]">
          {summary}
        </span>
      )}

      <span className="mt-auto border-t border-[var(--bdl)] pt-2.5 font-mono text-[13px] text-[var(--accT)] sm:pt-3">
        sit it →
      </span>
    </a>
  );
}

// Atlas labels every board A1, A2 … D5 so a card can be named out loud. It is
// a catalogue number, not a screen coordinate: a serial position in the
// current ordering, counted in blocks of four, so it stays true at every
// column count.
const REF_BLOCK = 4;
export function sheetRef(i: number): string {
  return `${String.fromCharCode(65 + Math.floor(i / REF_BLOCK))}${(i % REF_BLOCK) + 1}`;
}
