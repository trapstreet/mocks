// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { loadPyodide } from "pyodide";
import { createJudgeRunner, type PyRuntime } from "./judge-runner";
import type { TaskBundle } from "./fetch-task";

// Real Pyodide, real judge source. Mocking the runtime here would test the
// mock: the entire claim of this module is that a task's own Python scores
// the answer, so the test has to run that Python.

// judge.py of karpathys-jagged-questions at e13950d, byte for byte.
const JUDGE = `"""Per-case judge for the jagged-intelligence car-wash question."""

import json
import os
import re
from pathlib import Path

if __name__ == "__main__":
    manifest = json.loads(os.environ["TRAPTASK_MANIFEST"])
    answer = Path(manifest["run"]["stdout"]).read_text().lower()
    expected = json.loads((Path(manifest["expected_dir"]) / "expected.json").read_text())

    first_word = re.search(r"[a-z]+", answer)
    passed = first_word is not None and first_word.group() == expected["verdict"].lower()
    print(json.dumps({"passed": passed, "score": 1.0 if passed else 0.0}))
`;

const GRADER = `"""Overall grader."""
import json
import os

if __name__ == "__main__":
    results = json.loads(os.environ["TRAPTASK_MANIFEST"])
    scores = [r["metrics"]["score"] for r in results if r["metrics"]]
    if scores:
        print(json.dumps({"passed": all(s == 1.0 for s in scores), "score": sum(scores) / len(scores)}))
    else:
        print(json.dumps({"passed": False, "score": 0.0, "error": "no scored cases"}))
`;

// Shape of every judge actually in trapstreet-tasks: a score and whatever
// detail the task wants surfaced, and NO `passed` key. The fixture above
// prints one, which is why reading `metrics.passed` looked correct in tests
// while marking every real answer FAILED in the browser.
const SCORE_ONLY_JUDGE = `import json
import os
from pathlib import Path

if __name__ == "__main__":
    manifest = json.loads(os.environ["TRAPTASK_MANIFEST"])
    answer = Path(manifest["run"]["stdout"]).read_text().strip()
    ok = answer.isdigit()
    print(json.dumps({"score": 1.0 if ok else 0.4, "shape": "digits" if ok else "other"}))
`;

const bundle = (over: Partial<TaskBundle> = {}): TaskBundle => ({
  traptask: {
    inputsDir: "inputs",
    expectedDir: "expected",
    declaredOutputs: ["stdout"],
    cases: [{ id: "car_wash_50m", description: "" }],
  },
  modules: { "judge.py": JUDGE, "grader.py": GRADER },
  cases: [{ id: "car_wash_50m", description: "", question: "walk or drive?" }],
  expected: { car_wash_50m: { "expected.json": '{"verdict": "drive"}' } },
  runnable: true,
  reason: null,
  packages: [],
  ...over,
});

let py: PyRuntime;
beforeAll(async () => {
  py = (await loadPyodide()) as unknown as PyRuntime;
}, 120_000);

