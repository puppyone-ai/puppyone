/**
 * Parser for Git-style conflict markers produced by the V1 version
 * engine when the safe-merge stack can't combine two sides and the
 * conflict_policy falls through to a markers-emitting LWW.
 *
 * Engine output shape (from
 * `backend/src/mut_engine/application/conflict_policy.py:_try_conflict_markers`):
 *
 *     <<<<<<< current (server)
 *     ours' bytes (server's view at merge time)
 *     =======
 *     theirs' bytes (the just-submitted incoming version)
 *     >>>>>>> incoming
 *
 * A file can contain multiple such blocks (one per conflicted region).
 * Lines outside any block are unchanged shared context.
 *
 * The parser is intentionally tolerant of trailing-newline variation:
 * the engine appends ``\n`` to either side's content when it didn't
 * already end with one, so block payloads may or may not have a
 * trailing newline. We surface them as-is.
 */

export interface ConflictBlock {
  /** Zero-indexed line number where the ``<<<<<<<`` opener sits. */
  startLine: number;
  /** Zero-indexed line number where the ``>>>>>>>`` closer sits. */
  endLine: number;
  /** Content between the opener and the ``=======`` separator. */
  ours: string;
  /** Content between the separator and the closer. */
  theirs: string;
  /** Label after ``<<<<<<<`` (e.g. ``"current (server)"``). */
  oursLabel: string;
  /** Label after ``>>>>>>>`` (e.g. ``"incoming"``). */
  theirsLabel: string;
}

const OPEN = /^<<<<<<<\s*(.*)$/;
const SEPARATOR = /^=======\s*$/;
const CLOSE = /^>>>>>>>\s*(.*)$/;

/**
 * Find every conflict block in ``content``.
 *
 * Returns an empty array when no markers are present. Malformed
 * sequences (opener without closer, separator outside a block, etc.)
 * are skipped silently — the function never throws on user content
 * that happens to contain a ``<<<<<<<`` literal as unrelated source.
 */
export function parseConflictMarkers(content: string): ConflictBlock[] {
  if (!content || !content.includes('<<<<<<<')) {
    return [];
  }
  const lines = content.split('\n');
  const blocks: ConflictBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const openMatch = OPEN.exec(lines[i]);
    if (!openMatch) {
      i++;
      continue;
    }
    const startLine = i;
    const oursLabel = openMatch[1].trim();
    let sep = -1;
    let end = -1;
    let closeLabel = '';
    for (let j = i + 1; j < lines.length; j++) {
      if (sep === -1 && SEPARATOR.test(lines[j])) {
        sep = j;
        continue;
      }
      const closeMatch = CLOSE.exec(lines[j]);
      if (sep !== -1 && closeMatch) {
        end = j;
        closeLabel = closeMatch[1].trim();
        break;
      }
    }
    if (sep === -1 || end === -1) {
      // Malformed block — skip the opener and continue scanning.
      i++;
      continue;
    }
    blocks.push({
      startLine,
      endLine: end,
      ours: lines.slice(startLine + 1, sep).join('\n'),
      theirs: lines.slice(sep + 1, end).join('\n'),
      oursLabel,
      theirsLabel: closeLabel,
    });
    i = end + 1;
  }
  return blocks;
}

/**
 * Rewrite ``content`` replacing every conflict block with the side
 * chosen by ``pick`` (or with a custom resolution function). Returns
 * the rewritten content. When no markers are present, returns the
 * original content unchanged.
 */
export function resolveConflictMarkers(
  content: string,
  pick: 'ours' | 'theirs' | ((block: ConflictBlock) => string),
): string {
  const blocks = parseConflictMarkers(content);
  if (blocks.length === 0) {
    return content;
  }
  const lines = content.split('\n');
  // Walk blocks in reverse so line indices stay valid as we splice.
  const sorted = [...blocks].sort((a, b) => b.startLine - a.startLine);
  for (const block of sorted) {
    let replacement: string;
    if (pick === 'ours') {
      replacement = block.ours;
    } else if (pick === 'theirs') {
      replacement = block.theirs;
    } else {
      replacement = pick(block);
    }
    const replacementLines = replacement.split('\n');
    // Drop a trailing empty entry if `replacement` ended with \n —
    // the surrounding lines array already encodes the newline by
    // having distinct entries.
    if (
      replacementLines.length > 0 &&
      replacementLines[replacementLines.length - 1] === ''
    ) {
      replacementLines.pop();
    }
    lines.splice(
      block.startLine,
      block.endLine - block.startLine + 1,
      ...replacementLines,
    );
  }
  return lines.join('\n');
}

/**
 * Quick predicate — true when ``content`` plausibly contains at least
 * one full conflict block (opener + separator + closer). Faster than
 * a full parse when callers just want to decide whether to render
 * the marker UI.
 */
export function hasConflictMarkers(content: string | null | undefined): boolean {
  if (!content) return false;
  if (!content.includes('<<<<<<<')) return false;
  return parseConflictMarkers(content).length > 0;
}
