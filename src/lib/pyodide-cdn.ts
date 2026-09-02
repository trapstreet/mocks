// Pyodide is ~12 MB of wasm and stdlib. It is not bundled and not committed:
// the version below is the one declared in package.json, and the browser
// fetches it from the official CDN only when a visitor actually attempts a
// task. A test pins the two together, because a silent drift between the
// version we test against in Node and the one a browser downloads would mean
// judging answers on a different Python than the one we verified.
export const PYODIDE_VERSION = "314.0.6";
export const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
