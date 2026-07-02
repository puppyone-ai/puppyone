import fs from "node:fs/promises";
import path from "node:path";

const MAX_SNAPSHOT_FILES = 2500;
const MAX_SNAPSHOT_FILE_BYTES = 1024 * 1024;
const MAX_SNAPSHOT_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_EXACT_DIFF_LINES = 2200;
const WORKSPACE_EDIT_REVIEW_FLUSH_DELAY_MS = 1100;
const ignoredPathSegments = new Set([
  ".git",
  ".hg",
  ".svn",
  ".next",
  ".turbo",
  ".cache",
  ".venv",
  "__pycache__",
  "build",
  "dist",
  "node_modules",
]);

const reviewStates = new Map();

export { WORKSPACE_EDIT_REVIEW_FLUSH_DELAY_MS };

export async function initializeWorkspaceEditReview(rootPath) {
  const state = getReviewState(rootPath);
  await ensureBaseline(state);
  return state.latestRequest;
}

export function getLatestWorkspaceEditReviewRequest(rootPath) {
  return reviewStates.get(path.resolve(rootPath))?.latestRequest ?? null;
}

export function noteWorkspaceEditReviewPath(rootPath, relativePath) {
  const state = getReviewState(rootPath);
  const normalizedPath = normalizeRelativePath(relativePath);

  if (!normalizedPath) {
    state.pendingFullScan = true;
    return;
  }
  if (shouldIgnoreRelativePath(normalizedPath)) return;
  state.pendingPaths.add(normalizedPath);
}

export async function flushWorkspaceEditReviewChanges(rootPath) {
  const state = getReviewState(rootPath);
  await ensureBaseline(state);

  const pendingPaths = [...state.pendingPaths];
  const pendingFullScan = state.pendingFullScan;
  state.pendingPaths.clear();
  state.pendingFullScan = false;

  if (!pendingFullScan && pendingPaths.length === 0) return null;

  const requestId = `desktop-ai-edit-${Date.now()}-${state.nextRequestIndex}`;
  state.nextRequestIndex += 1;

  const files = pendingFullScan
    ? await collectFullScanFiles(state)
    : await collectCandidateFiles(state, pendingPaths);
  const requestFiles = [];

  for (const filePath of files) {
    const before = state.baseline.get(filePath)?.content ?? null;
    const after = await readReviewTextFile(state.rootPath, filePath);

    if (before === null && after === null) continue;
    if (before === after) continue;

    requestFiles.push(createAiEditFile({
      requestId,
      path: filePath,
      before: before ?? "",
      after: after ?? "",
      status: inferFileStatus(before, after),
    }));
  }

  await updateBaselineForPaths(state, files);

  const changedFiles = requestFiles.filter((file) => file.hunks.length > 0 || file.status !== "modified");
  if (changedFiles.length === 0) return null;

  const request = {
    id: requestId,
    sessionId: state.sessionId,
    agentName: "Agent",
    title: "Latest workspace edit",
    createdAt: new Date().toISOString(),
    files: changedFiles,
  };
  state.latestRequest = request;
  return request;
}

export async function absorbWorkspaceEditReviewPath(rootPath, relativePath) {
  const state = getReviewState(rootPath);
  await ensureBaseline(state);

  const normalizedPath = normalizeRelativePath(relativePath);
  if (!normalizedPath) {
    await replaceBaseline(state);
    return;
  }

  state.pendingPaths.delete(normalizedPath);
  await updateBaselineForPaths(state, [normalizedPath]);
}

export function disposeWorkspaceEditReview(rootPath) {
  const resolvedRoot = path.resolve(rootPath);
  reviewStates.delete(resolvedRoot);
}

function getReviewState(rootPath) {
  const resolvedRoot = path.resolve(rootPath);
  let state = reviewStates.get(resolvedRoot);
  if (state) return state;

  state = {
    rootPath: resolvedRoot,
    sessionId: `desktop-session-${stableContentHash(resolvedRoot)}`,
    baseline: new Map(),
    baselineReady: false,
    baselinePromise: null,
    pendingPaths: new Set(),
    pendingFullScan: false,
    nextRequestIndex: 1,
    latestRequest: null,
  };
  reviewStates.set(resolvedRoot, state);
  return state;
}

async function ensureBaseline(state) {
  if (state.baselineReady) return;
  if (!state.baselinePromise) {
    state.baselinePromise = replaceBaseline(state).finally(() => {
      state.baselinePromise = null;
    });
  }
  await state.baselinePromise;
}

async function replaceBaseline(state) {
  state.baseline = await captureWorkspaceSnapshot(state.rootPath);
  state.baselineReady = true;
}

async function captureWorkspaceSnapshot(rootPath) {
  const snapshot = new Map();
  const budget = {
    files: 0,
    bytes: 0,
  };

  await walkTextFiles(rootPath, "", budget, async (relativePath, content, metadata) => {
    snapshot.set(relativePath, {
      content,
      hash: stableContentHash(content),
      size: metadata.size,
    });
  });

  return snapshot;
}

