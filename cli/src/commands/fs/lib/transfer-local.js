import {
  applyPolicy,
  loadIgnoreFilesFromRoot,
  parseIgnoreText,
} from "./upload-policy.js";

export async function localPathInfo(path) {
  const { stat } = await import("node:fs/promises");
  try {
    return await stat(path);
  } catch (e) {
    if (e?.code === "ENOENT") return null;
    throw e;
  }
}

export async function localExists(path) {
  return (await localPathInfo(path)) != null;
}

/**
 * Walk a local directory tree and return file metadata.
 *
 * Pure walker — does NOT apply the PUP-3 folder-upload policy. Callers
 * who want the policy applied feed the result into
 * ``applyPolicyToScan()`` below; this keeps the walker reusable for
 * paths that intentionally bypass policy (e.g. ``--no-default-ignores``
 * with explicit ``--include-hidden``).
 */
export async function collectLocalFiles(path, { maxDepth = -1, limit = 5000 } = {}) {
  const { readdir, stat } = await import("node:fs/promises");
  const nodePath = await import("node:path");
  const files = [];
  let truncated = false;

  async function walk(current, relBase = "", depth = 0) {
    if (files.length >= limit) {
      truncated = true;
      return;
    }
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= limit) {
        truncated = true;
        return;
      }
      const full = nodePath.join(current, entry.name);
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (maxDepth < 0 || depth < maxDepth) {
          await walk(full, rel, depth + 1);
        }
      } else if (entry.isFile()) {
        files.push({ localPath: full, relativePath: rel, stat: await stat(full) });
      }
    }
  }

  await walk(path);
  return {
    files,
    complete: !truncated,
    truncated,
    limit,
    returnedCount: files.length,
  };
}

/**
 * Apply the PUP-3 folder-upload policy to a scan from
 * ``collectLocalFiles``. Returns
 * ``{accepted, skipped, totalAcceptedBytes, reasonCounts, shouldConfirm}``
 * — the caller decides whether to prompt the user (TTY) or just print
 * the summary and proceed (non-interactive).
 *
 * ``ignoreFiles`` is a list of additional ignore-file paths (the
 * ``--ignore-file`` flag). Rules from those files are loaded and
 * layered on top of any ``.gitignore`` / ``.puppyignore`` at the
 * source root.
 */
export async function applyPolicyToScan(
  scan,
  sourceRoot,
  {
    includeHidden = false,
    includeIgnored = false,
    includeBlocklist = false,
    noDefaultIgnores = false,
    ignoreFiles = [],
  } = {},
) {
  const { readFile } = await import("node:fs/promises");
  let rules = [];
  if (!noDefaultIgnores) {
    rules = await loadIgnoreFilesFromRoot(sourceRoot);
  }
  for (const extra of ignoreFiles) {
    try {
      const text = await readFile(extra, "utf-8");
      rules.push(...parseIgnoreText(text));
    } catch (e) {
      if (e && e.code !== "ENOENT") throw e;
    }
  }
  // Map scan files into the {relativePath, sizeBytes} shape applyPolicy
  // expects, then re-attach the original entries to the accepted set so
  // the caller still has localPath / stat.
  const entries = scan.files.map((f) => ({
    relativePath: f.relativePath,
    sizeBytes: f.stat ? f.stat.size : 0,
    _orig: f,
  }));
  const result = applyPolicy(entries, {
    rules,
    options: { includeHidden, includeIgnored, includeBlocklist },
  });
  return {
    accepted: result.accepted.map((e) => e._orig),
    skipped: result.skipped.map((s) => ({
      file: s.entry._orig,
      reason: s.reason,
    })),
    totalAcceptedBytes: result.totalAcceptedBytes,
    reasonCounts: result.reasonCounts,
    shouldConfirm: result.shouldConfirm,
  };
}

export async function writeLocalFile(path, content, { force = false, noClobber = false } = {}) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const nodePath = await import("node:path");
  if (noClobber && await localExists(path)) return false;
  if (!force && noClobber && await localExists(path)) return false;
  await mkdir(nodePath.dirname(path), { recursive: true });
  await writeFile(path, content);
  return true;
}
