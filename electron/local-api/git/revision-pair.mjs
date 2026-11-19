import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { execGit, execGitBuffer } from "./runner.mjs";

export const GIT_DIFF_REVISION_LIMITS = Object.freeze({
  maxTextBytes: 1024 * 1024,
  maxResourceBytes: 25 * 1024 * 1024,
});

/**
 * Main/local-process revision authority. Specs are derived by trusted Git
 * scope code; no renderer-provided refs or absolute paths enter this module.
 */
export async function resolveGitRevisionPair({
  rootPath,
  scope,
  path: currentPath,
  oldPath = null,
  status,
  before,
  after,
  signal,
  limits = GIT_DIFF_REVISION_LIMITS,
}) {
  throwIfAborted(signal);
  const canonicalRoot = await fs.realpath(path.resolve(rootPath));
  const repositoryIdentity = await resolveOpaqueRepositoryIdentity(canonicalRoot, signal);
  const [beforeSide, afterSide] = await Promise.all([
    readRevisionSide({
      canonicalRoot,
      repositoryIdentity,
      scope,
      side: "before",
      spec: before,
      signal,
      limits,
    }),
    readRevisionSide({
      canonicalRoot,
      repositoryIdentity,
      scope,
      side: "after",
      spec: after,
      signal,
      limits,
    }),
  ]);
  throwIfAborted(signal);

  const selectionIdentity = opaqueIdentity("selection", [
    repositoryIdentity,
    scope,
    currentPath,
    oldPath ?? "",
    status,
    beforeSide.identity,
    afterSide.identity,
  ]);

  return {
    repositoryIdentity,
    selectionIdentity,
    scope,
    path: currentPath,
    oldPath,
    status,
    before: beforeSide,
    after: afterSide,
  };
}

async function readRevisionSide({
  canonicalRoot,
  repositoryIdentity,
  scope,
  side,
  spec,
  signal,
  limits,
}) {
  throwIfAborted(signal);
  if (!spec || spec.kind === "missing") {
    return missingSide(repositoryIdentity, scope, side, spec?.path ?? "", spec?.reason ?? "not-present");
  }

  if (spec.kind === "worktree") {
    return readWorktreeSide({ canonicalRoot, repositoryIdentity, scope, side, spec, signal, limits });
  }

  let objectId = null;
  if (spec.kind === "index") {
    objectId = await resolveIndexBlobId(canonicalRoot, spec.path, signal);
    if (objectId?.conflict) {
      return unavailableSide({
        identity: opaqueIdentity("index-conflict", [repositoryIdentity, spec.path]),
        mimeType: spec.mimeType,
        reason: "index-conflict",
        message: "A stable stage-0 index revision is unavailable for this conflicted file.",
      });
    }
    objectId = objectId?.objectId ?? null;
  } else if (spec.kind === "tree") {
    objectId = await resolveTreeBlobId(canonicalRoot, spec.ref, spec.path, signal);
  } else {
    throw new TypeError(`Unsupported Git revision source: ${String(spec.kind)}`);
  }

  if (!objectId) {
    return missingSide(repositoryIdentity, scope, side, spec.path, "git-object-missing");
  }
  return readGitBlobSide({ canonicalRoot, objectId, spec, signal, limits });
}

async function readWorktreeSide({ canonicalRoot, repositoryIdentity, scope, side, spec, signal, limits }) {
  const candidate = resolveRelativePath(canonicalRoot, spec.path);
  const metadata = await fs.lstat(candidate).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!metadata) return missingSide(repositoryIdentity, scope, side, spec.path, "worktree-missing");
  if (metadata.isSymbolicLink()) {
    return unavailableSide({
      identity: opaqueIdentity("worktree-symlink", [repositoryIdentity, spec.path]),
      mimeType: spec.mimeType,
      reason: "symlink",
      message: "Symbolic links are not read by the format-aware diff pipeline.",
    });
  }
  if (!metadata.isFile()) {
    return unavailableSide({
      identity: opaqueIdentity("worktree-non-file", [repositoryIdentity, spec.path]),
      mimeType: spec.mimeType,
      reason: "not-file",
      message: "This revision is not a regular file.",
    });
  }

  const canonicalCandidate = await fs.realpath(candidate);
  assertInside(canonicalRoot, canonicalCandidate);
  const metadataIdentity = opaqueIdentity("worktree-metadata", [
    repositoryIdentity,
    spec.path,
    metadata.dev,
    metadata.ino,
    metadata.size,
    metadata.mtimeMs,
  ]);
  if (metadata.size > limits.maxResourceBytes) {
    return unavailableSide({
      identity: metadataIdentity,
      size: metadata.size,
      mimeType: spec.mimeType,
      reason: "size-limit",
      message: `Revision exceeds the ${limits.maxResourceBytes} byte diff resource limit.`,
    });
  }

  const openFlags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);
  let handle;
  try {
    handle = await fs.open(canonicalCandidate, openFlags);
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFileSnapshot(metadata, opened)) {
      throw new Error("Working-tree revision changed before it could be read.");
    }

    const bytes = await readStableFileHandle(handle, opened.size, signal);
    const [afterRead, afterPath] = await Promise.all([
      handle.stat(),
      fs.lstat(candidate),
    ]);
    if (!sameFileSnapshot(opened, afterRead) || !sameFileSnapshot(opened, afterPath)) {
      throw new Error("Working-tree revision changed while it was being read.");
    }
    // Metadata alone is not a revision identity: a caller can preserve size and
    // timestamps while changing content. Bind successful reads to the bytes so
    // renderer caches can never reuse a stale same-size working-tree revision.
    const identity = opaqueIdentity("worktree", [
      repositoryIdentity,
      spec.path,
      createHash("sha256").update(bytes).digest("hex"),
    ]);
    return materializeSide({ identity, bytes, mimeType: spec.mimeType, preferText: spec.preferText, limits });
  } finally {
    await handle?.close();
  }
}

