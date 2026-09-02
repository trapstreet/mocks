import { describe, expect, it, vi } from "vitest";
import { fetchTaskBundle, type TaskPin } from "./fetch-task";

const PIN: TaskPin = {
  repo_url: "https://github.com/owner/repo",
  commit_sha: "e13950d488200000000000000000000000000000",
  repo_path: "tasks/demo",
};

const TRAPTASK = `
dirs: { inputs: inputs/, expected: expected/ }
cases:
  - id: c1
    description: first
  - id: c2
    description: second
judge: { cmd: python3 judge.py }
`;

// A tree listing shaped like the GitHub API's, holding one helper module,
// a question per case, and an expected file per case.
const TREE = {
  tree: [
    { type: "blob", path: "tasks/demo/traptask.yaml" },
    { type: "blob", path: "tasks/demo/judge.py" },
    { type: "blob", path: "tasks/demo/grader.py" },
    { type: "blob", path: "tasks/demo/keys.py" },
    { type: "blob", path: "tasks/demo/inputs/c1/question.txt" },
    { type: "blob", path: "tasks/demo/inputs/c2/question.txt" },
    { type: "blob", path: "tasks/demo/expected/c1/expected.json" },
    { type: "blob", path: "tasks/demo/expected/c2/expected.json" },
    { type: "blob", path: "tasks/other/judge.py" }, // a sibling task, not ours
  ],
};

