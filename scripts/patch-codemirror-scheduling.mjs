import { readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(script), "..");
const original = "100 /* Work.Slice */";
const replacement = "12 /* Work.Slice: Puppyone interactive parser budget */";

/**
 * CodeMirror language 6.12.3 allows 100ms background parse slices when Chromium
 * supports isInputPending. That exceeds Desktop's 50ms long-task budget even
 * with no pending input. Bound each slice while retaining its total work budget,
 * incremental parse state, scheduling, and grammar. A 20k-character lookahead
 * bounds each syntax-publication projection; scrolling advances the target.
 * No document is truncated and visible syntax retains parsing priority.
 * Remove when upstream exposes a supported slice budget or adopts an equivalent.
 * Upstream: codemirror/language src/language.ts, ParseWorker.work.
 */
export function patchCodeMirrorScheduling(source, label = "@codemirror/language") {
  let result = source;
  const patches = [
    [original, replacement, 1],
    ["100000 /* Work.MaxParseAhead */", "20000 /* Work.MaxParseAhead: Puppyone bounded syntax lookahead */", 2],
  ];
  if (!source.includes("this.chunkBudget") || !source.includes("field.context.work")) {
    throw new Error(`${label}: background parser changed; review the scheduling patch before upgrading.`);
  }
  for (const [before, after, expected] of patches) {
    const occurrences = result.split(before).length - 1;
    const patched = result.split(after).length - 1;
    if (occurrences === 0 && patched === expected) continue;
    if (occurrences !== expected || patched !== 0) {
      throw new Error(`${label}: background parser changed; review the scheduling patch before upgrading.`);
    }
    result = result.replaceAll(before, after);
  }
  return { source: result, changed: result !== source };
}

export function patchInstalledCodeMirror() {
  let changed = false;
  for (const name of ["index.js", "index.cjs"]) {
    const filename = path.join(root, "node_modules/@codemirror/language/dist", name);
    const result = patchCodeMirrorScheduling(readFileSync(filename, "utf8"), name);
    if (result.changed) { writeFileSync(filename, result.source); changed = true; }
  }
  // Optimizer metadata does not hash postinstall changes to dependency bytes.
  if (changed) rmSync(path.join(root, "node_modules/.vite"), { recursive: true, force: true });
}
if (process.argv[1] && path.resolve(process.argv[1]) === script) patchInstalledCodeMirror();
