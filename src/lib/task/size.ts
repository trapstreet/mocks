import { parseTraptask } from "./traptask";
import type { TaskPin, UrlFetch } from "./fetch-task";

// How much work a board is, before anyone opens it.
//
// The directory used to say only which tasks exist. Two of them carry 54 and
// 108 cases, which in a chat window is an afternoon, not an attempt — and the
// card gave no hint of that. This reads one file per task, the task's own
// traptask.yaml, and counts what it lists.
//
// Deliberately not the whole bundle: `fetchTaskBundle` pulls every input and
// every expected file and lists the repo tree through the GitHub API, which is
// rate-limited for anonymous callers. Fifteen of those to render a directory
// would spend the quota the task pages need.

/** Above this, a chat-window attempt is a sitting, not a try. */
export const LONG_TASK = 20;

export interface TaskSize {
  cases: number;
  long: boolean;
}

const owner = (repoUrl: string) =>
  repoUrl.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$|\/$/g, "");

export async function fetchTaskSize(
  pin: TaskPin,
  fetchImpl: UrlFetch,
): Promise<TaskSize | null> {
  const prefix = pin.repo_path ? `${pin.repo_path.replace(/\/+$/, "")}/` : "";
  const url = `https://raw.githubusercontent.com/${owner(pin.repo_url)}/${pin.commit_sha}/${prefix}traptask.yaml`;

  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const cases = parseTraptask(await res.text()).cases.length;
    // A manifest that parses to nothing is unreadable, not a task with no
    // cases — reporting "0 cases" on a card would be a confident lie.
    if (cases === 0) return null;
    return { cases, long: cases >= LONG_TASK };
  } catch {
    // A size is a nicety. The directory renders without it.
    return null;
  }
}