async function collectFullScanFiles(state) {
  const currentSnapshot = await captureWorkspaceSnapshot(state.rootPath);
  const paths = new Set([...state.baseline.keys(), ...currentSnapshot.keys()]);
  return [...paths].sort();
}

async function collectCandidateFiles(state, pendingPaths) {
  const candidates = new Set();

  for (const pendingPath of pendingPaths) {
    if (shouldIgnoreRelativePath(pendingPath)) continue;
    const absolutePath = resolveWorkspacePath(state.rootPath, pendingPath);
    const metadata = await fs.stat(absolutePath).catch((error) => {
      if (error?.code === "ENOENT") return null;
      return null;
    });

    if (!metadata) {
      addBaselineMatches(state.baseline, pendingPath, candidates);
      continue;
    }

    if (metadata.isDirectory()) {
      addBaselineMatches(state.baseline, pendingPath, candidates);
      const budget = {
        files: 0,
        bytes: 0,
      };
      await walkTextFiles(state.rootPath, pendingPath, budget, async (relativePath) => {
        candidates.add(relativePath);
      });
      continue;
    }

    if (metadata.isFile()) {
      candidates.add(pendingPath);
    }
  }

  return [...candidates].sort();
}

function addBaselineMatches(baseline, relativePath, candidates) {
  const prefix = `${relativePath.replace(/\/+$/, "")}/`;
  if (baseline.has(relativePath)) candidates.add(relativePath);
  for (const baselinePath of baseline.keys()) {
    if (baselinePath.startsWith(prefix)) candidates.add(baselinePath);
  }
}

async function updateBaselineForPaths(state, pathsToUpdate) {
  for (const relativePath of pathsToUpdate) {
    if (!relativePath || shouldIgnoreRelativePath(relativePath)) continue;
    const absolutePath = resolveWorkspacePath(state.rootPath, relativePath);
    const metadata = await fs.stat(absolutePath).catch((error) => {
      if (error?.code === "ENOENT") return null;
      return null;
    });

    if (!metadata) {
      removeBaselinePath(state.baseline, relativePath);
      continue;
    }

    if (metadata.isDirectory()) {
      removeBaselineChildren(state.baseline, relativePath);
      const budget = {
        files: 0,
        bytes: 0,
      };
      await walkTextFiles(state.rootPath, relativePath, budget, async (childPath, content, childMetadata) => {
        state.baseline.set(childPath, {
          content,
          hash: stableContentHash(content),
          size: childMetadata.size,
        });
      });
      continue;
    }

    if (!metadata.isFile()) {
      state.baseline.delete(relativePath);
      continue;
    }

    const content = await readReviewTextFile(state.rootPath, relativePath);
    if (content === null) {
      state.baseline.delete(relativePath);
    } else {
      state.baseline.set(relativePath, {
        content,
        hash: stableContentHash(content),
        size: metadata.size,
      });
    }
  }
}

function removeBaselineChildren(baseline, relativePath) {
  const prefix = `${relativePath.replace(/\/+$/, "")}/`;
  for (const baselinePath of [...baseline.keys()]) {
    if (baselinePath.startsWith(prefix)) baseline.delete(baselinePath);
  }
}

function removeBaselinePath(baseline, relativePath) {
  baseline.delete(relativePath);
  const prefix = `${relativePath.replace(/\/+$/, "")}/`;
  for (const baselinePath of [...baseline.keys()]) {
    if (baselinePath.startsWith(prefix)) baseline.delete(baselinePath);
  }
}

async function walkTextFiles(rootPath, relativeDirectory, budget, onFile) {
  if (budget.files >= MAX_SNAPSHOT_FILES || budget.bytes >= MAX_SNAPSHOT_TOTAL_BYTES) return;

  const directory = resolveWorkspacePath(rootPath, relativeDirectory);
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);

  for (const entry of entries) {
    if (budget.files >= MAX_SNAPSHOT_FILES || budget.bytes >= MAX_SNAPSHOT_TOTAL_BYTES) break;
    if (shouldIgnorePathSegment(entry.name)) continue;

    const relativePath = joinRelativePath(relativeDirectory, entry.name);
    if (shouldIgnoreRelativePath(relativePath)) continue;

    if (entry.isDirectory()) {
      await walkTextFiles(rootPath, relativePath, budget, onFile);
      continue;
    }

    if (!entry.isFile()) continue;

    const content = await readReviewTextFile(rootPath, relativePath);
    if (content === null) continue;

    const metadata = await fs.stat(resolveWorkspacePath(rootPath, relativePath)).catch(() => null);
    if (!metadata || !metadata.isFile()) continue;

    budget.files += 1;
    budget.bytes += metadata.size;
    await onFile(relativePath, content, metadata);
  }
}

async function readReviewTextFile(rootPath, relativePath) {
  const absolutePath = resolveWorkspacePath(rootPath, relativePath);
  const metadata = await fs.stat(absolutePath).catch((error) => {
    if (error?.code === "ENOENT") return null;
    return null;
  });
  if (!metadata || !metadata.isFile()) return null;
  if (metadata.size > MAX_SNAPSHOT_FILE_BYTES) return null;

  const bytes = await fs.readFile(absolutePath).catch(() => null);
  if (!bytes || bytes.includes(0)) return null;
  return bytes.toString("utf8");
}

