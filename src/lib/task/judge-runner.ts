import type { TaskBundle } from "./fetch-task";

// Running a task's own judge.py, unmodified, wherever Python can be hosted.
//
// This is the whole reason any conforming task works here without per-task
// code: nothing below interprets a task's scoring rules, it only reproduces
// the environment `tp` gives a judge — the TRAPTASK_MANIFEST contract — and
// reads back the JSON the judge prints. A judge that grades leniently, or
// strangely, grades exactly as leniently and strangely here as it does on
// someone's laptop, because it is the same file.

/** The slice of Pyodide this needs, named so tests can see the whole surface. */
export interface PyRuntime {
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: string, opts?: { encoding?: string }): void;
  };
  runPython(code: string, options?: { globals?: unknown }): unknown;
  toPy(obj: unknown): unknown;
}

export interface CaseResult {
  case_id: string;
  passed: boolean;
  score: number;
  metrics: Record<string, unknown>;
}

const ROOT = "/traptask";

export function createJudgeRunner(py: PyRuntime, bundle: TaskBundle) {
  // Task files land once. Sibling modules go on sys.path so a judge that
  // imports its own helper — secops-es-investigation imports keys.py —
  // resolves it the same way it would beside judge.py on disk.
  py.FS.mkdirTree(`${ROOT}/run`);
  for (const [name, src] of Object.entries(bundle.modules)) {
    py.FS.writeFile(`${ROOT}/${name}`, src);
  }
  for (const [caseId, files] of Object.entries(bundle.expected)) {
    py.FS.mkdirTree(`${ROOT}/expected/${caseId}`);
    for (const [name, src] of Object.entries(files)) {
      py.FS.writeFile(`${ROOT}/expected/${caseId}/${name}`, src);
    }
  }
  py.runPython(`
import sys, os
if ${JSON.stringify(ROOT)} not in sys.path:
    sys.path.insert(0, ${JSON.stringify(ROOT)})
os.chdir(${JSON.stringify(ROOT)})
`);

  /** Run `src` as if it were __main__ and return whatever JSON it printed. */
  function runAsMain(src: string, manifest: unknown): Record<string, unknown> {
    const payload = JSON.stringify(manifest);
    py.runPython(`
import os, sys, io
os.environ["TRAPTASK_MANIFEST"] = ${JSON.stringify(payload)}
# One task predates the rename and still reads TRAPTASK_PAYLOAD. Setting both
# costs nothing and keeps the runner from needing to know which is which.
os.environ["TRAPTASK_PAYLOAD"] = ${JSON.stringify(payload)}
_stdout, sys.stdout = sys.stdout, io.StringIO()
`);
    try {
      py.runPython(`
_source = ${JSON.stringify(src)}
_globals = {"__name__": "__main__", "__file__": "judge.py"}
try:
    exec(compile(_source, "judge.py", "exec"), _globals)
except SystemExit as _e:
    if _e.code not in (None, 0):
        raise
`);
    } finally {
      // Restore even on a judge that raises, or every later case would write
      // into a buffer nobody reads.
      py.runPython(`_out = sys.stdout.getvalue(); sys.stdout = _stdout`);
    }
    const printed = String(py.runPython(`_out`)).trim();
    if (!printed) throw new Error("the judge printed nothing");

    // Several judges say it in their own docstrings: diagnostics go above,
    // and the verdict is the LAST LINE of stdout. Hunting for the last "{"
    // instead cut nested verdicts in half — a detail object was enough to
    // lose a perfectly good score to a parse error.
    const lines = printed.split("\n").map((l) => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(lines[i]) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // Not this line. A judge is allowed to log whatever it likes above
        // its verdict, including text that merely looks like JSON.
      }
    }
    throw new Error(
      `the judge printed no JSON verdict (last line was: ${lines[lines.length - 1]?.slice(0, 80) ?? ""})`,
    );
  }

  return {
    judgeCase(caseId: string, answer: string): CaseResult {
      const stdoutPath = `${ROOT}/run/case_stdout`;
      const metaPath = `${ROOT}/run/case_meta.json`;
      py.FS.writeFile(stdoutPath, answer);
      // A solution that ran and printed exited cleanly. Older judges read
      // this file for exit_code and refuse to score without it.
      py.FS.writeFile(metaPath, JSON.stringify({ exit_code: 0 }));

      // Two contract generations are live at once, so both are served from
      // the same files rather than guessing which a judge will reach for.
      // cross-timezone reads payload["outputs"]["case_stdout"]; karpathys
      // reads manifest["run"]["stdout"]. Same bytes, two spellings.
      const expectedDir = `${ROOT}/expected/${caseId}`;
      const expectedPaths: Record<string, string> = {};
      for (const name of Object.keys(bundle.expected[caseId] ?? {})) {
        expectedPaths[name] = `${expectedDir}/${name}`;
      }
      const metrics = runAsMain(bundle.modules["judge.py"] ?? "", {
        run: { stdout: stdoutPath, meta: metaPath },
        expected_dir: expectedDir,
        outputs_dir: `${ROOT}/run`,
        outputs: { case_stdout: stdoutPath, "case_meta.json": metaPath },
        expected: expectedPaths,
      });
      const score = typeof metrics.score === "number" ? metrics.score : 0;
      return {
        case_id: caseId,
        // Judges do not print `passed` — none of the 53 in trapstreet-tasks
        // does, they print `score` and their own detail. Reading a key that is
        // never there marked every correct answer FAILED while the grader on
        // the same screen said passed. The platform derives the same verdict
        // from the same field (`cases_passed` counts cases whose score is
        // exactly 1.0, src/lib/queries.ts), so this matches what a local run
        // would report. An explicit `passed` still wins, for a judge that
        // decides to print one.
        passed: typeof metrics.passed === "boolean" ? metrics.passed : score === 1.0,
        score,
        metrics,
      };
    },

    /** The task's grader over the cases attempted so far. */
    grade(results: CaseResult[]): { passed: boolean; score: number } {
      const grader = bundle.modules["grader.py"];
      if (!grader) {
        const scored = results.map((r) => r.score);
        return {
          passed: scored.length > 0 && scored.every((s) => s === 1),
          score: scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : 0,
        };
      }
      const out = runAsMain(
        grader,
        results.map((r) => ({ case_id: r.case_id, metrics: r.metrics })),
      );
      return {
        passed: out.passed === true,
        score: typeof out.score === "number" ? out.score : 0,
      };
    },
  };
}
