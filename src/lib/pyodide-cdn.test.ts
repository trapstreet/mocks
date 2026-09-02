import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PYODIDE_VERSION, PYODIDE_INDEX_URL } from "./pyodide-cdn";

describe("the Pyodide the browser downloads", () => {
  // The judge-runner tests exercise the Node copy from node_modules. If the
  // browser were served a different build, every one of those guarantees
  // would be about a Python nobody ships.
  it("is the same version this repo depends on", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const declared = (pkg.dependencies.pyodide as string).replace(/^[\^~]/, "");
    expect(PYODIDE_VERSION).toBe(declared);
  });

  it("points at a pinned path, never a floating one", () => {
    expect(PYODIDE_INDEX_URL).toContain(PYODIDE_VERSION);
    expect(PYODIDE_INDEX_URL).not.toMatch(/latest|@main|\/next\//);
    expect(PYODIDE_INDEX_URL.endsWith("/")).toBe(true);
  });
});
