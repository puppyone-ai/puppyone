/**
 * Local-untracked scanner for the federated grep / search pipeline.
 *
 * Contract: docs/proposals/PUP-federated-search.md §7.
 *
 * The local scanner exists for content the server CANNOT know about:
 *
 *   - paths matched by .gitignore / .puppyignore at the user's root,
 *   - newly-added files that haven't been committed yet,
 *   - working-tree-only files that simply aren't part of the repo.
 *
 * Anything ALREADY tracked by the server is excluded — the server
 * channel handles tracked content (and dualFetch shows local diffs
 * for tracked files in the same view). We never want to double-report
 * "TODO" hits that the server already returned.
 *
 * The tracked-path set is supplied by the caller as a Set<string>
 * built from /ap-fs/tree before the scan starts.
 *
 * Why we don't reuse a Node grep library:
 *   - bundle weight (zero new deps),
 *   - exact match with the server's RE2-ish semantics (Node's V8 regex
 *     engine is close enough for ASCII / unicode-aware patterns; we
 *     document the few differences in semantics.js).
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

// Hard ceiling on the local scan so a misconfigured root doesn't tarpit
// the CLI. The server's grep-indexed path has its own equivalent cap.
const DEFAULT_MAX_FILES = 5000;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_FILE_BYTES = 4 * 1024 * 1024;

const BINARY_PROBE_BYTES = 4096;

function isProbablyBinary(buf) {
  const probe = buf.subarray(0, Math.min(BINARY_PROBE_BYTES, buf.length));
  return probe.includes(0);
}

/**
 * @param {string} pattern raw user pattern
 * @param {object} opts {regex, ignoreCase, wordMatch}
 * @returns {RegExp}
 */
export function buildLocalMatcher(pattern, opts) {
  const flags = (opts.ignoreCase ? "i" : "") + "g";
  let body = pattern;
  if (!opts.regex) {
    body = body.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  if (opts.wordMatch) {
    body = `\\b(?:${body})\\b`;
  }
  return new RegExp(body, flags);
}

async function readIgnoreFile(root, name) {
  try {
    const text = await readFile(join(root, name), "utf8");
    return text
      .split(/\r?\n/)
      .map(line => line.replace(/#.*$/, "").trim())
      .filter(line => line.length > 0);
  } catch {
    return [];
  }
}

// Convert a .gitignore-style glob into a regex tested against the
// posix-style relative path. This is INTENTIONALLY simpler than a full
// gitignore implementation — we only need to filter common patterns
// like `node_modules/`, `*.log`, `dist/**`. Edge cases (negation,
// directory-only `/`, `!` overrides) are deliberately ignored; the
// user can move advanced ignores into the server-side .puppyignore
// where the upload policy parser handles the full grammar.
function compileIgnoreLine(line) {
  if (line.startsWith("!")) return null;        // skip negations
  let pattern = line;
  if (pattern.endsWith("/")) pattern = pattern.slice(0, -1) + "/**";
  let regex = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") { regex += ".*"; i++; }
      else regex += "[^/]*";
    } else if (c === "?") regex += "[^/]";
    else if (c === ".") regex += "\\.";
    else if (c === "/") regex += "/";
    else regex += c;
  }
  if (!pattern.includes("/")) regex = `(^|.*/)${regex}$`;
  else regex = `^${regex}$`;
  try { return new RegExp(regex); } catch { return null; }
}

function makeIgnoreMatcher(patterns) {
  const compiled = patterns.map(compileIgnoreLine).filter(Boolean);
  if (!compiled.length) return () => false;
  return relPosix => compiled.some(re => re.test(relPosix));
}

function toPosix(p) {
  return sep === "/" ? p : p.split(sep).join("/");
}

/**
 * Scan ``root/scopePath`` for files NOT in ``trackedPaths`` and grep
 * each one for ``matcher``. Returns hits in the same shape as the
 * server response so the CLI renderer is channel-agnostic.
 *
 * @param {object} args
 * @param {string} args.root             — local working-copy root (the
 *   directory the user ran ``puppyone fs grep`` from, or the user's
 *   configured local repo path).
 * @param {string} args.scopePath        — sub-path within root the AP
 *   bounds us to. Empty = the whole root.
 * @param {RegExp} args.matcher
 * @param {Set<string>} args.trackedPaths  — paths the server already
 *   handles; these are SKIPPED so we only emit local-only hits.
 * @param {object} [args.flags] {invertMatch, onlyMatching,
 *   beforeContext, afterContext, maxFiles, maxBytes, maxFileBytes}
 */
export async function localScan({
  root,
  scopePath,
  matcher,
  trackedPaths,
  flags = {},
}) {
  if (!root) return { hits: [], skipped: { reason: "no-local-root" } };

  const startDir = scopePath ? join(root, scopePath) : root;
  try {
    const s = await stat(startDir);
    if (!s.isDirectory()) {
      // If the user pointed at a single file, scan just that one.
      return await scanOneFile({
        root, fullPath: startDir, scopePath, matcher, trackedPaths, flags,
        accum: { files: 0, bytes: 0 },
      }).then(hits => ({ hits, truncated: false }));
    }
  } catch {
    return { hits: [], skipped: { reason: "scope-path-missing" } };
  }

  const gitignore = await readIgnoreFile(root, ".gitignore");
  const puppyignore = await readIgnoreFile(root, ".puppyignore");
  const ignored = makeIgnoreMatcher([...gitignore, ...puppyignore, ".git/", ".puppyone/"]);

  const maxFiles = flags.maxFiles ?? DEFAULT_MAX_FILES;
  const maxBytes = flags.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxFileBytes = flags.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

  const hits = [];
  const accum = { files: 0, bytes: 0 };
  let truncated = false;
  let truncationReason = "";

  async function walk(dir) {
    if (truncated) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (truncated) return;
      if (entry.name.startsWith(".") && entry.name !== ".gitignore" && entry.name !== ".puppyignore") {
        // The CLI never indexes dotfile dirs by default; .gitignore
        // covers .git/.puppyone explicitly so we don't double-skip.
        if (entry.isDirectory()) continue;
      }
      const fullPath = join(dir, entry.name);
      const relPosix = toPosix(relative(root, fullPath));
      if (ignored(relPosix)) continue;
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (trackedPaths.has(relPosix)) continue;
      accum.files += 1;
      if (accum.files > maxFiles) {
        truncated = true;
        truncationReason = "file_limit_exceeded";
        return;
      }
      const fileHits = await scanOneFile({
        root, fullPath, scopePath, matcher, trackedPaths, flags, accum,
        maxFileBytes, maxBytes,
      });
      for (const h of fileHits) {
        if (hits.length >= (flags.limit ?? 1000)) {
          truncated = true;
          truncationReason = "match_limit_exceeded";
          return;
        }
        hits.push(h);
      }
      if (accum.bytes >= maxBytes) {
        truncated = true;
        truncationReason = "byte_limit_exceeded";
        return;
      }
    }
  }

  await walk(startDir);

  return { hits, truncated, truncation_reason: truncationReason, scanned_files: accum.files };
}

