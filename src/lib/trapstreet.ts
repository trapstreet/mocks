// Everything this site knows about trapstreet, it reads from trapstreet's
// public API — the same JSON anyone can curl. No credentials, no database,
// no platform code. That is what lets this repo be published whole: it is a
// reader of someone else's board, not a copy of it.

import type { TaskPin } from "./task/fetch-task";

export const TRAPSTREET = "https://trapstreet.run";

export interface TaskSummary {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  pin: TaskPin;
  rankingMetric: string;
  rankingDirection: string;
}

/** Ids reach fetch paths, so they are checked before they get there. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,80}$/i;

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
type NextFetchInit = RequestInit & { next?: { revalidate?: number } };
const plainFetch: Fetcher = (url, init) =>
  fetch(url, {
    ...(init ?? {}),
    next: { revalidate: 900 },
  } as NextFetchInit);

async function readJson(res: Response, what: string): Promise<unknown> {
  if (!res.ok) throw new Error(`${what} failed (HTTP ${res.status})`);
  return res.json();
}

function toSummary(raw: Record<string, unknown>): TaskSummary | null {
  const latest = (raw.latest ?? {}) as Record<string, unknown>;
  const repo_url = latest.repo_url;
  const commit_sha = latest.commit_sha;
  // A task with no pinned public repo cannot be fetched from GitHub, so it
  // cannot be attempted here. Offering it would be a broken link.
  if (typeof repo_url !== "string" || !repo_url) return null;
  if (typeof commit_sha !== "string" || !commit_sha) return null;

  return {
    id: String(raw.id ?? ""),
    title: String(raw.title ?? raw.id ?? ""),
    summary: String(raw.summary ?? ""),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    pin: {
      repo_url,
      commit_sha,
      repo_path: typeof latest.repo_path === "string" ? latest.repo_path : "",
    },
    rankingMetric: String(latest.ranking_metric ?? "score"),
    rankingDirection: String(latest.ranking_direction ?? "desc"),
  };
}

export async function listTasks(fetchImpl: Fetcher = plainFetch): Promise<TaskSummary[]> {
  const body = (await readJson(
    await fetchImpl(`${TRAPSTREET}/api/tasks`),
    "listing trapstreet tasks",
  )) as { tasks?: unknown[] } | unknown[];
  const raw = Array.isArray(body) ? body : (body.tasks ?? []);
  return raw
    .filter((t): t is Record<string, unknown> => !!t && typeof t === "object")
    .map(toSummary)
    .filter((t): t is TaskSummary => t !== null && t.id.length > 0);
}

export async function getTask(
  id: string,
  fetchImpl: Fetcher = plainFetch,
): Promise<TaskSummary> {
  if (!SLUG.test(id)) throw new Error(`"${id}" is not a task slug`);
  const body = (await readJson(
    await fetchImpl(`${TRAPSTREET}/api/tasks/${id}`),
    `reading task ${id}`,
  )) as Record<string, unknown>;
  // The single-task endpoint answers with { task: {...} }; the list endpoint
  // answers with the task objects directly. Assuming they matched turned
  // every real task into a 400.
  const raw = (body.task ?? body) as Record<string, unknown>;
  const summary = toSummary(raw);
  if (!summary) throw new Error(`task ${id} is not pinned to a public repository`);
  return summary;
}

export interface BoardEntry {
  rank: number;
  // Optional because the board is someone else's JSON: an unranked board can
  // carry entries with no score at all, and a type that promised one would
  // have this site printing `undefined.toFixed`.
  score?: number;
  display_name?: string;
  models?: string[];
}

/**
 * The real board, for context after an attempt. A board that cannot be read
 * is reported as empty rather than thrown: it is a nice-to-have beside the
 * score, and losing it should not lose the score too.
 */
export async function getLeaderboard(
  taskId: string,
  fetchImpl: Fetcher = plainFetch,
): Promise<{ entries: BoardEntry[] }> {
  if (!SLUG.test(taskId)) return { entries: [] };
  try {
    const res = await fetchImpl(
      `${TRAPSTREET}/api/leaderboard?task_id=${encodeURIComponent(taskId)}`,
    );
    if (!res.ok) return { entries: [] };
    const body = (await res.json()) as { entries?: BoardEntry[] };
    return { entries: Array.isArray(body.entries) ? body.entries : [] };
  } catch {
    return { entries: [] };
  }
}