async function readStableFileHandle(handle, size, signal) {
  const bytes = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    throwIfAborted(signal);
    const result = await handle.read(bytes, offset, size - offset, offset);
    if (result.bytesRead === 0) {
      throw new Error("Working-tree revision was truncated while it was being read.");
    }
    offset += result.bytesRead;
  }
  throwIfAborted(signal);
  return bytes;
}

function sameFileSnapshot(left, right) {
  return (
    left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs
  );
}

async function readGitBlobSide({ canonicalRoot, objectId, spec, signal, limits }) {
  const identity = `git:${objectId}`;
  const sizeResult = await execGit(canonicalRoot, ["cat-file", "-s", objectId], {
    optionalLocks: false,
    signal,
  });
  const size = Number.parseInt(sizeResult.stdout.trim(), 10);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error("Git returned an invalid blob size.");
  }
  if (size > limits.maxResourceBytes) {
    return unavailableSide({
      identity,
      size,
      mimeType: spec.mimeType,
      reason: "size-limit",
      message: `Revision exceeds the ${limits.maxResourceBytes} byte diff resource limit.`,
    });
  }

  const result = await execGitBuffer(canonicalRoot, ["cat-file", "blob", objectId], {
    optionalLocks: false,
    signal,
    maxBuffer: limits.maxResourceBytes + 1,
  });
  const bytes = Buffer.from(result.stdout);
  if (bytes.length !== size) throw new Error("Git blob size changed while it was being read.");
  return materializeSide({ identity, bytes, mimeType: spec.mimeType, preferText: spec.preferText, limits });
}

function materializeSide({ identity, bytes, mimeType, preferText, limits }) {
  if (preferText === true && bytes.length <= limits.maxTextBytes && !bytes.includes(0)) {
    try {
      const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return { kind: "text", identity, size: bytes.length, mimeType: mimeType ?? null, content };
    } catch {
      // Invalid UTF-8 is a binary resource even if Git did not mark the patch binary.
    }
  }
  return {
    kind: "resource",
    identity,
    size: bytes.length,
    mimeType: mimeType ?? null,
    bytes,
  };
}

async function resolveTreeBlobId(rootPath, ref, relativePath, signal) {
  const result = await execGit(rootPath, ["ls-tree", "-z", ref, "--", relativePath], {
    optionalLocks: false,
    signal,
  });
  const record = result.stdout.split("\0").find(Boolean);
  if (!record) return null;
  const match = /^\d+\s+blob\s+([0-9a-f]{40,64})\t/.exec(record);
  return match?.[1] ?? null;
}

async function resolveIndexBlobId(rootPath, relativePath, signal) {
  const result = await execGit(rootPath, ["ls-files", "--stage", "-z", "--", relativePath], {
    optionalLocks: false,
    signal,
  });
  let conflict = false;
  for (const record of result.stdout.split("\0").filter(Boolean)) {
    const match = /^\d+\s+([0-9a-f]{40,64})\s+(\d)\t/.exec(record);
    if (!match) continue;
    if (match[2] === "0") return { objectId: match[1], conflict: false };
    conflict = true;
  }
  return { objectId: null, conflict };
}

async function resolveOpaqueRepositoryIdentity(rootPath, signal) {
  const result = await execGit(rootPath, ["rev-parse", "--git-common-dir"], {
    optionalLocks: false,
    signal,
  });
  const commonDir = path.resolve(rootPath, result.stdout.trim() || ".git");
  const canonicalCommonDir = await fs.realpath(commonDir).catch(() => commonDir);
  return opaqueIdentity("repo", [canonicalCommonDir]);
}

function missingSide(repositoryIdentity, scope, side, relativePath, reason) {
  return {
    kind: "missing",
    identity: opaqueIdentity("missing", [repositoryIdentity, scope, side, relativePath, reason]),
    size: 0,
    mimeType: null,
    reason,
  };
}

function unavailableSide({ identity, size = null, mimeType = null, reason, message }) {
  return { kind: "unavailable", identity, size, mimeType: mimeType ?? null, reason, message };
}

function resolveRelativePath(rootPath, relativePath) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error("Git diff revision path must be workspace-relative.");
  }
  const candidate = path.resolve(rootPath, relativePath);
  assertInside(rootPath, candidate);
  return candidate;
}

function assertInside(rootPath, candidatePath) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Git diff revision path resolves outside the workspace.");
  }
}

function opaqueIdentity(namespace, parts) {
  const digest = createHash("sha256")
    .update(parts.map((part) => String(part)).join("\0"))
    .digest("hex")
    .slice(0, 32);
  return `${namespace}:${digest}`;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error("Git diff revision read was aborted.");
  error.name = "AbortError";
  throw error;
}