function fakeFetch(over: Record<string, string> = {}) {
  return vi.fn(async (url: string) => {
    if (url.includes("/git/trees/")) return json(TREE);
    const body =
      over[url] ??
      (url.endsWith("traptask.yaml")
        ? TRAPTASK
        : url.endsWith("judge.py")
          ? 'answer = manifest["run"]["stdout"]\nimport keys\n'
          : url.endsWith("keys.py")
            ? "KEY = 1\n"
            : url.endsWith("grader.py")
              ? "print('{}')\n"
              : url.includes("/inputs/")
                ? `question for ${url.split("/inputs/")[1]}`
                : `{"verdict": "drive"}`);
    return new Response(body, { status: 200 });
  });
}
const json = (o: unknown) =>
  new Response(JSON.stringify(o), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("fetchTaskBundle", () => {
  it("pins every fetch to the commit, never to a branch", async () => {
    const f = fakeFetch();
    await fetchTaskBundle(PIN, f);

    const urls = f.mock.calls.map((c) => c[0]);
    expect(urls.length).toBeGreaterThan(3);
    for (const u of urls) expect(u).toContain(PIN.commit_sha);
    expect(urls.some((u) => /\/(main|master|HEAD)\//.test(u))).toBe(false);
  });

  it("collects the judge, its siblings, and one question per case", async () => {
    const b = await fetchTaskBundle(PIN, fakeFetch());

    expect(b.traptask.cases.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(Object.keys(b.modules).sort()).toEqual(["grader.py", "judge.py", "keys.py"]);
    expect(b.cases.map((c) => c.question)).toEqual([
      "question for c1/question.txt",
      "question for c2/question.txt",
    ]);
  });

  it("keeps PDF inputs as files instead of putting their bytes in the question", async () => {
    const pdfTree = {
      tree: [
        { type: "blob", path: "tasks/demo/traptask.yaml" },
        { type: "blob", path: "tasks/demo/judge.py" },
        { type: "blob", path: "tasks/demo/inputs/c1/source.pdf" },
        { type: "blob", path: "tasks/demo/expected/c1/answer.json" },
      ],
    };
    const f = vi.fn(async (url: string) =>
      url.includes("/git/trees/")
        ? json(pdfTree)
        : fakeFetch({
            [`https://raw.githubusercontent.com/owner/repo/${PIN.commit_sha}/tasks/demo/traptask.yaml`]:
              "cases:\n  - id: c1\n    description: pdf case\n",
            [`https://raw.githubusercontent.com/owner/repo/${PIN.commit_sha}/tasks/demo/judge.py`]:
              'answer = manifest["run"]["stdout"]\n',
          })(url),
    );

    const b = await fetchTaskBundle(PIN, f);

    expect(b.runnable).toBe(true);
    expect(b.cases[0].question).toBe("");
    expect(b.cases[0].files).toEqual([
      {
        id: "inputs/c1/source.pdf",
        name: "source.pdf",
        path: "inputs/c1/source.pdf",
        url: `https://raw.githubusercontent.com/owner/repo/${PIN.commit_sha}/tasks/demo/inputs/c1/source.pdf`,
        kind: "pdf",
      },
    ]);
    expect(f.mock.calls.map((c) => c[0]).join("\n")).not.toContain("source.pdf");
  });

  it("keeps each case's expected files under that case", async () => {
    const b = await fetchTaskBundle(PIN, fakeFetch());
    expect(b.expected.c1).toEqual({ "expected.json": '{"verdict": "drive"}' });
    expect(b.expected.c2).toEqual({ "expected.json": '{"verdict": "drive"}' });
  });

  // A repo can hold many tasks; repo_path is what separates them.
  it("ignores files belonging to a different task in the same repo", async () => {
    const b = await fetchTaskBundle(PIN, fakeFetch());
    expect(Object.keys(b.modules)).not.toContain("../other/judge.py");
    expect(JSON.stringify(b)).not.toContain("tasks/other");
  });

  it("reports why a task cannot be attempted here", async () => {
    const f = fakeFetch({
      [`https://raw.githubusercontent.com/owner/repo/${PIN.commit_sha}/tasks/demo/judge.py`]:
        "import subprocess\nstdout\n",
    });
    const b = await fetchTaskBundle(PIN, f);
    expect(b.runnable).toBe(false);
    expect(b.reason).toContain("subprocess");
  });

  it("refuses unsupported binary inputs before fetching case bodies", async () => {
    const binTree = {
      tree: [
        { type: "blob", path: "tasks/demo/traptask.yaml" },
        { type: "blob", path: "tasks/demo/judge.py" },
        { type: "blob", path: "tasks/demo/inputs/c1/archive.zip" },
        { type: "blob", path: "tasks/demo/expected/c1/answer.json" },
      ],
    };
    const f = vi.fn(async (url: string) =>
      url.includes("/git/trees/")
        ? json(binTree)
        : fakeFetch({
            [`https://raw.githubusercontent.com/owner/repo/${PIN.commit_sha}/tasks/demo/traptask.yaml`]:
              "cases:\n  - id: c1\n    description: zip case\n",
            [`https://raw.githubusercontent.com/owner/repo/${PIN.commit_sha}/tasks/demo/judge.py`]:
              'answer = manifest["run"]["stdout"]\n',
          })(url),
    );

    const b = await fetchTaskBundle(PIN, f);

    expect(b.runnable).toBe(false);
    expect(b.reason).toContain(".zip");
    expect(b.expected).toEqual({});
    expect(f.mock.calls.map((c) => c[0]).join("\n")).not.toContain("archive.zip");
    expect(f.mock.calls.map((c) => c[0]).join("\n")).not.toContain("expected/c1");
  });

  // A GitHub outage or a spent rate limit must never masquerade as a verdict
  // about the task. "We could not read it" and "it cannot run here" are
  // different sentences and only one of them is the task's fault.
  it("throws when the manifest cannot be read, rather than calling the task unrunnable", async () => {
    const f = vi.fn(async (url: string) =>
      url.endsWith("traptask.yaml")
        ? new Response("rate limit", { status: 403 })
        : fakeFetch()(url),
    );
    await expect(fetchTaskBundle(PIN, f)).rejects.toThrow(/could not be read|403/i);
  });

  it("throws when the judge cannot be read", async () => {
    const f = vi.fn(async (url: string) =>
      url.endsWith("judge.py")
        ? new Response("nope", { status: 404 })
        : fakeFetch()(url),
    );
    await expect(fetchTaskBundle(PIN, f)).rejects.toThrow(/judge/i);
  });

  it("works for a task pinned at the repo root", async () => {
    const rootTree = {
      tree: [
        { type: "blob", path: "judge.py" },
        { type: "blob", path: "traptask.yaml" },
        { type: "blob", path: "inputs/c1/question.txt" },
        { type: "blob", path: "expected/c1/expected.json" },
      ],
    };
    const f = vi.fn(async (url: string) =>
      url.includes("/git/trees/")
        ? json(rootTree)
        : fakeFetch({
            [`https://raw.githubusercontent.com/owner/repo/${PIN.commit_sha}/judge.py`]:
              'answer = manifest["run"]["stdout"]\n',
          })(url),
    );
    const b = await fetchTaskBundle({ ...PIN, repo_path: "" }, f);
    expect(Object.keys(b.modules)).toEqual(["judge.py"]);
    expect(b.cases[0].question).toBe("question for c1/question.txt");
  });
});
