/** Translate a textual patch into ordered display blocks. This never applies a
 * patch: context separates edits and is not presented as removed/added text. */
export function fileChangeBlocks(diff) {
  const blocks = [];
  let removed = [];
  let added = [];
  let inHunk = false;
  const flush = () => {
    if (removed.length || added.length) blocks.push({
      ...(removed.length ? { removed: removed.join("\n") } : {}),
      ...(added.length ? { added: added.join("\n") } : {}),
    });
    removed = []; added = [];
  };
  for (const line of diff.split(/\r?\n/u)) {
    if (line.startsWith("@@")) { flush(); inHunk = true; continue; }
    if (/^(?:diff --git |Index: |index |--- |\+\+\+ )/u.test(line) && !inHunk) continue;
    if (line.startsWith("diff --git ")) { flush(); inHunk = false; continue; }
    if (line === "\\ No newline at end of file") continue;
    if (line.startsWith("-")) { removed.push(line.slice(1)); continue; }
    if (line.startsWith("+")) { added.push(line.slice(1)); continue; }
    if (line.startsWith(" ") || line === "") { flush(); continue; }
    // Binary changes or unfamiliar formats remain readable as neutral output.
    return null;
  }
  flush();
  return blocks;
}

export function boundFileChangeBlocks(blocks, budget, maxBlocks = 100) {
  const result = [];
  let used = 0;
  let truncated = blocks.length > maxBlocks;
  for (const block of blocks.slice(0, maxBlocks)) {
    const next = {};
    for (const key of ["removed", "added"]) {
      if (typeof block[key] !== "string") continue;
      const available = Math.max(0, budget - used);
      if (block[key].length > available) truncated = true;
      if (available || !block[key].length) next[key] = block[key].slice(0, available);
      used += Math.min(block[key].length, available);
    }
    if (Object.keys(next).length) result.push(next);
  }
  return { blocks: result, used, truncated };
}
