import { describe, expect, it, vi } from "vitest";
import { runsForTask, recordRun, ANSWER_LIMIT } from "./runs";
import type { Sql } from "./client";

/**
 * A stand-in for the tagged template the Neon driver exports. It records what
 * it was asked and answers with whatever the test queued — including, in one
 * case, the Date objects Postgres actually returns.
 */
function fakeSql(replies: unknown[][]) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return Promise.resolve(replies.shift() ?? []);
  }) as unknown as Sql;
  return { sql, calls };
}

describe("runsForTask", () => {
  // The driver hands back Date objects; RunRow promises strings. The lie
  // surfaced downstream as `latest.localeCompare is not a function`, and only
  // once a second configuration existed — a one-element sort never calls its
  // comparator, so a single run looked fine.
  it("turns the driver's Date columns into the strings the type promises", async () => {
    const { sql } = fakeSql([
      [
        {
          id: "r1",
          task_id: "t",
          task_commit: "cf92b66",
          persona: "baseline",
          score: 1,
          passed: true,
          cases_total: 1,
          cases_passed: 1,
          user_login: null,
          started_at: new Date("2026-09-02T21:55:00.000Z"),
        },
      ],
    ]);

    const [row] = await runsForTask(sql, "t");

    expect(typeof row.started_at).toBe("string");
    expect(row.started_at).toBe("2026-09-02T21:55:00.000Z");
    expect(() => row.started_at.localeCompare("x")).not.toThrow();
  });

  it("leaves a string timestamp alone", async () => {
    const { sql } = fakeSql([[{ started_at: "2026-09-02T21:55:00.000Z" }]]);
    expect((await runsForTask(sql, "t"))[0].started_at).toBe("2026-09-02T21:55:00.000Z");
  });

  it("asks for one task's runs, newest first", async () => {
    const { sql, calls } = fakeSql([[]]);
    await runsForTask(sql, "do-llms-dream-of-intj");

    expect(calls[0].text).toMatch(/order by r\.started_at desc/);
    expect(calls[0].values).toContain("do-llms-dream-of-intj");
  });
});

describe("recordRun", () => {
  const run = {
    task_id: "t",
    task_commit: "cf92b66",
    persona: "baseline",
    score: 0.5,
    passed: false,
    cases: [
      { case_id: "a", passed: true, score: 1, answer: "ok", metrics: { x: 1 } },
      { case_id: "b", passed: false, score: 0, answer: "no", metrics: {} },
    ],
  };

  it("counts the passing cases rather than trusting the caller to", async () => {
    const { sql, calls } = fakeSql([[{ id: "run-1" }], [], []]);
    await recordRun(sql, run);

    // cases_total then cases_passed, as the insert lists them.
    expect(calls[0].values).toContain(2);
    expect(calls[0].values).toContain(1);
  });

  it("writes one row per case, under the new run's id", async () => {
    const { sql, calls } = fakeSql([[{ id: "run-1" }], [], []]);
    expect(await recordRun(sql, run)).toBe("run-1");

    expect(calls).toHaveLength(3);
    expect(calls[1].values[0]).toBe("run-1");
    expect(calls[2].values[1]).toBe("b");
  });

  it("cuts an answer to what the column will hold", async () => {
    const { sql, calls } = fakeSql([[{ id: "run-1" }], []]);
    await recordRun(sql, {
      ...run,
      cases: [{ ...run.cases[0], answer: "z".repeat(ANSWER_LIMIT + 100) }],
    });

    expect(calls[1].values.some((v) => typeof v === "string" && v.length === ANSWER_LIMIT)).toBe(
      true,
    );
  });

  // Reporting success for a run that was not written would put a row on the
  // board that does not exist.
  it("says so when the insert came back with no id", async () => {
    const { sql } = fakeSql([[]]);
    await expect(recordRun(sql, run)).rejects.toThrow(/not recorded/);
  });

  it("serialises the judge's metrics rather than passing an object", async () => {
    const { sql, calls } = fakeSql([[{ id: "run-1" }], [], []]);
    await recordRun(sql, run);

    expect(calls[1].values).toContain(JSON.stringify({ x: 1 }));
  });
});
