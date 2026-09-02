import { describe, expect, it } from "vitest";
import { parseTraptask, assessRunnable } from "./traptask";

// The real manifest of karpathys-jagged-questions at its pinned commit.
const REAL = `
name: Karpathy's jagged questions — the 50 m car wash

dirs:
  inputs: inputs/
  expected: expected/

declared_outputs:
  - stdout

cases:
  - id: car_wash_50m
    description: >-
      the car wash is 50 m away — walk or drive?
    tags: [jagged, smoke]

judge:
  cmd: uv run python judge.py

grader:
  cmd: uv run python grader.py
`;

describe("parseTraptask", () => {
  it("reads the shape a scaffolded task actually has", () => {
    const t = parseTraptask(REAL);
    expect(t.inputsDir).toBe("inputs");
    expect(t.expectedDir).toBe("expected");
    expect(t.declaredOutputs).toEqual(["stdout"]);
    expect(t.cases).toEqual([
      {
        id: "car_wash_50m",
        description: "the car wash is 50 m away — walk or drive?",
      },
    ]);
  });

  it("falls back to the conventional directories when dirs is absent", () => {
    const t = parseTraptask("cases:\n  - id: only\n");
    expect(t.inputsDir).toBe("inputs");
    expect(t.expectedDir).toBe("expected");
  });

  it("survives a manifest with no cases rather than throwing", () => {
    expect(parseTraptask("name: nothing here").cases).toEqual([]);
  });
});

// expect() cannot narrow a union for the compiler, and casting away the
// difference would let a passing result silently satisfy a "why not" check.
function refusal(r: ReturnType<typeof assessRunnable>): string {
  if (r.runnable) throw new Error("expected a refusal, got runnable");
  return r.reason;
}

describe("assessRunnable", () => {
  const base = {
    traptask: parseTraptask(REAL),
    judgeSrc: 'from __future__ import annotations\nimport json, os, re\nfrom pathlib import Path\nanswer = manifest["run"]["stdout"]\n',
    inputFiles: ["inputs/car_wash_50m/question.txt"],
  };

  it("accepts a stdout task whose judge is standard library only", () => {
    expect(assessRunnable(base)).toEqual({ runnable: true, packages: [] });
  });

  // Both Minecraft tasks are graded from what the solution says about itself,
  // with a video link as the credibility floor. That works on trapstreet,
  // where a run carries provenance and the video is a public artefact anyone
  // can check. On an anonymous page it is not a benchmark: the diamond is
  // obtained by typing {"obtained": true, "video": "..."}.
  it("refuses a judge that trusts a self-report backed by a video link", () => {
    const why = refusal(
      assessRunnable({
        ...base,
        judgeSrc:
          base.judgeSrc +
          'if not outcome.get("video"):\n    return {"score": 0.0}\n',
      }),
    );

    expect(why).toMatch(/video/);
    expect(why).toMatch(/claim, not a result/);
  });

  // Turning a task away without saying where it CAN be done leaves a dead
  // end on the page. The refusal carries the destination, because the rule
  // that refused is the only thing that knows why.
  it("sends a self-report task to a harness that actually plays it", () => {
    const r = assessRunnable({
      ...base,
      judgeSrc: base.judgeSrc + 'if not outcome.get("video"):\n    return 0.0\n',
    });

    expect(r.runnable).toBe(false);
    if (r.runnable) return;
    expect(r.alternative?.href).toMatch(/^https:\/\/github\.com\//);
    expect(r.alternative?.label).toMatch(/watch live/);
  });

  it("attaches no destination to a refusal that has none", () => {
    const r = assessRunnable({
      ...base,
      judgeSrc: 'import json\nresult = open("outputs/answer.json").read()\n',
    });
    expect(r.runnable).toBe(false);
    if (r.runnable) return;
    expect(r.alternative).toBeUndefined();
  });

  // The rule keys on the judge asking for evidence, not on the word appearing
  // anywhere — a task about video content is still gradable here.
  it("does not refuse a judge that merely mentions video in prose", () => {
    expect(
      assessRunnable({
        ...base,
        judgeSrc: base.judgeSrc + "# the answer describes a video frame\n",
      }).runnable,
    ).toBe(true);
  });

  // A browser has no way to produce a file the task grades.
  it("refuses a judge that never looks at the solution's stdout", () => {
    expect(refusal(assessRunnable({
      ...base,
      judgeSrc: 'import json\nresult = open("outputs/answer.json").read()\n',
    }))).toContain("stdout");
  });

  // declared_outputs is optional and most live tasks omit it while still
  // grading stdout — gating on it rejected ten runnable tasks.
  it("does not require declared_outputs to be present", () => {
    const t = parseTraptask(REAL.replace(/declared_outputs:\n  - stdout\n/, ""));
    expect(t.declaredOutputs).toEqual([]);
    expect(
      assessRunnable({ ...base, traptask: t, judgeSrc: base.judgeSrc + 'manifest["run"]["stdout"]' }),
    ).toMatchObject({ runnable: true });
  });

  // zoneinfo is in the runtime but its data is not, so it fails at lookup
  // rather than at import. Naming the package is what makes the task work.
  it("asks for the data package a stdlib module needs, instead of refusing", () => {
    const out = assessRunnable({
      ...base,
      judgeSrc: base.judgeSrc + "from zoneinfo import ZoneInfo\n",
    });
    expect(out).toEqual({ runnable: true, packages: ["tzdata"] });
  });

  it("refuses a judge that shells out", () => {
    expect(refusal(assessRunnable({ ...base, judgeSrc: base.judgeSrc + "import subprocess\n" }))).toContain("subprocess");
  });

  it("refuses a judge that needs a package Pyodide has not got", () => {
    expect(refusal(assessRunnable({ ...base, judgeSrc: base.judgeSrc + "import pdfplumber\n" }))).toContain("pdfplumber");
  });

  // secops-es-investigation imports its own keys.py. A sibling module is not
  // a missing dependency — the runner fetches every .py in the task directory.
  it("accepts a judge that imports a helper from its own directory", () => {
    const judgeSrc = base.judgeSrc + "import keys\n";
    expect(assessRunnable({ ...base, judgeSrc })).toMatchObject({ runnable: false });
    expect(
      assessRunnable({ ...base, judgeSrc, localModules: ["keys.py", "grader.py"] }),
    ).toMatchObject({ runnable: true });
  });

  it("refuses binary case inputs an agent cannot be handed as text", () => {
    expect(refusal(assessRunnable({
      ...base,
      inputFiles: ["inputs/scan_01/page.pdf", "inputs/scan_01/note.txt"],
    }))).toContain(".pdf");
  });

  // Case count is a matter of patience, not capability — never a refusal.
  it("does not refuse a task merely for having many cases", () => {
    const many = parseTraptask(
      REAL.replace(
        "  - id: car_wash_50m",
        Array.from({ length: 108 }, (_, i) => `  - id: c${i}`).join("\n"),
      ),
    );
    expect(assessRunnable({ ...base, traptask: many }).runnable).toBe(true);
  });
});
