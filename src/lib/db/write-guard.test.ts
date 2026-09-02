import { describe, expect, it, beforeEach } from "vitest";
import { checkRunWrite, resetRunWriteGuard, RUN_WRITE_LIMIT } from "./write-guard";

const run = (n = 0) => ({
  task_id: "pdf-mixed-scan",
  task_commit: "6afe24b4173db4ffb4c83da81c7cc93ce8a50943",
  persona: `baseline ${n}`,
  score: 1,
  passed: true,
  cases: [{ case_id: "case_01", passed: true, score: 1, answer: String(n), metrics: {} }],
});

const request = (ip = "203.0.113.9") =>
  new Request("https://mocks.trapstreet.run/api/runs", {
    method: "POST",
    headers: { "x-forwarded-for": `${ip}, 10.0.0.1` },
  });

describe("checkRunWrite", () => {
  beforeEach(() => resetRunWriteGuard());

  it("allows an ordinary first write", () => {
    expect(checkRunWrite(request(), run(), 1_000)).toEqual({ ok: true });
  });

  it("refuses the same payload from the same IP for a short window", () => {
    expect(checkRunWrite(request(), run(), 1_000)).toEqual({ ok: true });

    const out = checkRunWrite(request(), run(), 2_000);

    expect(out).toMatchObject({
      ok: false,
      status: 409,
      error: expect.stringContaining("already recorded"),
    });
  });

  it("rate limits many distinct writes from one IP", () => {
    for (let i = 0; i < RUN_WRITE_LIMIT.max; i += 1) {
      expect(checkRunWrite(request(), run(i), 1_000 + i)).toEqual({ ok: true });
    }

    expect(checkRunWrite(request(), run(99), 2_000)).toMatchObject({
      ok: false,
      status: 429,
    });
  });

  it("keeps separate IPs independent", () => {
    expect(checkRunWrite(request("203.0.113.9"), run(), 1_000)).toEqual({ ok: true });
    expect(checkRunWrite(request("203.0.113.10"), run(), 1_000)).toEqual({ ok: true });
  });
});
