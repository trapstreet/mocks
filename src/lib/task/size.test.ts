import { describe, expect, it, vi } from "vitest";
import { fetchTaskSize, LONG_TASK } from "./size";

const pin = {
  repo_url: "https://github.com/trapstreet/trapstreet-tasks",
  commit_sha: "cf92b6690b7c8b3430602dd3b72a8528c96e636b",
  repo_path: "tasks/personality/mbti_profile",
};

const yaml = (n: number) =>
  `dirs:\n  inputs: inputs/\n  expected: expected/\ncases:\n` +
  Array.from({ length: n }, (_, i) => `- id: case_${i}\n  description: "c"\n`).join("");

const reply = (body: string, status = 200) => new Response(body, { status });

// Typed so the mock's recorded calls carry the url argument; a bare
// `async () => …` infers a zero-length tuple and mock.calls[0][0] will not
// typecheck.
const fetcher = (fn: (url: string) => Promise<Response>) => vi.fn(fn);

describe("fetchTaskSize", () => {
  it("counts the cases the task's own manifest lists", async () => {
    const f = vi.fn(async () => reply(yaml(11)));
    expect(await fetchTaskSize(pin, f)).toEqual({ cases: 11, long: false });
  });

  // Two live boards carry 54 and 108 cases. In a chat window that is an
  // afternoon, and the card gave no hint of it.
  it("marks a board that is a sitting rather than a try", async () => {
    const f = vi.fn(async () => reply(yaml(LONG_TASK)));
    expect((await fetchTaskSize(pin, f))?.long).toBe(true);
  });

  // Reading one file, not the bundle: the bundle lists the repo tree through
  // the rate-limited GitHub API, and fifteen of those would spend the quota
  // the task pages need.
  it("reads only traptask.yaml, from the pinned commit", async () => {
    const f = fetcher(async () => reply(yaml(1)));
    await fetchTaskSize(pin, f);

    expect(f).toHaveBeenCalledTimes(1);
    const url = f.mock.calls[0][0];
    expect(url).toBe(
      "https://raw.githubusercontent.com/trapstreet/trapstreet-tasks/" +
        "cf92b6690b7c8b3430602dd3b72a8528c96e636b/tasks/personality/mbti_profile/traptask.yaml",
    );
    expect(url).not.toContain("api.github.com");
  });

  it("handles a task pinned at the repo root", async () => {
    const f = fetcher(async () => reply(yaml(1)));
    await fetchTaskSize({ ...pin, repo_path: "" }, f);
    expect(f.mock.calls[0][0]).toContain("/cf92b6690b7c8b3430602dd3b72a8528c96e636b/traptask.yaml");
  });

  // A size is a nicety; the directory has to render without it.
  it("returns nothing rather than throwing when the file cannot be read", async () => {
    expect(await fetchTaskSize(pin, vi.fn(async () => reply("", 404)))).toBeNull();
    expect(
      await fetchTaskSize(
        pin,
        vi.fn(async () => {
          throw new Error("network");
        }),
      ),
    ).toBeNull();
  });

  // "0 cases" on a card would be a confident lie about an unreadable file.
  it("reports nothing for a manifest that parses to no cases", async () => {
    expect(await fetchTaskSize(pin, vi.fn(async () => reply("dirs: {}")))).toBeNull();
  });
});
