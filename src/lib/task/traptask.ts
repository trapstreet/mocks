import { load } from "js-yaml";

// Reading a task's own manifest to decide whether a browser can run it.
//
// trapstreet tasks share one contract — traptask.yaml declares the case list
// and where inputs and expected answers live, judge.py reads TRAPTASK_MANIFEST
// and prints {passed, score}. That contract is the whole reason a browser can
// host ANY conforming task without per-task code: the judge that scores an
// answer here is the task's own judge.py, fetched from the pinned commit and
// run unmodified. Nothing below hard-codes a single task.

export interface Traptask {
  inputsDir: string;
  expectedDir: string;
  declaredOutputs: string[];
  cases: Array<{ id: string; description: string }>;
}

const trimSlash = (s: string) => s.replace(/\/+$/, "");

export function parseTraptask(yaml: string): Traptask {
  const doc = (load(yaml) ?? {}) as Record<string, unknown>;
  const dirs = (doc.dirs ?? {}) as Record<string, string>;
  const rawCases = Array.isArray(doc.cases) ? doc.cases : [];
  const outputs = Array.isArray(doc.declared_outputs) ? doc.declared_outputs : [];

  return {
    // The scaffold writes dirs explicitly, but the convention holds without it.
    inputsDir: trimSlash(dirs.inputs ?? "inputs"),
    expectedDir: trimSlash(dirs.expected ?? "expected"),
    declaredOutputs: outputs.map(String),
    cases: rawCases
      .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
      .map((c) => ({
        id: String(c.id ?? ""),
        description: String(c.description ?? "").trim(),
      }))
      .filter((c) => c.id),
  };
}

// Modules Pyodide ships out of the box. Anything else in a judge's imports
// means it cannot run here — better to say so than to score wrongly.
const STDLIB = new Set([
  "json", "os", "re", "sys", "io", "math", "csv", "difflib", "string",
  "pathlib", "collections", "itertools", "functools", "statistics",
  "datetime", "decimal", "fractions", "textwrap", "unicodedata", "hashlib",
  "base64", "random", "typing", "dataclasses", "enum", "abc", "copy",
  "operator", "bisect", "heapq", "warnings", "traceback", "argparse",
  "html", "urllib", "uuid", "time", "glob", "shutil", "tempfile",
  // Not a module: `from __future__ import annotations` opens most of these
  // judges, and treating it as a missing package rejected five of them.
  "__future__",
]);

// Modules that exist in the runtime but are inert until their data package
// is fetched. zoneinfo imports fine and then raises ZoneInfoNotFoundError on
// every lookup, so refusing these tasks was right in effect and wrong in
// reason — the fix is to load the package, not to turn the task away.
const NEEDS_PACKAGE: Record<string, string> = { zoneinfo: "tzdata" };

const BINARY = /\.(pdf|png|jpe?g|gif|zip|tar|gz|xlsx?|docx?|parquet|db|sqlite3?|wav|mp[34]|bin)$/i;

export function assessRunnable(input: {
  traptask: Traptask;
  judgeSrc: string;
  inputFiles: string[];
  /** Basenames of .py files sitting beside judge.py in the task directory. */
  localModules?: string[];
}):
  | { runnable: true; packages: string[] }
  | { runnable: false; reason: string } {
  const { traptask, judgeSrc, inputFiles, localModules = [] } = input;

  // An agent in a browser can produce text and nothing else. The question is
  // therefore whether the judge grades the solution's stdout — which every
  // conforming task does today, but a future one need not. `declared_outputs`
  // is NOT the test: it is optional, and most live tasks omit it while still
  // grading stdout, so gating on it rejected ten runnable tasks.
  // A judge that asks for a link to evidence made somewhere else is trusting
  // the solution's own account of what it did. On trapstreet that is sound:
  // a run there carries provenance, and the video is a public artefact anyone
  // can check. Offered on an anonymous page it is not a benchmark at all —
  // both Minecraft tasks would be answered by typing
  // {"obtained": true, "video": "..."} without a block being mined.
  //
  // Detected from the judge's own source rather than from a list of task ids,
  // like every other rule here: across the live boards this matches exactly
  // the two tasks whose judges read a `video` field, and nothing else.
  if (/["'](video|recording|screencast|proof_url|evidence)["']/.test(judgeSrc)) {
    return {
      runnable: false,
      reason:
        "its judge trusts what the solution reports about itself and asks for a " +
        "video of the run as proof — an attempt typed into a page would be a " +
        "claim, not a result",
    };
  }

  if (!/stdout/.test(judgeSrc)) {
    return {
      runnable: false,
      reason:
        "its judge does not grade the solution's stdout, so a browser has no way to answer it",
    };
  }

  const imports = new Set(
    [...judgeSrc.matchAll(/^\s*(?:import|from)\s+([A-Za-z_][\w.]*)/gm)].map(
      (m) => m[1].split(".")[0],
    ),
  );
  // A judge may import a helper sitting next to it — secops-es-investigation
  // imports its own keys.py. Those are not missing dependencies; the runner
  // fetches every .py in the task directory, so they resolve.
  const local = new Set(localModules.map((f) => f.replace(/\.py$/, "")));
  const packages = [...imports]
    .filter((m) => m in NEEDS_PACKAGE)
    .map((m) => NEEDS_PACKAGE[m]);
  const missing = [...imports]
    .filter((m) => !STDLIB.has(m) && !local.has(m) && !(m in NEEDS_PACKAGE))
    .sort();
  if (missing.length) {
    return {
      runnable: false,
      reason: `its judge needs ${missing.join(", ")}, which is not available in the browser runtime`,
    };
  }

  const binary = inputFiles.filter((f) => BINARY.test(f));
  if (binary.length) {
    const ext = binary[0].slice(binary[0].lastIndexOf("."));
    return {
      runnable: false,
      reason: `its cases carry ${ext} inputs, which cannot be handed to an agent as text`,
    };
  }

  // Case count is patience, not capability: 108 cases is a long sitting, not
  // an impossible one, and refusing on size would quietly exclude the
  // thorough tasks — exactly the ones worth attempting.
  return { runnable: true, packages: [...new Set(packages)] };
}
