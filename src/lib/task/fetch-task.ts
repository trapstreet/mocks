import { parseTraptask, assessRunnable, type Traptask } from "./traptask";

// Everything a browser needs to attempt one task, read from the exact commit
// the board grades against. Nothing here knows any particular task: the file
// layout comes from the task's own traptask.yaml, and the code that will score
// an answer is the task's own judge.py, fetched and run unmodified.
//
// Pinned, never branched. A board's numbers belong to a commit, so an
// attempt scored against a moved main would be scored against a different
// task than the one on the leaderboard.

export interface TaskPin {
  repo_url: string;
  commit_sha: string;
  repo_path: string;
}

export interface TaskBundle {
  traptask: Traptask;
  /** judge.py, grader.py and any helper beside them, by basename. */
  modules: Record<string, string>;
  cases: Array<{ id: string; description: string; question: string; files: CaseInputFile[] }>;
  /** Per case, its expected/ files. Held by the page — never sent to an agent. */
  expected: Record<string, Record<string, string>>;
  runnable: boolean;
  reason: string | null;
  alternative?: { label: string; href: string };
  /** Pyodide packages the judge needs loaded before it can run. */
  packages: string[];
}

export interface CaseInputFile {
  id: string;
  name: string;
  path: string;
  url: string;
  view_url: string;
  kind: "text" | "pdf";
}

/**
 * The task could not be read at all — a spent rate limit, a GitHub outage, a
 * moved repo. Distinct from a verdict, because "we could not read it" and
 * "it cannot run here" are different sentences and only one of them is
 * about the task. Conflating them told visitors a perfectly ordinary task
 * was unrunnable whenever the anonymous quota ran out.
 */
export class TaskUnreadableError extends Error {
  constructor(what: string, status?: number) {
    super(`${what} could not be read from the pinned commit${status ? ` (HTTP ${status})` : ""}`);
    this.name = "TaskUnreadableError";
  }
}

const owner = (repoUrl: string) =>
  repoUrl.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");

const PDF = /\.pdf$/i;
const TEXT = /\.(txt|md|markdown|json|jsonl|csv|tsv|yaml|yml|xml|html?|log|py)$/i;
const SUPPORTED_INPUT = /\.(txt|md|markdown|json|jsonl|csv|tsv|yaml|yml|xml|html?|log|py|pdf)$/i;
const ext = (path: string) => {
  const at = path.lastIndexOf(".");
  return at >= 0 ? path.slice(at) : "unknown";
};

/**
 * Only ever called with a string URL, so it is typed that way: widening this
 * to `typeof fetch` bought nothing and made every test double a type error.
 */
export type UrlFetch = (url: string) => Promise<Response>;

export async function fetchTaskBundle(
  pin: TaskPin,
  fetchImpl: UrlFetch = (url) => fetch(url),
): Promise<TaskBundle> {
  const prefix = pin.repo_path ? `${pin.repo_path}/` : "";
  const raw = (p: string) =>
    `https://raw.githubusercontent.com/${owner(pin.repo_url)}/${pin.commit_sha}/${prefix}${p}`;
  const view = (p: string) =>
    `https://github.com/${owner(pin.repo_url)}/blob/${pin.commit_sha}/${prefix}${p}`;

  let lastStatus = 0;
  const text = async (p: string): Promise<string | null> => {
    const res = await fetchImpl(raw(p));
    if (!res.ok) lastStatus = res.status;
    return res.ok ? res.text() : null;
  };

  // One tree call for the whole commit, then only the files that matter. A
  // repo may hold many tasks, so everything is filtered by repo_path.
  const treeRes = await fetchImpl(
    `https://api.github.com/repos/${owner(pin.repo_url)}/git/trees/${pin.commit_sha}?recursive=1`,
  );
  const tree = treeRes.ok
    ? (((await treeRes.json()) as { tree?: Array<{ type: string; path: string }> }).tree ?? [])
    : [];
  const paths = tree
    .filter((n) => n.type === "blob" && n.path.startsWith(prefix))
    .map((n) => n.path.slice(prefix.length))
    .filter((p) => !p.startsWith("../"));

  const manifest = await text("traptask.yaml");
  if (manifest === null) throw new TaskUnreadableError("traptask.yaml", lastStatus);
  const traptask = parseTraptask(manifest);

  // Sibling .py only — a judge may import a helper next to it, but a nested
  // package is beyond what this runner promises.
  const moduleNames = paths.filter((p) => p.endsWith(".py") && !p.includes("/"));
  const modules: Record<string, string> = {};
  await Promise.all(
    moduleNames.map(async (name) => {
      const src = await text(name);
      if (src !== null) modules[name] = src;
    }),
  );

  const under = (dir: string, caseId: string) =>
    paths.filter((p) => p.startsWith(`${dir}/${caseId}/`));

  if (!modules["judge.py"]) {
    throw new TaskUnreadableError("judge.py", lastStatus);
  }

  const inputFiles = paths.filter((p) => p.startsWith(`${traptask.inputsDir}/`));
  const unsupported = inputFiles.filter((p) => !SUPPORTED_INPUT.test(p));
  const verdict: ReturnType<typeof assessRunnable> =
    unsupported.length > 0
      ? {
          runnable: false as const,
          reason:
            `its cases carry ${ext(unsupported[0])} inputs, ` +
            "which cannot be handed to an agent in this browser",
        }
      : assessRunnable({
          traptask,
          judgeSrc: modules["judge.py"],
          inputFiles,
          localModules: moduleNames,
        });

  if (!verdict.runnable) {
    return {
      traptask,
      modules,
      cases: traptask.cases.map((c) => ({
        id: c.id,
        description: c.description,
        question: "",
        files: [],
      })),
      expected: {},
      runnable: false,
      reason: verdict.reason,
      ...("alternative" in verdict && verdict.alternative
        ? { alternative: verdict.alternative }
        : {}),
      packages: [],
    };
  }

  const cases = await Promise.all(
    traptask.cases.map(async (c) => {
      const files = under(traptask.inputsDir, c.id);
      const visibleFiles: CaseInputFile[] = files
        .filter((f) => TEXT.test(f) || PDF.test(f))
        .sort()
        .map((f) => ({
          id: f,
          name: f.split("/").pop() ?? f,
          path: f,
          url: raw(f),
          view_url: view(f),
          kind: PDF.test(f) ? "pdf" : "text",
        }));
      // The question is whatever text the case ships. Concatenated in path
      // order when a case carries more than one file, so nothing is dropped
      // silently just because the layout was unexpected. PDFs stay as files:
      // WebMCP tools let the agent search/read them a page at a time.
      const parts = await Promise.all(
        files.filter((f) => TEXT.test(f)).sort().map((f) => text(f)),
      );
      return {
        id: c.id,
        description: c.description,
        question: parts.filter((p): p is string => p !== null).join("\n\n").trim(),
        files: visibleFiles,
      };
    }),
  );

  const expected: Record<string, Record<string, string>> = {};
  await Promise.all(
    traptask.cases.map(async (c) => {
      const files = under(traptask.expectedDir, c.id);
      const entry: Record<string, string> = {};
      await Promise.all(
        files.map(async (f) => {
          const src = await text(f);
          if (src !== null) entry[f.split("/").pop()!] = src;
        }),
      );
      expected[c.id] = entry;
    }),
  );

  return {
    traptask,
    modules,
    cases,
    expected,
    runnable: true,
    reason: null,
    packages: verdict.packages,
  };
}
