import { structuredPatch } from "diff";
import { redactSecretText } from "../agent-events.mjs";

const MAX_SOURCE = 128 * 1024;
const MAX_PREVIEW = 24 * 1024;
const MAX_FILES = 100;

/** Adapter utility: inputs are semantic file/diff values, never provider JSON.
 * It only prepares display evidence; it does not read files or apply edits. */
export function createAgentFileChangeEvidence(entries) {
  const deadline = performance.now() + 30;
  let remainingPreview = MAX_PREVIEW;
  return entries.slice(0, MAX_FILES).flatMap((entry) => {
    if (typeof entry?.path !== "string" || !entry.path.trim()) return [];
    const change = { path: entry.path.slice(0, 4096), kind: entry.kind || "update" };
    let preview = "";
    let counts = null;
    if (typeof entry.diff === "string") {
      const source = entry.diff;
      preview = source.slice(0, MAX_SOURCE);
      counts = source.length <= MAX_SOURCE ? countDiffLines(source) : null;
      if (source.length > MAX_SOURCE) change.truncated = true;
    } else if (typeof entry.before === "string" && typeof entry.after === "string") {
      if (entry.before.length + entry.after.length <= MAX_SOURCE && performance.now() < deadline) {
        const patch = structuredPatch("before", "after", entry.before, entry.after, "", "", {
          context: 3, maxEditLength: 4000, timeout: Math.max(1, deadline - performance.now()),
        });
        if (patch) {
          counts = { additions: 0, deletions: 0 };
          preview = patch.hunks.map((hunk) => {
            for (const line of hunk.lines) {
              if (line.startsWith("+")) counts.additions++;
              if (line.startsWith("-")) counts.deletions++;
            }
            // A replacement fragment does not establish absolute file line numbers.
            const header = entry.scope === "fragment" ? "@@"
              : `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
            const lines = entry.scope === "fragment" ? hunk.lines.filter(line => !line.startsWith("\\")) : hunk.lines;
            return [header, ...lines].join("\n");
          }).join("\n");
        } else change.truncated = true;
      } else change.truncated = true;
    } else if (typeof entry.after === "string") {
      // Write can overwrite an existing file. Its new text alone cannot prove a diff.
      preview = entry.after.slice(0, MAX_SOURCE);
      if (entry.after.length > MAX_SOURCE) change.truncated = true;
    }
    if (entry.basis) change.basis = entry.basis;
    if (counts && !entry.unknownMultiplicity) Object.assign(change, counts);
    const safePreview = redactSecretText(preview);
    if (safePreview.length > remainingPreview) change.truncated = true;
    change.diff = safePreview.slice(0, remainingPreview);
    remainingPreview = Math.max(0, remainingPreview - change.diff.length);
    return [change];
  });
}

function countDiffLines(source) {
  if (!source) return null;
  let additions = 0;
  let deletions = 0;
  let inHunk = false;
  let recognized = false;
  for (const line of source.split(/\r?\n/u)) {
    if (line.startsWith("@@")) { inHunk = true; recognized = true; continue; }
    if (/^(?:diff --git |Index: |\*\*\* (?:Update|Add|Delete) File:)/u.test(line)) {
      inHunk = false;
      continue;
    }
    if (!inHunk && /^(?:--- |\+\+\+ )/u.test(line)) continue;
    if (line.startsWith("+")) { additions++; recognized = true; }
    if (line.startsWith("-")) { deletions++; recognized = true; }
  }
  return recognized ? { additions, deletions } : null;
}
