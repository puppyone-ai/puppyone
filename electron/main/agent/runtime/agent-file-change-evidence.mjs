import { structuredPatch } from "diff";
import { redactSecretText } from "../agent-events.mjs";
import { boundFileChangeBlocks, fileChangeBlocks } from "./agent-file-change-blocks.mjs";

const MAX_SOURCE = 128 * 1024;
const MAX_PREVIEW = 24 * 1024;
const MAX_FILES = 100;

/** Adapter utility: inputs are semantic file/diff values, never provider JSON.
 * It only prepares display evidence; it does not read files or apply edits. */
export function createAgentFileChangeEvidence(entries) {
  const deadline = performance.now() + 30;
  let remainingPreview = MAX_PREVIEW;
  let remainingBlocks = 100;
  return entries.slice(0, MAX_FILES).flatMap((entry) => {
    if (typeof entry?.path !== "string" || !entry.path.trim()) return [];
    const change = { path: entry.path.slice(0, 4096), kind: entry.kind || "update" };
    let preview = "";
    let counts = null;
    let isPatch = false;
    if (typeof entry.diff === "string") {
      isPatch = true;
      const source = entry.diff;
      preview = source.slice(0, MAX_SOURCE);
      counts = source.length <= MAX_SOURCE ? countDiffLines(source) : null;
      if (source.length > MAX_SOURCE) change.truncated = true;
    } else if (Array.isArray(entry.fragments) || (typeof entry.before === "string" && typeof entry.after === "string")) {
      const fragments = Array.isArray(entry.fragments) ? entry.fragments : [entry];
      let remainingSource = MAX_SOURCE;
      counts = { additions: 0, deletions: 0 };
      isPatch = true;
      for (const fragment of fragments.slice(0, 100)) {
        if (typeof fragment?.before !== "string" || typeof fragment?.after !== "string") { change.truncated = true; continue; }
        remainingSource -= fragment.before.length + fragment.after.length;
        if (remainingSource < 0 || performance.now() >= deadline) { change.truncated = true; break; }
        const patch = structuredPatch("before", "after", fragment.before, fragment.after, "", "", {
          context: 3, maxEditLength: 4000, timeout: Math.max(1, deadline - performance.now()),
        });
        if (patch) {
          const fragmentPreview = patch.hunks.map((hunk) => {
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
          preview += (preview && fragmentPreview ? "\n" : "") + fragmentPreview;
        } else change.truncated = true;
      }
      if (fragments.length > 100) change.truncated = true;
      if (change.truncated) counts = null;
    } else if (typeof entry.after === "string") {
      // Write can overwrite an existing file. Its new text alone cannot prove a diff.
      preview = entry.after.slice(0, MAX_SOURCE);
      if (entry.after.length > MAX_SOURCE) change.truncated = true;
    }
    if (entry.basis) change.basis = entry.basis;
    const safePreview = redactSecretText(preview);
    const blocks = isPatch ? fileChangeBlocks(safePreview) : null;
    if (counts && blocks !== null && !entry.unknownMultiplicity) Object.assign(change, counts);
    // Raw text and structured blocks share one budget, including their duplicated text.
    const blockPreview = boundFileChangeBlocks(blocks || [], Math.floor(remainingPreview / 2), remainingBlocks);
    change.blocks = blockPreview.blocks;
    remainingBlocks -= change.blocks.length;
    remainingPreview -= blockPreview.used;
    if (blockPreview.truncated || safePreview.length > remainingPreview) change.truncated = true;
    change.diff = safePreview.slice(0, remainingPreview);
    remainingPreview -= change.diff.length;
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
