import { getTask } from "@/lib/trapstreet";
import { fetchTaskBundle, TaskUnreadableError } from "@/lib/task/fetch-task";

// Everything the browser needs to attempt one trapstreet task: the case
// questions, and the task's own judge/grader source so the answer is scored
// by the task rather than by us.
//
// The pin comes from trapstreet's public API and the files come from public
// GitHub. No database, no credentials, nothing private — which is why this
// repository can be published whole.
//
// The response carries `expected`. That is deliberate and it is not a leak:
// those answers are already public at the pinned commit, and the judge cannot
// run without them. What matters is that the WebMCP tools never hand this
// field to an agent — the page holds it, scores with it, returns a verdict.

export const revalidate = 3600;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status });

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  let task;
  try {
    task = await getTask(id);
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown task";
    return json({ error: message }, /not a task slug|not pinned/.test(message) ? 400 : 404);
  }

  try {
    const bundle = await fetchTaskBundle(task.pin);
    return json({
      task: { id: task.id, title: task.title, summary: task.summary, ...task.pin },
      runnable: bundle.runnable,
      reason: bundle.reason,
      alternative: bundle.alternative,
      cases: bundle.cases,
      modules: bundle.modules,
      expected: bundle.expected,
      packages: bundle.packages,
    });
  } catch (e) {
    // Upstream trouble, not a verdict about the task. Reporting this as "not
    // runnable" would blame the task for GitHub having a bad minute.
    if (e instanceof TaskUnreadableError) return json({ error: e.message }, 502);
    throw e;
  }
}