function createAiEditFile(input) {
  const beforeLines = splitLines(input.before);
  const afterLines = splitLines(input.after);
  const hunks = buildHunks(input.requestId, input.path, beforeLines, afterLines);

  return {
    id: `${input.requestId}:${input.path}`,
    requestId: input.requestId,
    path: input.path,
    oldPath: input.oldPath ?? null,
    status: input.status,
    beforeHash: stableContentHash(input.before),
    afterHash: stableContentHash(input.after),
    additions: hunks.reduce((sum, hunk) => sum + hunk.newRange.lineCount, 0),
    deletions: hunks.reduce((sum, hunk) => sum + hunk.oldRange.lineCount, 0),
    hunks,
  };
}

function buildHunks(requestId, filePath, beforeLines, afterLines) {
  if (beforeLines.length + afterLines.length > MAX_EXACT_DIFF_LINES) {
    return [createHunk(requestId, filePath, 0, 1, beforeLines, 1, afterLines)];
  }

  const ops = buildLineOps(beforeLines, afterLines);
  const hunks = [];
  let oldLine = 1;
  let newLine = 1;
  let oldStart = 1;
  let newStart = 1;
  let removed = [];
  let added = [];

  const flush = () => {
    if (removed.length === 0 && added.length === 0) return;
    hunks.push(createHunk(requestId, filePath, hunks.length, oldStart, removed, newStart, added));
    removed = [];
    added = [];
  };

  for (const op of ops) {
    if (op.kind === "equal") {
      flush();
      oldLine += 1;
      newLine += 1;
      oldStart = oldLine;
      newStart = newLine;
      continue;
    }

    if (removed.length === 0 && added.length === 0) {
      oldStart = oldLine;
      newStart = newLine;
    }

    if (op.kind === "remove") {
      removed.push(op.text);
      oldLine += 1;
    } else {
      added.push(op.text);
      newLine += 1;
    }
  }

  flush();
  return hunks;
}

function createHunk(requestId, filePath, index, oldStart, oldLines, newStart, newLines) {
  const kind = oldLines.length === 0
    ? "added"
    : newLines.length === 0
      ? "removed"
      : "modified";

  return {
    id: `${requestId}:${filePath}:h${index + 1}`,
    kind,
    state: "pending",
    oldRange: {
      startLine: oldStart,
      lineCount: oldLines.length,
    },
    newRange: {
      startLine: newStart,
      lineCount: newLines.length,
    },
    oldText: oldLines.join("\n"),
    newText: newLines.join("\n"),
  };
}

function buildLineOps(beforeLines, afterLines) {
  const table = buildLcsTable(beforeLines, afterLines);
  const ops = [];
  let i = 0;
  let j = 0;

  while (i < beforeLines.length && j < afterLines.length) {
    if (beforeLines[i] === afterLines[j]) {
      ops.push({ kind: "equal", text: beforeLines[i] });
      i += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ kind: "remove", text: beforeLines[i] });
      i += 1;
      continue;
    } else {
      ops.push({ kind: "add", text: afterLines[j] });
      j += 1;
      continue;
    }
    j += 1;
  }

  while (i < beforeLines.length) {
    ops.push({ kind: "remove", text: beforeLines[i] });
    i += 1;
  }
  while (j < afterLines.length) {
    ops.push({ kind: "add", text: afterLines[j] });
    j += 1;
  }

  return ops;
}

function buildLcsTable(left, right) {
  const rows = left.length + 1;
  const columns = right.length + 1;
  const table = Array.from({ length: rows }, () => Array(columns).fill(0));

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = left[i] === right[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  return table;
}

function inferFileStatus(before, after) {
  if (before === null && after !== null) return "created";
  if (before !== null && after === null) return "deleted";
  return "modified";
}

function splitLines(value) {
  if (!value) return [];
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function stableContentHash(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function resolveWorkspacePath(rootPath, relativePath) {
  const normalizedRelativePath = normalizeRelativePath(relativePath);
  const root = path.resolve(rootPath);
  const target = normalizedRelativePath
    ? path.resolve(root, normalizedRelativePath)
    : root;

  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Path escapes the workspace root.");
  }

  return target;
}

function normalizeRelativePath(value) {
  if (typeof value !== "string") return "";
  return value.replaceAll("\\", "/").split("/").filter(Boolean).join("/");
}

function joinRelativePath(parentPath, childName) {
  const parent = normalizeRelativePath(parentPath);
  return parent ? `${parent}/${childName}` : childName;
}

function shouldIgnoreRelativePath(relativePath) {
  return normalizeRelativePath(relativePath).split("/").some(shouldIgnorePathSegment);
}

function shouldIgnorePathSegment(segment) {
  return ignoredPathSegments.has(String(segment).toLowerCase());
}
