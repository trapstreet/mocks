import { describe, expect, it, vi } from "vitest";
import { listTasks, getTask, getLeaderboard, TRAPSTREET } from "./trapstreet";

const task = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `Title for ${id}`,
  summary: "a summary",
  tags: ["demo"],
  latest: {
    repo_url: "https://github.com/o/r",
    commit_sha: "e13950d4882019936d16c6cf7b756b4d4fc68274",
    repo_path: "tasks/demo",
    ranking_metric: "score",
    ranking_direction: "desc",
  },
  ...over,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("listTasks", () => {
  it("reads trapstreet's public API, with no credentials of any kind", async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) =>
      json({ tasks: [task("a"), task("b")] }),
    );
    const out = await listTasks(f);

    expect(out.map((t) => t.id)).toEqual(["a", "b"]);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(`${TRAPSTREET}/api/tasks`);
    expect(init?.headers ?? {}).not.toHaveProperty("authorization");
    expect(init?.credentials).toBeUndefined();
  });

  // The site is a mirror of someone else's board: a task with no pinned
  // public repo cannot be fetched, so it must not be offered.
  it("drops tasks that are not pinned to a public repo", async () => {
    const f = vi.fn(async () =>
      json({ tasks: [task("ok"), task("local", { latest: { repo_url: null, commit_sha: "x" } })] }),
    );
    expect((await listTasks(f)).map((t) => t.id)).toEqual(["ok"]);
  });

  it("accepts a bare array as well as { tasks }", async () => {
    const f = vi.fn(async () => json([task("solo")]));
    expect((await listTasks(f)).map((t) => t.id)).toEqual(["solo"]);
  });

  it("throws with the status when trapstreet is unhappy", async () => {
    const f = vi.fn(async () => json({ error: "nope" }, 503));
    await expect(listTasks(f)).rejects.toThrow(/503/);
  });
});

describe("getTask", () => {
  it("brings back one task's pinned commit", async () => {
    const f = vi.fn(async (_url: string) => json(task("karpathys-jagged-questions")));
    const t = await getTask("karpathys-jagged-questions", f);

    expect(t.pin.commit_sha).toBe("e13950d4882019936d16c6cf7b756b4d4fc68274");
    expect(t.pin.repo_path).toBe("tasks/demo");
    expect(f.mock.calls[0][0]).toBe(`${TRAPSTREET}/api/tasks/karpathys-jagged-questions`);
  });

  // The single-task endpoint nests under { task }, the list endpoint does
  // not. Assuming they matched cost a live 400 on every real task.
  it("unwraps the { task } envelope the single-task endpoint uses", async () => {
    const f = vi.fn(async (_url: string) => json({ task: task("wrapped") }));
    expect((await getTask("wrapped", f)).id).toBe("wrapped");
  });

  it("reports a task that is not there, rather than returning a hollow one", async () => {
    const f = vi.fn(async () => json({ error: "not found" }, 404));
    await expect(getTask("ghost", f)).rejects.toThrow(/ghost|404/);
  });

  // Someone could put anything in the URL; it ends up in a fetch path.
  it("refuses an id that is not a plain slug", async () => {
    const f = vi.fn();
    await expect(getTask("../../etc/passwd", f)).rejects.toThrow(/slug/i);
    await expect(getTask("a b", f)).rejects.toThrow(/slug/i);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("getLeaderboard", () => {
  it("returns the entries a score can be compared against", async () => {
    const f = vi.fn(async (_url: string) =>
      json({ entries: [{ rank: 1, score: 0.9 }, { rank: 2, score: 0.7 }], sort: "score" }),
    );
    const board = await getLeaderboard("t", f);

    expect(board.entries).toHaveLength(2);
    expect(f.mock.calls[0][0]).toContain("task_id=t");
  });

  // An empty board is a fact about the task, not a failure of the fetch.
  it("treats an empty board as empty, not as an error", async () => {
    const f = vi.fn(async () => json({ entries: [] }));
    expect((await getLeaderboard("t", f)).entries).toEqual([]);
  });

  it("does not take the whole page down when the board cannot be read", async () => {
    const f = vi.fn(async () => json({}, 500));
    expect((await getLeaderboard("t", f)).entries).toEqual([]);
  });
});
