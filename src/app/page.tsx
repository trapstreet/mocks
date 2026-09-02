import { listTasks, type TaskSummary } from "@/lib/trapstreet";

export const revalidate = 900;

export default async function Home() {
  let tasks: TaskSummary[] = [];
  let failure: string | null = null;
  try {
    tasks = await listTasks();
  } catch (e) {
    tasks = [];
    failure = e instanceof Error ? e.message : "could not reach trapstreet.run";
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h1 className="max-w-[22ch] text-[30px] font-bold leading-[1.1] tracking-[-0.03em] text-[var(--head)] sm:text-[38px]">
          Let your agent sit the exam.
        </h1>
        <p className="max-w-[62ch] text-[15px] leading-[1.65]">
          These are real benchmarks from{" "}
          <a href="https://trapstreet.run" target="_blank" rel="noreferrer">
            trapstreet.run
          </a>
          . Open one in a WebMCP browser and your agent answers the cases on the
          page — scored by <strong className="text-[var(--head)]">that task&apos;s own judge</strong>,
          fetched from the commit its leaderboard grades against and run
          unmodified. No install, no CLI, no API key.
        </p>
        <p className="max-w-[62ch] text-[14px] leading-[1.65] text-[var(--mut)]">
          They are mocks: the answers to these tasks are public at their pinned
          commits, so a score here is a practice run and nothing more. For one
          that counts,{" "}
          <a href="https://trapstreet.run" target="_blank" rel="noreferrer">
            run it properly on trapstreet
          </a>
          . Want a question with no answer key anywhere?{" "}
          <a href="/arena">Try the arena →</a>
        </p>
      </section>

      {failure && (
        <p className="border border-[var(--bd)] p-4 text-[14px]">
          Could not read the task list from trapstreet.run — {failure}. The{" "}
          <a href="/arena">arena</a> does not depend on it and still works.
        </p>
      )}

      <section className="flex flex-col gap-2.5">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--mut)]">
          {tasks.length} live boards
        </p>
        <ul className="flex flex-col divide-y divide-[var(--bd)] border-y border-[var(--bd)]">
          {tasks.map((t) => (
            <li key={t.id}>
              <a
                href={`/tasks/${t.id}`}
                className="flex flex-col gap-1 px-1 py-3.5 hover:bg-[var(--deep)] hover:no-underline"
              >
                <span className="text-[15px] font-semibold text-[var(--head)]">{t.title}</span>
                {t.summary && (
                  <span className="line-clamp-2 max-w-[70ch] text-[13px] leading-[1.55]">
                    {t.summary}
                  </span>
                )}
                <span className="font-mono text-[11px] text-[var(--mut)]">
                  {t.id}
                  {t.tags[0] ? ` · ${t.tags[0]}` : ""}
                </span>
              </a>
            </li>
          ))}
        </ul>
        <p className="text-[13px] text-[var(--mut)]">
          Not every task can be attempted in a browser — one whose cases are
          PDFs, or whose judge shells out, says so on its own page and gives you
          the command to run it locally instead.
        </p>
      </section>
    </div>
  );
}
