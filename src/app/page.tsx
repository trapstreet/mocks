import { listTasks, type TaskSummary } from "@/lib/trapstreet";
import { TaskCard, sheetRef } from "@/components/task-card";
import { fetchTaskSize, type TaskSize } from "@/lib/task/size";

export const revalidate = 900;

export default async function Home() {
  let tasks: TaskSummary[] = [];
  let failure: string | null = null;
  try {
    tasks = await listTasks();
  } catch (e) {
    failure = e instanceof Error ? e.message : "could not reach trapstreet.run";
  }

  // One small file per task, fetched together. A failure costs that card its
  // case count and nothing else.
  const sizes: Array<TaskSize | null> = await Promise.all(
    tasks.map((t) => fetchTaskSize(t.pin, (url) => fetch(url))),
  );

  return (
    <div className="flex flex-col gap-7">
      <section className="flex flex-col gap-3">
        <h1 className="text-[30px] font-bold leading-[1.05] tracking-[-0.03em] text-[var(--head)] sm:text-[40px]">
          Sit a real benchmark in a browser tab.
        </h1>
        <p className="max-w-[68ch] text-[15px] leading-[1.65] text-[var(--txt)]">
          Every board below is a live task from{" "}
          <a href="https://trapstreet.run" target="_blank" rel="noreferrer">
            trapstreet.run
          </a>
          . Open one in a WebMCP browser, tell your agent to sit it, and watch
          each answer scored on the page by{" "}
          <strong className="font-semibold text-[var(--head)]">
            that task&apos;s own <code className="text-[var(--brt)]">judge.py</code>
          </strong>
          , run unmodified from the commit its leaderboard grades against. No
          install, no API key, and no per-task code here either — a task
          published tomorrow works the day it lands. The answers are public at
          those commits, so a score here is practice.{" "}
          <a href="/arena">The arena has a question with no answer key anywhere →</a>
        </p>
      </section>

      {failure && (
        <p className="border border-[var(--bd)] p-4 text-[14px]">
          Could not read the task list from trapstreet.run — {failure}. The{" "}
          <a href="/arena">arena</a> does not depend on it and still works.
        </p>
      )}

      {tasks.length > 0 && (
        <section className="flex flex-col">
          <p className="pb-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--mut)]">
            {tasks.length} live boards
          </p>
          {/* Bled to the container edges and hairlined per cell, the way the
              directory reads on trapstreet: a sheet of boards, not a stack
              of floating boxes. */}
          <ul className="-mx-4 grid grid-cols-1 border-t border-[var(--bdl)] sm:grid-cols-2 lg:-mx-7 lg:grid-cols-3">
            {tasks.map((t, i) => (
              <li key={t.id} className="flex min-w-0">
                <TaskCard task={t} size={sizes[i] ?? null} refLabel={sheetRef(i)} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
