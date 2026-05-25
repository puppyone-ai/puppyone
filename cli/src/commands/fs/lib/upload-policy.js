/**
 * Folder-upload policy — CLI mirror of the backend single source of
 * truth.
 *
 * See ``docs/proposals/PUP-3-folder-upload-policy.md`` for the product
 * contract. The backend lives at
 * ``backend/src/ingest/policy/upload_policy.py`` and the frontend
 * mirror at ``frontend/lib/uploadPolicy.ts``; any constant changes
 * here MUST be applied in those two files as well.
 */

// ── Hardcoded blocklist (Q1 minimum) ──────────────────────────────
export const DEFAULT_BLOCKLIST_SEGMENTS = new Set([
  ".git",
  ".svn",
  ".hg",
  ".DS_Store",
  "Thumbs.db",
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  ".next",
  "dist",
  "build",
  ".cache",
  ".pytest_cache",
  ".mypy_cache",
  "target",
]);

// ── Thresholds (Q4) ────────────────────────────────────────────────
export const PER_FILE_MAX_BYTES = 100 * 1024 * 1024;
export const PER_BATCH_MAX_FILES = 5000;
export const PER_BATCH_MAX_BYTES = 1024 * 1024 * 1024;
export const PREFLIGHT_FILE_THRESHOLD = 50;
export const PREFLIGHT_BYTES_THRESHOLD = 100 * 1024 * 1024;

// ── Public helpers ─────────────────────────────────────────────────

export function isBlockedSegment(segment) {
  return DEFAULT_BLOCKLIST_SEGMENTS.has(segment);
}

export function pathBlockedSegment(path) {
  for (const raw of path.split("/")) {
    const seg = raw.trim();
    if (!seg) continue;
    if (isBlockedSegment(seg)) return seg;
  }
  return null;
}

export function isDotfilePath(path) {
  for (const raw of path.split("/")) {
    const seg = raw.trim();
    if (seg && seg.startsWith(".")) return true;
  }
  return false;
}

// ── .gitignore / .puppyignore parsing ─────────────────────────────

export function parseIgnoreLine(line) {
  let s = line.trim();
  if (!s || s.startsWith("#")) return null;
  let negate = false;
  if (s.startsWith("!")) {
    negate = true;
    s = s.slice(1);
  }
  const dirOnly = s.endsWith("/");
  if (dirOnly) s = s.slice(0, -1);
  if (!s) return null;
  return { pattern: s, negate, dirOnly };
}

export function parseIgnoreText(text) {
  const rules = [];
  for (const line of text.split(/\r?\n/)) {
    const r = parseIgnoreLine(line);
    if (r) rules.push(r);
  }
  return rules;
}

function escapeRegex(s) {
  return s.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

function globToRegex(pattern) {
  const anchored = pattern.includes("/");
  let i = 0;
  let body = "";
  while (i < pattern.length) {
    if (pattern[i] === "*" && pattern[i + 1] === "*") {
      body += "(?:.*/)?";
      i += 2;
      if (pattern[i] === "/") i++;
    } else if (pattern[i] === "*") {
      body += "[^/]*";
      i++;
    } else if (pattern[i] === "?") {
      body += "[^/]";
      i++;
    } else {
      body += escapeRegex(pattern[i]);
      i++;
    }
  }
  return anchored
    ? new RegExp(`^${body}(?:/.*)?$`)
    : new RegExp(`(?:^|.*/)(${body})(?:/.*)?$`);
}

function fnmatchSegment(segment, pattern) {
  const body = pattern
    .split("")
    .map((c) => (c === "*" ? "[^/]*" : c === "?" ? "[^/]" : escapeRegex(c)))
    .join("");
  return new RegExp(`^${body}$`).test(segment);
}

export function matchesIgnoreRules(path, rules, opts = {}) {
  let ignored = false;
  for (const rule of rules) {
    if (rule.dirOnly && !opts.isDir) {
      const segs = path.split("/");
      for (let i = 0; i < segs.length - 1; i++) {
        if (fnmatchSegment(segs[i], rule.pattern)) {
          ignored = !rule.negate;
          break;
        }
      }
      continue;
    }
    if (globToRegex(rule.pattern).test(path)) {
      ignored = !rule.negate;
    }
  }
  return ignored;
}

// ── Policy entry point ────────────────────────────────────────────

export function evaluateFile(relativePath, sizeBytes, rules, options = {}) {
  if (sizeBytes > PER_FILE_MAX_BYTES) {
    return { accept: false, reason: "too_large" };
  }
  const blockedSeg = pathBlockedSegment(relativePath);
  if (blockedSeg && !options.includeBlocklist) {
    return { accept: false, reason: `blocklist:${blockedSeg}` };
  }
  const combined = [...(rules || []), ...(options.extraRules || [])];
  if (combined.length && matchesIgnoreRules(relativePath, combined)) {
    if (!options.includeIgnored) {
      return { accept: false, reason: "gitignore" };
    }
  }
  if (isDotfilePath(relativePath) && !options.includeHidden) {
    return { accept: false, reason: "hidden" };
  }
  return { accept: true, reason: "ok" };
}

/**
 * Apply the policy to an array of {relativePath, sizeBytes} entries.
 * Returns {accepted, skipped, totalAcceptedBytes, reasonCounts,
 * shouldConfirm}.
 *
 * Caller decides whether to actually prompt — we just signal when a
 * batch is large or had any skips.
 */
export function applyPolicy(entries, { rules = [], options = {} } = {}) {
  const accepted = [];
  const skipped = [];
  let totalAcceptedBytes = 0;
  const reasonCounts = { blocklist: 0, gitignore: 0, hidden: 0, tooLarge: 0 };

  for (const entry of entries) {
    const decision = evaluateFile(
      entry.relativePath,
      entry.sizeBytes,
      rules,
      options,
    );
    if (decision.accept) {
      accepted.push(entry);
      totalAcceptedBytes += entry.sizeBytes;
    } else {
      skipped.push({ entry, reason: decision.reason });
      if (decision.reason.startsWith("blocklist:")) reasonCounts.blocklist++;
      else if (decision.reason === "gitignore") reasonCounts.gitignore++;
      else if (decision.reason === "hidden") reasonCounts.hidden++;
      else if (decision.reason === "too_large") reasonCounts.tooLarge++;
    }
  }

  const shouldConfirm =
    accepted.length >= PREFLIGHT_FILE_THRESHOLD ||
    totalAcceptedBytes >= PREFLIGHT_BYTES_THRESHOLD ||
    skipped.length > 0;

  return {
    accepted,
    skipped,
    totalAcceptedBytes,
    reasonCounts,
    shouldConfirm,
  };
}

/**
 * Read a candidate ignore file at ``root/.gitignore`` or
 * ``root/.puppyignore``. Returns parsed rules in document order
 * (later wins); missing files yield an empty list.
 */
export async function loadIgnoreFilesFromRoot(root) {
  const { readFile } = await import("node:fs/promises");
  const nodePath = await import("node:path");
  const rules = [];
  for (const name of [".gitignore", ".puppyignore"]) {
    const p = nodePath.join(root, name);
    try {
      const text = await readFile(p, "utf-8");
      rules.push(...parseIgnoreText(text));
    } catch (e) {
      if (e && e.code !== "ENOENT") throw e;
    }
  }
  return rules;
}
