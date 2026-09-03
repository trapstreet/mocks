import { emphasise } from "@/lib/emphasis";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTask } from "@/lib/trapstreet";
import { BenchmarkRunner } from "@/components/benchmark-runner";
import { RunBoard } from "@/components/run-board";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  try {
    const t = await getTask(id);
    return { title: t.title, description: t.summary || undefined };
  } catch {
    return { title: id };
  }
}

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let task;
  try {
    task = await getTask(id);
  } catch {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-[12px] text-[var(--mut)]">
          <a href="/">← all boards</a>
          {"  ·  "}
          <a
            href={`https://trapstreet.run/tasks/${task.id}`}
            target="_blank"
            rel="noreferrer"
          >
            this board on trapstreet ↗
          </a>
        </p>
        {/* No max-width: the constraint was wrapping titles that fit the rail
            perfectly well. The longest live title is 70 characters, which sits
            on one line at 24px and wraps on a phone, where it should. */}
        <h1 className="text-[21px] font-bold leading-[1.15] tracking-[-0.03em] text-[var(--head)] sm:text-[24px]">
          {task.title}
        </h1>
        {task.summary && (
          <p className="max-w-[64ch] text-[14px] leading-[1.6]">{emphasise(task.summary)}</p>
        )}
      </header>
      <BenchmarkRunner taskId={task.id} />
      <RunBoard taskId={task.id} />
    </div>
  );
}