async function scanOneFile({ root, fullPath, scopePath: _scopePath, matcher, trackedPaths: _tracked, flags, accum, maxFileBytes = DEFAULT_MAX_FILE_BYTES, maxBytes = DEFAULT_MAX_BYTES }) {
  let buf;
  try {
    buf = await readFile(fullPath);
  } catch {
    return [];
  }
  if (buf.length > maxFileBytes) return [];
  if (isProbablyBinary(buf)) return [];
  accum.bytes = (accum.bytes ?? 0) + buf.length;
  if (accum.bytes > maxBytes) return [];
  const text = buf.toString("utf8");
  const lines = text.split(/\r?\n/);
  const relPosix = toPosix(relative(root, fullPath));
  const before = Math.min(Math.max(0, flags.beforeContext || 0), 100);
  const after = Math.min(Math.max(0, flags.afterContext || 0), 100);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    matcher.lastIndex = 0;
    const m = matcher.exec(line);
    const matched = !!m;
    const accept = flags.invertMatch ? !matched : matched;
    if (!accept) continue;
    out.push({
      path: relPosix,
      line: i + 1,
      col: matched && !flags.invertMatch ? (m.index + 1) : 0,
      match: flags.onlyMatching && matched ? m[0] : line,
      context_before: before ? lines.slice(Math.max(0, i - before), i) : [],
      context_after: after ? lines.slice(i + 1, i + 1 + after) : [],
      provenance: "local-only",
    });
    if (flags.perFileLimit && out.length >= flags.perFileLimit) break;
  }
  return out;
}

/**
 * Pull tracked paths under the AP's scope by walking ``/ap-fs/tree``.
 * Returned as a Set<string> of posix-style repo-relative paths.
 *
 * The tree endpoint already respects scope bounds, so we don't have to
 * filter again on the client. We DO normalise to forward-slash form so
 * the Set lookup works regardless of the local file separator.
 */
export async function fetchTrackedPaths({ get, headers, scopePath }) {
  try {
    const data = await get("/ap-fs/tree", { path: scopePath || "" }, headers);
    const entries = data?.entries || [];
    const tracked = new Set();
    for (const entry of entries) {
      if (entry.type === "folder") continue;
      const path = entry.path || entry.name || "";
      if (path) tracked.add(path);
    }
    return tracked;
  } catch {
    // If we can't get the tracked set, fall back to "treat everything
    // as untracked" so the local channel returns hits even if the
    // server is unreachable. The renderer marks these local-only.
    return new Set();
  }
}