describe("createJudgeRunner", () => {
  it("scores with the task's own judge, not a reimplementation of it", () => {
    const r = createJudgeRunner(py, bundle());

    expect(r.judgeCase("car_wash_50m", "DRIVE — the car has to get there.")).toMatchObject({
      passed: true,
      score: 1,
    });
    expect(r.judgeCase("car_wash_50m", "WALK, it is only 50 m.")).toMatchObject({
      passed: false,
      score: 0,
    });
  });

  // Each of these is a rule of THIS judge, faithfully inherited rather than
  // guessed at: markdown is skipped, case is ignored, and an answer that
  // does not open with the verdict fails even when it agrees.
  it.each([
    ["**DRIVE**, the car needs washing", true, "markdown prefix"],
    ["  \n\n drive\n", true, "leading whitespace, lowercase"],
    ["I would drive.", false, "agrees but ignores the format instruction"],
    ["", false, "empty answer"],
  ])("%s → passed=%s (%s)", (answer, want) => {
    const r = createJudgeRunner(py, bundle());
    expect(r.judgeCase("car_wash_50m", answer as string).passed).toBe(want);
  });

  it("aggregates through the task's own grader", () => {
    const r = createJudgeRunner(py, bundle());
    const a = r.judgeCase("car_wash_50m", "DRIVE");
    const b = r.judgeCase("car_wash_50m", "WALK");

    expect(r.grade([a])).toEqual({ passed: true, score: 1 });
    expect(r.grade([a, b])).toEqual({ passed: false, score: 0.5 });
  });

  // Two contract generations are live at once. The newer judges read
  // manifest["run"]["stdout"] and expected_dir; the older ones read
  // payload["outputs"]["case_stdout"] and payload["expected"]["answer.json"].
  // cross-timezone is the second kind, and it died on KeyError: 'outputs'
  // until the runner served both shapes from the same files.
  it("satisfies the older outputs/expected manifest shape too", () => {
    const r = createJudgeRunner(
      py,
      bundle({
        modules: {
          "judge.py": `
import json, os
from pathlib import Path
if __name__ == "__main__":
    payload = json.loads(os.environ["TRAPTASK_PAYLOAD"])
    stdout = Path(payload["outputs"]["case_stdout"]).read_text()
    exit_code = json.loads(Path(payload["outputs"]["case_meta.json"]).read_text())["exit_code"]
    expected = json.loads(Path(payload["expected"]["expected.json"]).read_text())
    ok = stdout.strip().lower() == expected["verdict"] and exit_code == 0
    print(json.dumps({"passed": ok, "score": 1.0 if ok else 0.0}))
`,
        },
      }),
    );
    expect(r.judgeCase("car_wash_50m", "drive").passed).toBe(true);
    expect(r.judgeCase("car_wash_50m", "walk").passed).toBe(false);
  });

  it("offers an optional outputs file only when the task declares one", () => {
    const r = createJudgeRunner(
      py,
      bundle({
        modules: {
          "judge.py": `
import json, os
if __name__ == "__main__":
    payload = json.loads(os.environ["TRAPTASK_PAYLOAD"])
    print(json.dumps({"passed": payload["outputs"].get("usage.json") is None, "score": 1.0}))
`,
        },
      }),
    );
    expect(r.judgeCase("car_wash_50m", "drive").passed).toBe(true);
  });

  it("resolves a helper module sitting beside the judge", () => {
    const r = createJudgeRunner(
      py,
      bundle({
        modules: {
          "keys.py": "VERDICT_KEY = 'verdict'\n",
          "judge.py": `
import json, os
from pathlib import Path
import keys
if __name__ == "__main__":
    m = json.loads(os.environ["TRAPTASK_MANIFEST"])
    exp = json.loads((Path(m["expected_dir"]) / "expected.json").read_text())
    ans = Path(m["run"]["stdout"]).read_text().strip().lower()
    ok = ans == exp[keys.VERDICT_KEY]
    print(json.dumps({"passed": ok, "score": 1.0 if ok else 0.0}))
`,
        },
      }),
    );
    expect(r.judgeCase("car_wash_50m", "drive").passed).toBe(true);
  });

  // The contract several judges state in their own docstrings: the verdict
  // is the LAST line of stdout, diagnostics go above it. Scanning for the
  // last "{" instead tore a nested object in half and lost real verdicts.
  it("takes the last JSON line, not the last brace", () => {
    const r = createJudgeRunner(
      py,
      bundle({
        modules: {
          "judge.py": `
import json
if __name__ == "__main__":
    print("parsing the answer…")
    print("nested braces { like this } in a log line")
    print(json.dumps({"passed": True, "score": 1.0, "detail": {"reason": "ok", "seen": {"a": 1}}}))
`,
        },
      }),
    );
    const out = r.judgeCase("car_wash_50m", "drive");
    expect(out.passed).toBe(true);
    expect(out.metrics.detail).toMatchObject({ reason: "ok" });
  });

  // A judge that raises must not poison the next case by leaving stdout
  // swapped out from under the runtime.
  it("keeps working after a judge blows up", () => {
    const broken = createJudgeRunner(
      py,
      bundle({ modules: { "judge.py": 'raise RuntimeError("boom")' } }),
    );
    expect(() => broken.judgeCase("car_wash_50m", "drive")).toThrow();

    const good = createJudgeRunner(py, bundle());
    expect(good.judgeCase("car_wash_50m", "DRIVE").passed).toBe(true);
  });
});

describe("a judge that prints only a score", () => {
  const scoreOnly = () =>
    createJudgeRunner(py, bundle({ modules: { "judge.py": SCORE_ONLY_JUDGE } }));

  // No judge in trapstreet-tasks prints `passed`. Requiring it marked a
  // perfect answer FAILED on screen while the grader beside it said passed.
  it("counts a perfect score as passed, the way the platform does", () => {
    const r = scoreOnly().judgeCase("car_wash_50m", "42");
    expect(r.score).toBe(1);
    expect(r.passed).toBe(true);
  });

  // The platform counts a case passed only at exactly 1.0
  // (cases_passed in src/lib/queries.ts), so partial credit is not a pass.
  it("does not call partial credit a pass", () => {
    const r = scoreOnly().judgeCase("car_wash_50m", "forty two");
    expect(r.score).toBe(0.4);
    expect(r.passed).toBe(false);
  });

  it("keeps the detail the judge surfaced", () => {
    expect(scoreOnly().judgeCase("car_wash_50m", "42").metrics.shape).toBe("digits");
  });
});

