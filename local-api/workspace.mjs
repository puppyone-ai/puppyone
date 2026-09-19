import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  classifyLocalFile,
  getMimeType,
  isLocalFilePreviewable,
  resolveCopyNameExtension,
} from "./files/file-format-policy.mjs";
import { parseSingleByteRange } from "./files/byte-range.mjs";
import {
  isSameOrInsidePath,
  normalizeRelativePath,
  resolveExistingWorkspacePath,
  resolveWorkspacePath,
} from "./files/path-policy.mjs";
import {
  assertWorkspaceFileVersion,
  getWorkspaceFileVersion,
  normalizeExpectedWorkspaceVersion,
  serializeWorkspaceWrite,
  writeWorkspaceFileAtomic,
} from "./files/versioned-atomic-write.mjs";
import {
  GIT_DEFAULT_TIMEOUT_MS,
  GIT_MUTATION_TIMEOUT_MS,
  GIT_NETWORK_TIMEOUT_MS,
  execGit,
  execGitStreaming,
} from "./git/runner.mjs";
import { createWorkspaceCloudRemoteActions } from "./git/cloud-remote.mjs";
import {
  readGitComparisonFileSummary,
  readGitComparisonPreview,
  resolveGitRemoteDiffComparisons,
} from "./git/diff-comparison.mjs";
import { resolveGitRevisionPair } from "./git/revision-pair.mjs";
import { deriveGitRevisionSpecs } from "./git/revision-specs.mjs";
import { parseGitPorcelainV2Status } from "./git/porcelain-v2.mjs";
import {
  createGitSyncTargetPolicy,
  normalizeCurrentBranchName,
  splitRemoteBranchName,
} from "./git/sync-target.mjs";
import {
  buildGitSourceControlSnapshot,
  getDiscardableResources,
  getResourceGitPaths,
  gitStatusLabelToLetter,
  hasStagedStatus,
  hasUnstagedStatus,
  uniqueGitPaths,
} from "./git/source-control-model.mjs";
import {
  readPuppyoneWorkspaceConfig,
  writePuppyoneWorkspaceConfig,
} from "./workspace-config.mjs";
export { getGitEnvironmentForTests } from "./git/runner.mjs";
export {
  inspectAutoCommitPreflight,
  recoverWorkspaceGitAutoCommit,
  runWorkspaceGitAutoCommit,
} from "./git/auto-commit.mjs";
export { getMimeType } from "./files/file-format-policy.mjs";
export {
  resolveExistingWorkspaceDisplayPath,
  resolveExistingWorkspacePath,
  resolveWorkspacePath,
} from "./files/path-policy.mjs";
export { openWorkspaceFileRangeStream } from "./files/workspace-file-stream.mjs";
export {
  readPuppyoneWorkspaceConfig,
  writePuppyoneWorkspaceConfig,
} from "./workspace-config.mjs";

/** Cache totalCommits by (root, HEAD) so working-tree refreshes skip rev-list. */
const totalCommitsByHead = new Map();

const MAX_ENTRIES_PER_FOLDER = 500;
const MAX_PREVIEW_BYTES = 4096;
const MAX_EDITOR_BYTES = 1024 * 1024;
// Cap for whole-file reads served over the puppyone-local:// protocol (media
// preview). Bounds main-process memory so a huge file can't OOM the app.
const MAX_LOCAL_FILE_BYTES = 100 * 1024 * 1024;
// Maximum length of one buffered random-access read. Media protocol responses
// use the separate backpressured stream path below.
const MAX_RANGE_READ_BYTES = 8 * 1024 * 1024;
const GIT_HISTORY_LIMIT = 100;
const GIT_ALL_BRANCH_HISTORY_LIMIT = 320;
const GIT_REMOTE_PREVIEW_LIMIT = 12;
export const GIT_STATUS_ENTRY_LIMIT = 10_000;
const GIT_STATUS_RECORD_LIMIT = (GIT_STATUS_ENTRY_LIMIT * 2) + 32;
const GIT_DETAIL_MAX_TOTAL_DIFF_LINES = 4000;
const GIT_DETAIL_MAX_FILE_DIFF_LINES = 900;
const PUPPYONE_CLOUD_DEFAULT_BRANCH = "main";
const {
  chooseGitSyncTarget,
  choosePuppyoneRemoteName,
  getConfiguredSyncBranch,
  hasEffectivePuppyoneHostingTarget,
  isPuppyoneHostingConfig,
} = createGitSyncTargetPolicy({
  defaultBranch: PUPPYONE_CLOUD_DEFAULT_BRANCH,
  isPuppyoneRemote,
});
const {
  configureWorkspaceCloudRemote,
  removeWorkspaceGitRemote,
} = createWorkspaceCloudRemoteActions({
  execGit,
  getGitErrorOutput,
  getWorkspaceGitStatus,
  mutationTimeoutMs: GIT_MUTATION_TIMEOUT_MS,
  normalizeGitRemoteName,
  normalizeGitRemoteUrl,
  resolveWorkspacePath,
});
export { configureWorkspaceCloudRemote, removeWorkspaceGitRemote };

export async function resolveLocalWorkspaceIdentity(folderPath) {
  const resolvedPath = path.resolve(folderPath);
  const canonicalPath = await fs.realpath(resolvedPath).catch((error) => {
    throw new Error(`Unable to open folder: ${error.message}`);
  });
  const metadata = await fs.stat(canonicalPath).catch((error) => {
    throw new Error(`Unable to open folder: ${error.message}`);
  });

  if (!metadata.isDirectory()) {
    throw new Error("Selected path is not a folder.");
  }

  const fsIdentity = createFileSystemIdentity(metadata, canonicalPath);
  let configError = null;
  try {
    await readPuppyoneWorkspaceConfig(canonicalPath);
  } catch (error) {
    // Invalid project metadata must not prevent a local-first folder from
    // opening. The config surface reports the recoverable error separately.
    configError = error instanceof Error ? error.message : String(error);
  }

  const workspaceInstanceId = createWorkspaceInstanceId(fsIdentity);
  return {
    canonicalPath,
    fsIdentity,
    workspaceInstanceId,
    configError,
  };
}

export async function workspaceFromPath(folderPath, options = {}) {
  const identity = await resolveLocalWorkspaceIdentity(folderPath);
  const markdownDialect = await resolveWorkspaceMarkdownDialect(identity.canonicalPath);
  const includeGitMetadata = options.includeGitMetadata !== false;
  const gitMetadata = includeGitMetadata
    ? await Promise.all([
      getWorkspaceCommitCount(identity.canonicalPath),
      readWorkspacePuppyoneRemoteMetadata(identity.canonicalPath),
    ])
    : null;

  return {
    id: `local:${identity.workspaceInstanceId}`,
    name: path.basename(identity.canonicalPath) || identity.canonicalPath,
    path: identity.canonicalPath,
    status: "protected",
    ...(gitMetadata
      ? {
        commitCount: gitMetadata[0],
        puppyoneGitRemote: gitMetadata[1].puppyoneGitRemote,
        hydrationState: "ready",
      }
      : { hydrationState: "metadata" }),
    cloudState: "local",
    workspaceInstanceId: identity.workspaceInstanceId,
    fsIdentity: identity.fsIdentity,
    ...(markdownDialect ? { markdownDialect } : {}),
    ...(identity.configError ? { configError: identity.configError } : {}),
  };
}

async function resolveWorkspaceMarkdownDialect(rootPath) {
  const openKnowledgeConfig = path.join(rootPath, ".ok", "config.yml");
  const metadata = await fs.stat(openKnowledgeConfig).catch((error) => {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  });
  return metadata?.isFile() ? "openknowledge-mdx" : null;
}

async function readWorkspacePuppyoneRemoteMetadata(rootPath) {
  const remotes = await readGitRemotes(rootPath).catch(() => []);
  const candidates = remotes.flatMap((remote) => [remote?.fetchUrl, remote?.pushUrl])
    .map((url) => parsePuppyoneRemoteInfo(url))
    .filter(Boolean);
  if (candidates.length === 0) {
    return { puppyoneGitRemote: null };
  }
  const canonical = candidates.filter((candidate) => candidate.kind !== "access-point");
  const identities = new Map(canonical.map((candidate) => [
    `${candidate.origin}\n${candidate.projectId}\n${candidate.scopeId ?? ""}`,
    candidate,
  ]));
  if (identities.size !== 1) {
    return { puppyoneGitRemote: null };
  }
  const [candidate] = identities.values();
  return {
    puppyoneGitRemote: {
      origin: candidate.origin,
      projectId: candidate.projectId,
      scopeId: candidate.scopeId ?? null,
    },
  };
}

export async function listFolderChildren(rootPath, folderPath) {
  const folder = await resolveExistingWorkspacePath(rootPath, folderPath);
  const metadata = await fs.stat(folder).catch((error) => {
    throw new Error(`Unable to read folder metadata: ${error.message}`);
  });

  if (!metadata.isDirectory()) {
    throw new Error("Selected path is not a folder.");
  }

  const entries = await fs.readdir(folder, { withFileTypes: true }).catch((error) => {
    throw new Error(`Unable to read folder: ${error.message}`);
  });

  const parentRelative = normalizeRelativePath(folderPath);
  const nodes = [];

  for (const entry of entries) {
    if (nodes.length >= MAX_ENTRIES_PER_FOLDER) break;
    const node = await nodeFromEntry(folder, entry, parentRelative);
    if (node) nodes.push(node);
  }

  nodes.sort((a, b) => {
    const aFolder = a.type === "folder";
    const bFolder = b.type === "folder";
    if (aFolder !== bFolder) return aFolder ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  return nodes;
}

/**
 * Resolve one entry for command admission and session restoration. Unlike a
 * folder listing this does not enumerate siblings or read preview content.
 */
export async function resolveWorkspaceNode(rootPath, relativePath) {
  const normalizedPath = normalizeRelativePath(relativePath);
  if (!normalizedPath) throw new Error("Workspace root is not a document.");
  const entryPath = await resolveExistingWorkspacePath(rootPath, normalizedPath);
  const metadata = await fs.lstat(entryPath).catch((error) => {
    throw new Error(`Unable to read workspace entry metadata: ${error.message}`);
  });
  if (metadata.isSymbolicLink()) {
    throw new Error("Symbolic links cannot be opened through the document workbench.");
  }

  const isFolder = metadata.isDirectory();
  const name = path.basename(normalizedPath);
  return {
    id: normalizedPath,
    name,
    path: normalizedPath,
    type: isFolder ? "folder" : classifyFile(name),
    mimeType: isFolder ? null : getMimeType(entryPath),
    size: isFolder ? null : formatFileSize(metadata.size),
    modified: Number.isFinite(metadata.mtimeMs)
      ? String(Math.floor(metadata.mtimeMs / 1000))
      : null,
    preview: null,
    content: null,
    children: null,
  };
}

export async function readWorkspaceFile(rootPath, relativePath, options = undefined) {
  const filePath = await resolveExistingWorkspacePath(rootPath, relativePath);
  const metadata = await fs.stat(filePath).catch((error) => {
    throw new Error(`Unable to read file: ${error.message}`);
  });
  if (metadata.isDirectory()) {
    throw new Error("Selected path is a folder.");
  }

  const hasRangeOption = options && Object.prototype.hasOwnProperty.call(options, "rangeHeader");
  if (hasRangeOption) {
    // Bounded Range consumers (including Viewer Pack resource brokers) may
    // address files larger than the whole-file media cap. Whole-file reads
    // below still enforce MAX_LOCAL_FILE_BYTES.
    const range = parseSingleByteRange(options.rangeHeader, metadata.size);
    if (range?.unsatisfiable) {
      return {
        bytes: Buffer.alloc(0),
        size: metadata.size,
        start: 0,
        end: 0,
        partial: false,
        unsatisfiable: true,
      };
    }

    if (range) {
      const length = range.end - range.start + 1;
      if (length > MAX_RANGE_READ_BYTES) {
        throw new Error(`Requested range (${length} bytes) exceeds the ${formatFileSize(MAX_RANGE_READ_BYTES)} per-read limit.`);
      }
      const bytes = await readFileSlice(filePath, range.start, range.end);
      return {
        bytes,
        size: metadata.size,
        start: range.start,
        end: range.start + bytes.length - 1,
        partial: true,
        unsatisfiable: false,
      };
    }

    if (metadata.size > MAX_LOCAL_FILE_BYTES) {
      throw new Error("File is too large to serve without a Range request.");
    }
    const bytes = await fs.readFile(filePath);
    return {
      bytes,
      size: metadata.size,
      start: 0,
      end: Math.max(0, metadata.size - 1),
      partial: false,
      unsatisfiable: false,
    };
  }

  if (metadata.size > MAX_LOCAL_FILE_BYTES) {
    throw new Error("File is too large to serve.");
  }
  return fs.readFile(filePath);
}

/**
 * Metadata for a workspace file without reading its body. Unlike the media
 * whole-file path this intentionally does NOT enforce MAX_LOCAL_FILE_BYTES —
 * a viewer pack must be able to inspect files larger than 100 MiB through
 * bounded Range reads. Returns a stable revision token (mtime + size) so a
 * resource handle can detect underlying changes.
 */
export async function statWorkspaceFile(rootPath, relativePath) {
  const filePath = await resolveExistingWorkspacePath(rootPath, relativePath);
  const metadata = await fs.stat(filePath).catch((error) => {
    throw new Error(`Unable to read file metadata: ${error.message}`);
  });
  if (metadata.isDirectory()) {
    throw new Error("Selected path is a folder.");
  }
  if (!metadata.isFile()) {
    throw new Error("Selected path is not a regular file.");
  }
  return {
    path: normalizeRelativePath(relativePath),
    name: path.basename(filePath),
    size: metadata.size,
    mimeType: getMimeType(filePath) ?? "application/octet-stream",
    revision: `${Math.floor(metadata.mtimeMs)}:${metadata.size}`,
  };
}

/**
 * Bounded Range read for the resource broker. Allows files larger than the
 * whole-file media cap because it only ever reads `[start, end]` (never the
 * whole file) and refuses ranges longer than `maxLength` (default
 * MAX_RANGE_READ_BYTES). Uses positional stream primitives, not
 * `fs.readFile` of the whole file.
 */
export async function readWorkspaceFileRange(rootPath, relativePath, request = {}) {
  const filePath = await resolveExistingWorkspacePath(rootPath, relativePath);
  const metadata = await fs.stat(filePath).catch((error) => {
    throw new Error(`Unable to read file metadata: ${error.message}`);
  });
  if (metadata.isDirectory()) {
    throw new Error("Selected path is a folder.");
  }
  if (!metadata.isFile()) {
    throw new Error("Selected path is not a regular file.");
  }

  const size = metadata.size;
  const maxLength = Number.isSafeInteger(request.maxLength) && request.maxLength > 0
    ? Math.min(request.maxLength, MAX_RANGE_READ_BYTES)
    : MAX_RANGE_READ_BYTES;

  const start = Number(request.start);
  const end = Number(request.end);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
    throw new Error("Range start and end must be integers.");
  }
  if (start < 0 || end < start) {
    throw new Error("Range is invalid.");
  }
  if (size === 0 || start >= size) {
    return {
      bytes: Buffer.alloc(0),
      size,
      start: 0,
      end: 0,
      partial: false,
      unsatisfiable: true,
    };
  }

  const clampedEnd = Math.min(end, size - 1);
  const length = clampedEnd - start + 1;
  if (length > maxLength) {
    throw new Error(`Requested range (${length} bytes) exceeds the ${formatFileSize(maxLength)} per-read limit.`);
  }

  const bytes = await readFileSlice(filePath, start, clampedEnd);
  return {
    bytes,
    size,
    start,
    end: start + bytes.length - 1,
    partial: true,
    unsatisfiable: false,
  };
}

export const RESOURCE_MAX_RANGE_READ_BYTES = MAX_RANGE_READ_BYTES;

export async function readWorkspaceTextFile(rootPath, relativePath) {
  const filePath = await resolveExistingWorkspacePath(rootPath, relativePath);
  const metadata = await fs.stat(filePath).catch((error) => {
    throw new Error(`Unable to read file metadata: ${error.message}`);
  });

  if (metadata.isDirectory()) {
    throw new Error("Selected path is a folder.");
  }
  if (metadata.size > MAX_EDITOR_BYTES) {
    throw new Error("File is too large to edit in PuppyOne Desktop.");
  }

  const bytes = await fs.readFile(filePath);
  if (bytes.includes(0)) {
    return {
      path: normalizeRelativePath(relativePath),
      name: path.basename(filePath),
      type: classifyFile(filePath),
      content: null,
      mimeType: getMimeType(filePath),
      size: formatFileSize(metadata.size),
      version: getWorkspaceTextVersion(bytes),
    };
  }

  return {
    path: normalizeRelativePath(relativePath),
    name: path.basename(filePath),
    type: classifyFile(filePath),
    content: bytes.toString("utf8"),
    mimeType: getMimeType(filePath) ?? "text/plain; charset=utf-8",
    size: formatFileSize(metadata.size),
    version: getWorkspaceTextVersion(bytes),
  };
}

async function readFileSlice(filePath, start, end) {
  const length = end - start + 1;
  const handle = await fs.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function writeWorkspaceTextFile(rootPath, relativePath, content, options = undefined) {
  if (typeof content !== "string") {
    throw new Error("File content must be text.");
  }
  const filePath = await resolveExistingWorkspacePath(rootPath, relativePath);
  const contentBytes = Buffer.from(content, "utf8");
  if (contentBytes.byteLength > MAX_EDITOR_BYTES) {
    throw new Error("File is too large to edit in PuppyOne Desktop.");
  }
  const expectedVersion = normalizeExpectedWorkspaceVersion(options?.expectedVersion);

  return serializeWorkspaceWrite(filePath, async () => {
    const metadata = await fs.stat(filePath).catch((error) => {
      throw new Error(`Unable to write file: ${error.message}`);
    });
    if (metadata.isDirectory()) throw new Error("Selected path is a folder.");
    if (!metadata.isFile()) throw new Error("Selected path is not a regular file.");

    if (expectedVersion !== null) {
      await assertWorkspaceFileVersion(filePath, expectedVersion);
    }

    await writeWorkspaceFileAtomic(filePath, contentBytes, metadata.mode, expectedVersion);
    return { version: getWorkspaceFileVersion(contentBytes) };
  });
}

export function getWorkspaceTextVersion(bytes) {
  return getWorkspaceFileVersion(bytes);
}

export async function readWorkspaceBinaryFileVersion(rootPath, relativePath) {
  const filePath = await resolveExistingWorkspacePath(rootPath, relativePath);
  const metadata = await fs.stat(filePath).catch((error) => {
    throw new Error(`Unable to read file metadata: ${error.message}`);
  });
  if (!metadata.isFile()) throw new Error("Selected path is not a regular file.");
  if (metadata.size > MAX_LOCAL_FILE_BYTES) throw new Error("Office file is too large to edit.");
  return { path: filePath, size: metadata.size, version: getWorkspaceFileVersion(await fs.readFile(filePath)) };
}

export async function writeWorkspaceBinaryFile(rootPath, relativePath, bytes, options = undefined) {
  const filePath = await resolveExistingWorkspacePath(rootPath, relativePath);
  const contentBytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (contentBytes.byteLength > MAX_LOCAL_FILE_BYTES) throw new Error("Office file is too large to save.");
  const expectedVersion = normalizeExpectedWorkspaceVersion(options?.expectedVersion);
  return serializeWorkspaceWrite(filePath, async () => {
    const metadata = await fs.stat(filePath).catch((error) => {
      throw new Error(`Unable to write file: ${error.message}`);
    });
    if (!metadata.isFile()) throw new Error("Selected path is not a regular file.");
    if (expectedVersion !== null) await assertWorkspaceFileVersion(filePath, expectedVersion);
    await writeWorkspaceFileAtomic(filePath, contentBytes, metadata.mode, expectedVersion);
    return { version: getWorkspaceFileVersion(contentBytes) };
  });
}

export async function createWorkspaceEntry(rootPath, request) {
  const parentPath = request?.parentPath ?? null;
  const name = normalizeNewEntryName(request?.name);
  const kind = request?.kind;
  const parent = await resolveExistingWorkspacePath(rootPath, parentPath);
  const parentMetadata = await fs.stat(parent).catch((error) => {
    throw new Error(`Unable to create entry: ${error.message}`);
  });

  if (!parentMetadata.isDirectory()) {
    throw new Error("Create target is not a folder.");
  }

  const targetPath = path.join(parent, name);
  const normalizedParent = normalizeRelativePath(parentPath);
  const relativePath = joinRelativePath(normalizedParent, name);
  resolveWorkspacePath(rootPath, relativePath);

  if (kind === "folder") {
    await fs.mkdir(targetPath).catch((error) => {
      throw new Error(`Unable to create folder: ${error.message}`);
    });
    return { path: relativePath };
  }

  if (kind === "file") {
    const content = typeof request?.content === "string" ? request.content : "";
    await fs.writeFile(targetPath, content, { encoding: "utf8", flag: "wx" }).catch((error) => {
      throw new Error(`Unable to create file: ${error.message}`);
    });
    return { path: relativePath };
  }

  throw new Error("Create kind must be file or folder.");
}

export async function renameWorkspaceEntry(rootPath, request) {
  const relativePath = normalizeRelativePath(request?.path);
  if (!relativePath) {
    throw new Error("Cannot rename the workspace root.");
  }

  const nextName = normalizeNewEntryName(request?.nextName);
  const sourcePath = await resolveExistingWorkspacePath(rootPath, relativePath);
  const parentPath = path.posix.dirname(relativePath);
  const normalizedParent = parentPath === "." ? "" : parentPath;
  const nextRelativePath = joinRelativePath(normalizedParent, nextName);
  const targetParentPath = await resolveExistingWorkspacePath(rootPath, normalizedParent);
  const targetPath = path.join(targetParentPath, nextName);

  if (sourcePath === targetPath) {
    return { path: nextRelativePath };
  }

  await fs.stat(sourcePath).catch((error) => {
    throw new Error(`Unable to rename entry: ${error.message}`);
  });
  const targetExists = await fs.stat(targetPath).then(() => true).catch(() => false);
  if (targetExists) {
    throw new Error("An item with that name already exists.");
  }

  await fs.rename(sourcePath, targetPath).catch((error) => {
    throw new Error(`Unable to rename entry: ${error.message}`);
  });

  return { path: nextRelativePath };
}

export async function moveWorkspaceEntry(rootPath, request) {
  const fromRelativePath = normalizeRelativePath(request?.fromPath);
  const toRelativePath = normalizeRelativePath(request?.toPath);

  if (!fromRelativePath) {
    throw new Error("Cannot move the workspace root.");
  }
  if (!toRelativePath) {
    throw new Error("Move target path is required.");
  }
  if (fromRelativePath.includes("\0") || toRelativePath.includes("\0")) {
    throw new Error("Path contains an invalid character.");
  }
  if (fromRelativePath === toRelativePath) {
    return { path: toRelativePath };
  }
  if (toRelativePath.startsWith(`${fromRelativePath}/`)) {
    throw new Error("Cannot move a folder into itself.");
  }

  const sourcePath = await resolveExistingWorkspacePath(rootPath, fromRelativePath);
  const targetParentRelativePath = path.posix.dirname(toRelativePath);
  const normalizedTargetParent = targetParentRelativePath === "." ? "" : targetParentRelativePath;
  const targetParentPath = await resolveExistingWorkspacePath(rootPath, normalizedTargetParent);
  const targetPath = path.join(targetParentPath, path.posix.basename(toRelativePath));

  await fs.stat(sourcePath).catch((error) => {
    throw new Error(`Unable to move entry: ${error.message}`);
  });
  const targetParentMetadata = await fs.stat(targetParentPath).catch((error) => {
    throw new Error(`Unable to move entry: ${error.message}`);
  });
  if (!targetParentMetadata.isDirectory()) {
    throw new Error("Move target parent is not a folder.");
  }

  const targetExists = await fs.stat(targetPath).then(() => true).catch(() => false);
  if (targetExists) {
    throw new Error("An item with that name already exists.");
  }

  await fs.rename(sourcePath, targetPath).catch((error) => {
    throw new Error(`Unable to move entry: ${error.message}`);
  });

  return { path: toRelativePath };
}

export async function copyWorkspaceEntry(rootPath, request) {
  return copyWorkspaceEntryBetweenRoots(rootPath, rootPath, request);
}

export async function copyWorkspaceEntryBetweenRoots(sourceRootPath, targetRootPath, request) {
  const fromRelativePath = normalizeRelativePath(request?.fromPath);
  const targetFolderRelativePath = normalizeRelativePath(request?.targetFolderPath ?? null);

  if (!fromRelativePath) {
    throw new Error("Cannot copy the workspace root.");
  }
  if (fromRelativePath.includes("\0") || targetFolderRelativePath.includes("\0")) {
    throw new Error("Path contains an invalid character.");
  }
  const sourcePath = await resolveExistingWorkspacePath(sourceRootPath, fromRelativePath);
  const sourceMetadata = await fs.lstat(sourcePath).catch((error) => {
    throw new Error(`Unable to copy entry: ${error.message}`);
  });
  if (sourceMetadata.isSymbolicLink()) {
    throw new Error("Symbolic links cannot be copied.");
  }
  if (!sourceMetadata.isFile() && !sourceMetadata.isDirectory()) {
    throw new Error("Only files and folders can be copied.");
  }
  if (
    sourceMetadata.isDirectory()
    && (
      targetFolderRelativePath === fromRelativePath
      || targetFolderRelativePath.startsWith(`${fromRelativePath}/`)
    )
  ) {
    throw new Error("Cannot copy a folder into itself.");
  }

  const targetParentPath = await resolveExistingWorkspacePath(targetRootPath, targetFolderRelativePath);
  const targetParentMetadata = await fs.stat(targetParentPath).catch((error) => {
    throw new Error(`Unable to copy entry: ${error.message}`);
  });
  if (!targetParentMetadata.isDirectory()) {
    throw new Error("Copy target parent is not a folder.");
  }
  if (sourceMetadata.isDirectory() && isSameOrInsidePath(sourcePath, targetParentPath)) {
    throw new Error("Cannot copy a folder into itself.");
  }

  const preferredName = request?.preferredName == null
    ? path.posix.basename(fromRelativePath)
    : normalizeNewEntryName(request.preferredName);
  const startWithDuplicateName = request?.forceDuplicateName === true
    || path.dirname(sourcePath) === targetParentPath;

  // Validate the complete tree before copying so a folder containing a link is
  // rejected as one operation instead of producing a surprising partial copy.
  const sourceCanonicalRoot = await fs.realpath(path.resolve(sourceRootPath)).catch((error) => {
    throw new Error(`Unable to resolve source workspace root: ${error.message}`);
  });
  const targetCanonicalRoot = await fs.realpath(path.resolve(targetRootPath)).catch((error) => {
    throw new Error(`Unable to resolve target workspace root: ${error.message}`);
  });
  await assertCopyableWorkspaceTree(sourceCanonicalRoot, sourcePath);

  for (let copyIndex = startWithDuplicateName ? 1 : 0; copyIndex <= 10_000; copyIndex += 1) {
    const candidateName = createKeepBothCopyName(preferredName, copyIndex, sourceMetadata.isDirectory());
    const targetPath = path.join(targetParentPath, candidateName);
    let targetCreated = false;
    try {
      // copyWorkspaceTree claims its root with mkdir/copyFile EXCL. Name
      // selection therefore remains correct even when two windows paste at the
      // same time; renderer-side folder listings are never trusted for this.
      await copyWorkspaceTree(sourceCanonicalRoot, sourcePath, targetPath, targetCanonicalRoot);
      targetCreated = true;

      // Revalidate both ends after the asynchronous copy. This catches a source
      // entry being replaced with a link while the operation was in flight and
      // guarantees that no link is introduced into the workspace result.
      await assertCopyableWorkspaceTree(sourceCanonicalRoot, sourcePath);
      await assertCopyableWorkspaceTree(targetCanonicalRoot, targetPath);
      return {
        path: joinRelativePath(targetFolderRelativePath, candidateName),
      };
    } catch (error) {
      if (targetCreated) {
        await removeWorkspaceCopyTarget(targetCanonicalRoot, targetPath, true);
      }
      if (!targetCreated && isCopyTargetConflict(error)) {
        continue;
      }
      throw new Error(`Unable to copy entry: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error("Unable to copy entry: too many items use the requested name.");
}

function createKeepBothCopyName(preferredName, copyIndex, isDirectory) {
  if (copyIndex === 0) return preferredName;

  const extension = isDirectory ? "" : resolveCopyNameExtension(preferredName);
  const originalStem = extension ? preferredName.slice(0, -extension.length) : preferredName;
  const existingCopySuffix = parseKeepBothCopySuffix(originalStem);
  const stem = existingCopySuffix?.stem ?? originalStem;
  const copyNumber = (existingCopySuffix?.copyNumber ?? 0) + copyIndex;
  const suffix = copyNumber === 1 ? " copy" : ` copy ${copyNumber}`;
  return `${stem}${suffix}${extension}`;
}

function parseKeepBothCopySuffix(stem) {
  const match = /^(.*) copy(?: (\d+))?$/i.exec(stem);
  if (!match?.[1]) return null;
  const copyNumber = match[2] ? Number.parseInt(match[2], 10) : 1;
  if (!Number.isSafeInteger(copyNumber) || copyNumber < 1) return null;
  return { stem: match[1], copyNumber };
}

function isCopyTargetConflict(error) {
  return error?.code === "EEXIST" || error?.code === "ERR_FS_CP_EEXIST";
}

async function copyWorkspaceTree(sourceCanonicalRoot, sourcePath, targetPath, targetCanonicalRoot = sourceCanonicalRoot) {
  const metadata = await fs.lstat(sourcePath).catch((error) => {
    throw new Error(`Unable to inspect copy source: ${error.message}`);
  });
  if (metadata.isSymbolicLink()) {
    throw new Error("Symbolic links cannot be copied.");
  }
  await assertWorkspaceCopySourcePath(sourceCanonicalRoot, sourcePath);

  if (metadata.isFile()) {
    let targetCreated = false;
    try {
      await assertWorkspaceCopyTargetParent(targetCanonicalRoot, targetPath);
      await fs.copyFile(sourcePath, targetPath, fsConstants.COPYFILE_EXCL);
      targetCreated = true;
      await fs.chmod(targetPath, metadata.mode);
      await fs.utimes(targetPath, metadata.atime, metadata.mtime);
      await assertWorkspaceCopySourcePath(sourceCanonicalRoot, sourcePath);
      const sourceAfterCopy = await fs.lstat(sourcePath);
      if (sourceAfterCopy.isSymbolicLink() || !sourceAfterCopy.isFile()) {
        throw new Error("Copy source changed while it was being copied.");
      }
      return;
    } catch (error) {
      if (targetCreated) {
        await removeWorkspaceCopyTarget(targetCanonicalRoot, targetPath, false);
      }
      throw error;
    }
  }

  if (!metadata.isDirectory()) {
    throw new Error("Only files and folders can be copied.");
  }

  let targetCreated = false;
  try {
    await assertWorkspaceCopyTargetParent(targetCanonicalRoot, targetPath);
    // The destination must remain writable while its children are populated.
    // Restore the source directory's exact mode after the tree is complete.
    await fs.mkdir(targetPath, { mode: metadata.mode | 0o700 });
    targetCreated = true;
    const children = await fs.readdir(sourcePath);
    for (const childName of children) {
      await copyWorkspaceTree(
        sourceCanonicalRoot,
        path.join(sourcePath, childName),
        path.join(targetPath, childName),
        targetCanonicalRoot,
      );
    }
    await fs.chmod(targetPath, metadata.mode);
    await fs.utimes(targetPath, metadata.atime, metadata.mtime);
    await assertWorkspaceCopySourcePath(sourceCanonicalRoot, sourcePath);
    const sourceAfterCopy = await fs.lstat(sourcePath);
    if (sourceAfterCopy.isSymbolicLink() || !sourceAfterCopy.isDirectory()) {
      throw new Error("Copy source changed while it was being copied.");
    }
  } catch (error) {
    if (targetCreated) {
      await removeWorkspaceCopyTarget(targetCanonicalRoot, targetPath, true);
    }
    throw error;
  }
}

async function assertCopyableWorkspaceTree(canonicalRoot, entryPath) {
  const metadata = await fs.lstat(entryPath).catch((error) => {
    throw new Error(`Unable to inspect copy source: ${error.message}`);
  });
  if (metadata.isSymbolicLink()) {
    throw new Error("Symbolic links cannot be copied.");
  }
  await assertWorkspaceCopySourcePath(canonicalRoot, entryPath);
  if (metadata.isFile()) return;
  if (!metadata.isDirectory()) {
    throw new Error("Only files and folders can be copied.");
  }

  const children = await fs.readdir(entryPath);
  for (const childName of children) {
    await assertCopyableWorkspaceTree(canonicalRoot, path.join(entryPath, childName));
  }
}

async function assertWorkspaceCopySourcePath(canonicalRoot, entryPath) {
  const canonicalEntry = await fs.realpath(entryPath).catch((error) => {
    throw new Error(`Unable to resolve copy source: ${error.message}`);
  });
  if (!isSameOrInsidePath(canonicalRoot, canonicalEntry)) {
    throw new Error("Copy source resolves outside the selected workspace.");
  }
}

async function assertWorkspaceCopyTargetParent(canonicalRoot, targetPath) {
  const targetParentPath = path.dirname(targetPath);
  const parentMetadata = await fs.lstat(targetParentPath).catch((error) => {
    throw new Error(`Unable to resolve copy target folder: ${error.message}`);
  });
  if (parentMetadata.isSymbolicLink()) {
    throw new Error("Symbolic links cannot be used as a copy target.");
  }
  const canonicalParent = await fs.realpath(targetParentPath).catch((error) => {
    throw new Error(`Unable to resolve copy target folder: ${error.message}`);
  });
  if (!isSameOrInsidePath(canonicalRoot, canonicalParent)) {
    throw new Error("Copy target resolves outside the selected workspace.");
  }
}

async function removeWorkspaceCopyTarget(canonicalRoot, targetPath, recursive) {
  const metadata = await fs.lstat(targetPath).catch(() => null);
  if (!metadata || metadata.isSymbolicLink()) return;
  const canonicalTarget = await fs.realpath(targetPath).catch(() => null);
  if (!canonicalTarget || !isSameOrInsidePath(canonicalRoot, canonicalTarget)) return;
  await fs.rm(canonicalTarget, { recursive, force: true }).catch(() => {});
}

export async function importWorkspaceEntries(rootPath, request) {
  const sourcePaths = Array.isArray(request?.sourcePaths) ? request.sourcePaths : [];
  if (sourcePaths.length === 0) {
    throw new Error("At least one source path is required.");
  }
  const preferredName = request?.preferredName == null ? null : normalizeNewEntryName(request.preferredName);
  if (preferredName && sourcePaths.length !== 1) throw new Error("A preferred import name requires exactly one source.");

  const targetFolderPath = request?.targetFolderPath ?? null;
  const targetFolder = await resolveExistingWorkspacePath(rootPath, targetFolderPath);
  const targetFolderMetadata = await fs.stat(targetFolder).catch((error) => {
    throw new Error(`Unable to import entries: ${error.message}`);
  });
  if (!targetFolderMetadata.isDirectory()) {
    throw new Error("Import target is not a folder.");
  }

  const normalizedTargetParent = normalizeRelativePath(targetFolderPath);
  const targetPaths = new Set();
  const plannedEntries = [];

  for (const rawSourcePath of sourcePaths) {
    if (typeof rawSourcePath !== "string" || rawSourcePath.trim().length === 0) {
      throw new Error("Source path is required.");
    }
    if (!path.isAbsolute(rawSourcePath)) {
      throw new Error("Source path must be absolute.");
    }

    const sourcePath = path.resolve(rawSourcePath);
    const sourceMetadata = await fs.lstat(sourcePath).catch((error) => {
      throw new Error(`Unable to read import source: ${error.message}`);
    });
    if (sourceMetadata.isSymbolicLink()) {
      throw new Error("Symbolic links cannot be imported.");
    }
    if (!sourceMetadata.isFile() && !sourceMetadata.isDirectory()) {
      throw new Error("Only files and folders can be imported.");
    }

    const name = preferredName ?? normalizeNewEntryName(path.basename(sourcePath));
    const relativePath = joinRelativePath(normalizedTargetParent, name);
    const targetPath = path.join(targetFolder, name);
    if (sourceMetadata.isDirectory() && isSameOrInsidePath(sourcePath, targetPath)) {
      throw new Error("Cannot import a folder into itself.");
    }
    if (targetPaths.has(targetPath)) {
      throw new Error("Dropped items include duplicate names.");
    }

    const targetExists = await fs.lstat(targetPath)
      .then(() => true)
      .catch((error) => {
        if (error?.code === "ENOENT") return false;
        throw new Error(`Unable to inspect import target: ${error.message}`);
      });
    if (targetExists) {
      throw new Error("An item with that name already exists.");
    }

    targetPaths.add(targetPath);
    plannedEntries.push({
      sourcePath,
      targetPath,
      relativePath,
    });
  }

  for (const entry of plannedEntries) {
    await fs.cp(entry.sourcePath, entry.targetPath, {
      recursive: true,
      force: false,
      errorOnExist: true,
      filter: async (sourcePath) => {
        const metadata = await fs.lstat(sourcePath).catch(() => null);
        return Boolean(metadata && !metadata.isSymbolicLink());
      },
    }).catch((error) => {
      throw new Error(`Unable to import ${path.basename(entry.sourcePath)}: ${error.message}`);
    });
  }

  return {
    paths: plannedEntries.map((entry) => entry.relativePath),
  };
}

export async function deleteWorkspaceEntry(rootPath, request) {
  const relativePath = normalizeRelativePath(request?.path);
  if (!relativePath) {
    throw new Error("Cannot delete the workspace root.");
  }

  const targetPath = await resolveExistingWorkspacePath(rootPath, relativePath);
  await fs.rm(targetPath, { recursive: true, force: false }).catch((error) => {
    throw new Error(`Unable to delete entry: ${error.message}`);
  });

  return { path: relativePath };
}

function throwIfGitStatusAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error("Git status request was cancelled.");
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  throw error;
}

function normalizeGitHeadCommitId(value) {
  const candidate = typeof value === "string" ? value.trim() : "";
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(candidate) ? candidate : "";
}

export async function getWorkspaceGitStatus(rootPath, options = {}) {
  const root = resolveWorkspacePath(rootPath, null);
  const signal = options.signal;
  const statusLimit = Number.isInteger(options.statusEntryLimit) && options.statusEntryLimit > 0
    ? Math.min(options.statusEntryLimit, GIT_STATUS_ENTRY_LIMIT)
    : GIT_STATUS_ENTRY_LIMIT;
  throwIfGitStatusAborted(signal);
  const isRepo = await execGit(root, ["rev-parse", "--is-inside-work-tree"], { signal })
    .then((result) => result.stdout.trim() === "true")
    .catch(() => {
      throwIfGitStatusAborted(signal);
      return false;
    });

  if (!isRepo) {
    const sourceControl = buildGitSourceControlSnapshot({
      entries: [],
      branchName: null,
      syncTarget: null,
      currentBranch: null,
      headCommitId: null,
    });

    return {
      isRepo: false,
      branch: null,
      headCommitId: null,
      totalCommits: 0,
      entries: [],
      stagedEntries: [],
      unstagedEntries: [],
      untrackedEntries: [],
      branches: [],
      remotes: [],
      syncTarget: null,
      effectiveHosting: createNoRepositoryHosting(),
      sourceControl,
      commits: [],
      allCommits: [],
      statusLimit,
      didHitStatusLimit: false,
    };
  }

  // Hot-path status reader. It loads only what the Source Control surface needs
  // to reconcile (HEAD/branch identity, working/staged/untracked/merge resources,
  // ahead/behind, refs/remotes, operation state). Full current-branch and
  // all-branch histories are loaded lazily by the History/Cloud graph surface
  // via getWorkspaceGitBranchGraph, so a normal file save never runs two
  // complete history scans. Read-only queries disable optional Git locks so the
  // background status never performs an optional index refresh or competes with
  // terminal Git operations.
  //
  // Porcelain-v2 `--branch` headers already carry oid/head/upstream/ahead-behind,
  // so we avoid duplicate branch/HEAD queries when those headers are present.
  //
  // Snapshot consistency: fingerprint HEAD + symbolic ref + index before/after
  // the multi-command read and retry once when repository identity changes mid-query.
  const beforeFingerprint = await readGitConsistencyFingerprint(root, { signal });
  const first = await readFastWorkspaceGitStatus(root, { signal, statusLimit });
  const afterFingerprint = await readGitConsistencyFingerprint(root, { signal });
  if (beforeFingerprint !== afterFingerprint) {
    return readFastWorkspaceGitStatus(root, { signal, statusLimit });
  }
  return first;
}

async function readFastWorkspaceGitStatus(root, options = {}) {
  const signal = options.signal;
  const statusLimit = options.statusLimit ?? GIT_STATUS_ENTRY_LIMIT;
  throwIfGitStatusAborted(signal);
  const [statusResult, branches, remotes, repositoryOperation] = await Promise.all([
    // Explicit untracked policy: never inherit status.showUntrackedFiles=no from
    // the user's global Git config — the desktop model must see all untracked paths.
    execGitStreaming(root, [
      "status",
      "--porcelain=v2",
      "-z",
      "--branch",
      "--untracked-files=all",
    ], {
      optionalLocks: false,
      recordLimit: Math.min(GIT_STATUS_RECORD_LIMIT, (statusLimit * 2) + 32),
      signal,
    }).catch((error) => {
      throwIfGitStatusAborted(signal);
      throw new Error(`Unable to read git status: ${error.message}`);
    }),
    readGitBranches(root, { signal }),
    readGitRemotes(root, { signal }),
    readGitRepositoryOperationKind(root, { signal }),
  ]);
  throwIfGitStatusAborted(signal);
  const parsedStatus = parseGitPorcelainV2Status(statusResult.stdout);
  const didHitStatusLimit = statusResult.didHitLimit
    || parsedStatus.entries.length > statusLimit;
  const statusEntries = parsedStatus.entries.slice(0, statusLimit);
  const headerOid = typeof parsedStatus.headers["branch.oid"] === "string"
    ? parsedStatus.headers["branch.oid"].trim()
    : "";
  const headerHead = typeof parsedStatus.headers["branch.head"] === "string"
    ? parsedStatus.headers["branch.head"].trim()
    : "";

  let branchName = "";
  let headCommitId = normalizeGitHeadCommitId(headerOid);
  if (headerHead && headerHead !== "(detached)") {
    branchName = headerHead;
  } else if (headerHead === "(detached)") {
    branchName = "detached";
  }
  if (!branchName || !headCommitId) {
    const [branchResult, symbolicBranchResult, headResult] = await Promise.all([
      branchName
        ? Promise.resolve({ stdout: branchName })
        : execGit(root, ["branch", "--show-current"], { optionalLocks: false, signal }).catch(() => {
          throwIfGitStatusAborted(signal);
          return { stdout: "" };
        }),
      branchName
        ? Promise.resolve({ stdout: "" })
        : execGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], { optionalLocks: false, signal }).catch(() => {
          throwIfGitStatusAborted(signal);
          return { stdout: "" };
        }),
      headCommitId
        ? Promise.resolve({ stdout: headCommitId })
        : execGit(root, ["rev-parse", "HEAD"], { optionalLocks: false, signal }).catch(() => {
          throwIfGitStatusAborted(signal);
          return { stdout: "" };
        }),
    ]);
    branchName = branchName || branchResult.stdout.trim() || symbolicBranchResult.stdout.trim() || "detached";
    headCommitId = headCommitId || normalizeGitHeadCommitId(headResult.stdout);
  }

  throwIfGitStatusAborted(signal);
  const totalCommits = await readCachedTotalCommits(root, headCommitId, { signal });
  const normalizedBranches = normalizeGitBranches(branches, branchName, headCommitId);
  const normalizedRemotes = remotes.map((remote) => ({
    ...remote,
    branches: normalizedBranches
      .filter((branch) => branch.remote && branch.name.startsWith(`${remote.name}/`))
      .map((branch) => branch.name),
  }));
  const config = await readPuppyoneWorkspaceConfig(root).catch(() => null);
  throwIfGitStatusAborted(signal);
  const syncTarget = await readGitSyncTarget(
    root,
    normalizedRemotes,
    normalizedBranches,
    branchName,
    headCommitId,
    config,
    { signal },
  );
  const currentBranch = normalizedBranches.find((branch) => branch.current && !branch.remote) ?? null;
  const sourceControl = buildGitSourceControlSnapshot({
    entries: statusEntries,
    branchName,
    syncTarget,
    currentBranch,
    headCommitId: headCommitId || null,
    repositoryOperation,
  });
  const effectiveHosting = resolveGitEffectiveHosting({
    remotes: normalizedRemotes,
    branches: normalizedBranches,
    currentBranchName: branchName,
    syncTarget,
    config,
  });

  return {
    isRepo: true,
    branch: branchName,
    headCommitId: headCommitId || null,
    totalCommits,
    entries: statusEntries,
    stagedEntries: statusEntries.filter(hasStagedStatus),
    unstagedEntries: statusEntries.filter(hasUnstagedStatus),
    untrackedEntries: statusEntries.filter((entry) => entry.status === "untracked"),
    branches: normalizedBranches,
    remotes: normalizedRemotes,
    syncTarget,
    effectiveHosting,
    sourceControl,
    // History is intentionally empty on the fast status path; load it lazily via
    // getWorkspaceGitBranchGraph when the History panel or Cloud graph needs it.
    commits: [],
    allCommits: [],
    statusLimit,
    didHitStatusLimit,
  };
}

// Cheap repository-identity fingerprint used to detect mid-query mutations.
// Compares HEAD oid, symbolic ref, and index mtime/size — not full status truth.
async function readCachedTotalCommits(root, headCommitId, options = {}) {
  const signal = options.signal;
  const cacheKey = path.resolve(root);
  if (!headCommitId) {
    totalCommitsByHead.delete(cacheKey);
    return 0;
  }
  const cached = totalCommitsByHead.get(cacheKey);
  if (cached && cached.headCommitId === headCommitId) {
    return cached.totalCommits;
  }
  const countResult = await execGit(root, ["rev-list", "--count", "HEAD"], {
    optionalLocks: false,
    signal,
  }).catch(() => {
    throwIfGitStatusAborted(signal);
    return { stdout: "0" };
  });
  const totalCommits = Number.parseInt(countResult.stdout.trim(), 10) || 0;
  totalCommitsByHead.set(cacheKey, { headCommitId, totalCommits });
  return totalCommits;
}

export async function readGitConsistencyFingerprint(rootPath, options = {}) {
  const root = resolveWorkspacePath(rootPath, null);
  const signal = options.signal;
  throwIfGitStatusAborted(signal);
  const [headResult, symbolicResult, indexPathResult] = await Promise.all([
    execGit(root, ["rev-parse", "HEAD"], { optionalLocks: false, signal }).catch(() => {
      throwIfGitStatusAborted(signal);
      return { stdout: "" };
    }),
    execGit(root, ["symbolic-ref", "-q", "HEAD"], { optionalLocks: false, signal }).catch(() => {
      throwIfGitStatusAborted(signal);
      return { stdout: "" };
    }),
    execGit(root, ["rev-parse", "--git-path", "index"], { optionalLocks: false, signal }).catch(() => {
      throwIfGitStatusAborted(signal);
      return { stdout: "" };
    }),
  ]);
  throwIfGitStatusAborted(signal);
  const indexRelative = indexPathResult.stdout.trim();
  const indexAbsolute = indexRelative
    ? (path.isAbsolute(indexRelative) ? indexRelative : path.resolve(root, indexRelative))
    : null;
  let indexFingerprint = "missing";
  if (indexAbsolute) {
    const stat = await fs.stat(indexAbsolute).catch(() => null);
    if (stat) indexFingerprint = `${Math.trunc(stat.mtimeMs)}:${stat.size}`;
  }
  return [
    headResult.stdout.trim() || "no-head",
    symbolicResult.stdout.trim() || "detached",
    indexFingerprint,
  ].join("|");
}

async function readGitRepositoryOperationKind(rootPath, options = {}) {
  const signal = options.signal;
  throwIfGitStatusAborted(signal);
  const result = await execGit(rootPath, [
    "rev-parse",
    "--git-path", "rebase-merge",
    "--git-path", "rebase-apply",
    "--git-path", "MERGE_HEAD",
    "--git-path", "CHERRY_PICK_HEAD",
    "--git-path", "REVERT_HEAD",
  ], { optionalLocks: false, signal }).catch(() => {
    throwIfGitStatusAborted(signal);
    return { stdout: "" };
  });
  const resolvedPaths = result.stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .map((value) => value ? (path.isAbsolute(value) ? value : path.resolve(rootPath, value)) : null);
  const candidates = [
    { kind: "rebase", path: resolvedPaths[0] },
    { kind: "rebase", path: resolvedPaths[1] },
    { kind: "merge", path: resolvedPaths[2] },
    { kind: "cherry-pick", path: resolvedPaths[3] },
    { kind: "revert", path: resolvedPaths[4] },
  ];
  const existence = await Promise.all(candidates.map(({ path: candidatePath }) => (
    candidatePath ? fs.stat(candidatePath).then(() => true).catch(() => false) : false
  )));
  throwIfGitStatusAborted(signal);
  return candidates.find((_, index) => existence[index])?.kind ?? null;
}

export async function getWorkspaceGitBranchGraph(rootPath) {
  const root = resolveWorkspacePath(rootPath, null);
  const isRepo = await execGit(root, ["rev-parse", "--is-inside-work-tree"])
    .then((result) => result.stdout.trim() === "true")
    .catch(() => false);

  if (!isRepo) {
    return {
      isRepo: false,
      branch: null,
      headCommitId: null,
      branches: [],
      commits: [],
      allCommits: [],
    };
  }

  const [
    branchResult,
    symbolicBranchResult,
    headResult,
    branches,
    commits,
    allCommits,
  ] = await Promise.all([
    execGit(root, ["branch", "--show-current"], { optionalLocks: false }).catch(() => ({ stdout: "" })),
    execGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], { optionalLocks: false }).catch(() => ({ stdout: "" })),
    execGit(root, ["rev-parse", "HEAD"], { optionalLocks: false }).catch(() => ({ stdout: "" })),
    readGitBranches(root),
    readGitHistory(root, GIT_HISTORY_LIMIT),
    readGitHistory(root, GIT_ALL_BRANCH_HISTORY_LIMIT, { allBranches: true }),
  ]);
  const branchName = branchResult.stdout.trim() || symbolicBranchResult.stdout.trim() || "detached";

  return {
    isRepo: true,
    branch: branchName,
    headCommitId: headResult.stdout.trim() || null,
    branches: normalizeGitBranches(branches, branchName, headResult.stdout.trim()),
    commits,
    allCommits,
  };
}

// Resolve the repository-owned paths for an authorized workspace root using
// Git itself. The renderer never supplies these; they inherit authority from
// the authorized root. Covers linked worktrees and repositories whose `.git`
// is a file pointing outside the workspace.
export async function resolveGitRepositoryIdentity(rootPath) {
  const root = resolveWorkspacePath(rootPath, null);
  try {
    const { stdout } = await execGit(
      root,
      ["rev-parse", "--show-toplevel", "--git-dir", "--git-common-dir"],
      { optionalLocks: false },
    );
    const [topLevelRaw, gitDirRaw, commonDirRaw] = stdout
      .split(/\r?\n/)
      .map((line) => line.trim());
    if (!gitDirRaw) {
      return { repository: false, workspaceRoot: root, topLevel: null, gitDir: null, commonDir: null };
    }
    // `--git-dir` / `--git-common-dir` may be relative to the working tree;
    // resolve against the root so linked worktrees normalize to absolute paths.
    const gitDirResolved = path.resolve(root, gitDirRaw);
    const commonDirResolved = commonDirRaw ? path.resolve(root, commonDirRaw) : gitDirResolved;
    const topLevelResolved = topLevelRaw ? path.resolve(topLevelRaw) : root;
    const [gitDir, commonDir, topLevel] = await Promise.all([
      fs.realpath(gitDirResolved).catch(() => gitDirResolved),
      fs.realpath(commonDirResolved).catch(() => commonDirResolved),
      fs.realpath(topLevelResolved).catch(() => topLevelResolved),
    ]);
    return { repository: true, workspaceRoot: root, topLevel, gitDir, commonDir };
  } catch {
    return { repository: false, workspaceRoot: root, topLevel: null, gitDir: null, commonDir: null };
  }
}

export async function initializeWorkspaceGitRepository(rootPath) {
  const root = resolveWorkspacePath(rootPath, null);
  const isRepo = await execGit(root, ["rev-parse", "--is-inside-work-tree"])
    .then((result) => result.stdout.trim() === "true")
    .catch(() => false);

  if (!isRepo) {
    await execGit(root, ["init"], { timeout: GIT_MUTATION_TIMEOUT_MS }).catch((error) => {
      throw new Error(`Unable to initialize repository: ${getGitErrorOutput(error)}`);
    });
  }

  return getWorkspaceGitStatus(root);
}

export async function getWorkspaceGitCommitDetail(rootPath, commitId) {
  const root = resolveWorkspacePath(rootPath, null);
  assertSafeCommitId(commitId);

  const patchResult = await execGit(root, [
    "show",
    "--format=",
    "--find-renames",
    "--patch",
    "--unified=3",
    "--no-ext-diff",
    commitId,
  ]).catch((error) => {
    throw new Error(`Unable to read git commit detail: ${error.message}`);
  });

  return {
    commit_id: commitId,
    files: parseGitPatch(patchResult.stdout),
  };
}

export async function getWorkspaceGitFileDiff(rootPath, relativePath, scope = "unstaged", options = {}) {
  const root = resolveWorkspacePath(rootPath, null);
  const normalizedPath = normalizeRelativePath(relativePath);
  const signal = options.signal;
  if (!normalizedPath) throw new Error("File path is required.");

  if (scope === "untracked") {
    const detail = {
      commit_id: "working-tree",
      files: [await buildUntrackedFileDiff(root, normalizedPath, { signal })],
    };
    return attachGitRevisionPairs(root, scope, detail, { signal });
  }

  if (scope === "remote") {
    const status = await getWorkspaceGitStatus(root, { signal });
    const target = status.sourceControl.remote.target;
    if (!target?.remote || !target.branch || target.exists !== true) {
      throw new Error("Remote branch is not available.");
    }

    const remoteRef = `refs/remotes/${target.remote}/${target.branch}`;
    const comparison = (
      await resolveGitRemoteDiffComparisons(root, remoteRef, { signal })
    ).incoming;
    const selectionPaths = resolveGitDiffSelectionPaths(status, scope, normalizedPath);
    const patchResult = await execGit(root, [
      "diff",
      "--find-renames",
      "--patch",
      "--unified=3",
      "--no-ext-diff",
      comparison.range,
      "--",
      ...selectionPaths,
    ], { signal }).catch((error) => {
      throw new Error(formatGitFileDiffError("remote", error));
    });

    const detail = {
      commit_id: target.ref ?? remoteRef,
      files: parseGitPatch(patchResult.stdout),
    };
    return attachGitRevisionPairs(root, scope, detail, { comparison, signal });
  }

  if (scope === "committed") {
    const status = await getWorkspaceGitStatus(root, { signal });
    const target = status.sourceControl.remote.target;
    if (!target?.remote || !target.branch || target.exists !== true) {
      throw new Error("Remote branch is not available.");
    }

    const remoteRef = `refs/remotes/${target.remote}/${target.branch}`;
    const comparison = (
      await resolveGitRemoteDiffComparisons(root, remoteRef, { signal })
    ).outgoing;
    const selectionPaths = resolveGitDiffSelectionPaths(status, scope, normalizedPath);
    const patchResult = await execGit(root, [
      "diff",
      "--find-renames",
      "--patch",
      "--unified=3",
      "--no-ext-diff",
      comparison.range,
      "--",
      ...selectionPaths,
    ], { signal }).catch((error) => {
      throw new Error(formatGitFileDiffError("committed", error));
    });

    const detail = {
      commit_id: "local-commits",
      files: parseGitPatch(patchResult.stdout),
    };
    return attachGitRevisionPairs(root, scope, detail, { comparison, signal });
  }

  const args = [
    "diff",
    "--find-renames",
    "--patch",
    "--unified=3",
    "--no-ext-diff",
  ];
  if (scope === "staged") args.push("--cached");
  const selectionStatus = await getWorkspaceGitStatus(root, { signal });
  args.push("--", ...resolveGitDiffSelectionPaths(selectionStatus, scope, normalizedPath));

  const patchResult = await execGit(root, args, { signal }).catch((error) => {
    throw new Error(`Unable to read git file diff: ${error.message}`);
  });

  const detail = {
    commit_id: "working-tree",
    files: parseGitPatch(patchResult.stdout),
  };
  return attachGitRevisionPairs(root, scope, detail, { signal });
}

function resolveGitDiffSelectionPaths(status, scope, selectedPath) {
  let resources = [];
  if (scope === "remote") {
    resources = status?.sourceControl?.remote?.incomingPreview ?? [];
  } else if (scope === "committed") {
    resources = status?.sourceControl?.remote?.outgoingPreview ?? [];
  } else {
    const wantedGroups = scope === "staged" ? new Set(["index"]) : new Set(["workingTree", "merge"]);
    resources = (status?.sourceControl?.groups ?? [])
      .filter((group) => wantedGroups.has(group.id))
      .flatMap((group) => group.resources ?? []);
  }
  const selected = resources.find((resource) => (
    resource.path === selectedPath || resource.oldPath === selectedPath
  ));
  return [...new Set([selected?.oldPath, selected?.path, selectedPath].filter(Boolean))];
}

export async function stageWorkspaceGitPaths(rootPath, paths) {
  const root = resolveWorkspacePath(rootPath, null);
  const normalizedPaths = normalizeGitPathList(paths);
  await execGit(root, ["add", "--", ...normalizedPaths]).catch((error) => {
    throw new Error(`Unable to stage changes: ${error.message}`);
  });
  return getWorkspaceGitStatus(root);
}

export async function stageAllWorkspaceGitChanges(rootPath) {
  const root = resolveWorkspacePath(rootPath, null);
  await execGit(root, ["add", "--all"]).catch((error) => {
    throw new Error(`Unable to stage all changes: ${getGitErrorOutput(error)}`);
  });
  return getWorkspaceGitStatus(root);
}

export async function unstageWorkspaceGitPaths(rootPath, paths) {
  const root = resolveWorkspacePath(rootPath, null);
  const normalizedPaths = normalizeGitPathList(paths);
  await execGit(root, ["restore", "--staged", "--", ...normalizedPaths]).catch(async () => {
    await execGit(root, ["reset", "HEAD", "--", ...normalizedPaths]);
  }).catch((error) => {
    throw new Error(`Unable to unstage changes: ${error.message}`);
  });
  return getWorkspaceGitStatus(root);
}

export async function unstageAllWorkspaceGitChanges(rootPath) {
  const root = resolveWorkspacePath(rootPath, null);
  await execGit(root, ["restore", "--staged", "--", "."]).catch(async () => {
    await execGit(root, ["reset", "HEAD", "--", "."]);
  }).catch((error) => {
    throw new Error(`Unable to unstage all changes: ${getGitErrorOutput(error)}`);
  });
  return getWorkspaceGitStatus(root);
}

export async function discardWorkspaceGitPaths(rootPath, paths) {
  const root = resolveWorkspacePath(rootPath, null);
  const normalizedPaths = normalizeGitPathList(paths);
  const status = await getWorkspaceGitStatus(root);
  const pathsToDiscard = normalizedPaths;
  const entriesByPath = new Map(status.entries.map((entry) => [entry.path, entry]));
  const trackedPaths = [];

  for (const relativePath of pathsToDiscard) {
    const entry = entriesByPath.get(relativePath);
    if (entry?.status === "untracked") {
      await fs.rm(resolveWorkspacePath(root, relativePath), { recursive: true, force: true });
    } else {
      trackedPaths.push(relativePath);
    }
  }

  if (trackedPaths.length > 0) {
    await execGit(root, ["restore", "--worktree", "--", ...trackedPaths]).catch((error) => {
      throw new Error(`Unable to discard changes: ${error.message}`);
    });
  }

  return getWorkspaceGitStatus(root);
}

export async function discardAllWorkspaceGitChanges(rootPath) {
  const root = resolveWorkspacePath(rootPath, null);
  const status = await getWorkspaceGitStatus(root);
  const resources = getDiscardableResources(status.sourceControl);
  const untrackedPaths = [];
  const trackedPaths = [];

  for (const resource of resources) {
    if (resource.group === "untracked" || resource.status === "untracked") {
      untrackedPaths.push(resource.path);
      continue;
    }
    trackedPaths.push(...getResourceGitPaths(resource));
  }

  for (const relativePath of uniqueGitPaths(untrackedPaths)) {
    await fs.rm(resolveWorkspacePath(root, relativePath), { recursive: true, force: true });
  }

  const uniqueTrackedPaths = uniqueGitPaths(trackedPaths);
  if (uniqueTrackedPaths.length > 0) {
    await execGit(root, ["restore", "--worktree", "--", ...uniqueTrackedPaths]).catch((error) => {
      throw new Error(`Unable to discard all changes: ${getGitErrorOutput(error)}`);
    });
  }

  return getWorkspaceGitStatus(root);
}

export async function commitWorkspaceGit(rootPath, message, options = {}) {
  const root = resolveWorkspacePath(rootPath, null);
  const normalizedMessage = await normalizeCommitMessage(root, message);
  const authorName = normalizeOneShotGitIdentity(options.authorName);
  const authorEmail = normalizeOneShotGitIdentity(options.authorEmail);
  const args = [];
  if (authorName && authorEmail) {
    args.push(
      "-c", `user.name=${authorName}`,
      "-c", `user.email=${authorEmail}`,
      "-c", "commit.gpgsign=false",
    );
  }
  args.push("commit");
  if (options.allowEmpty === true) args.push("--allow-empty");
  args.push("-m", normalizedMessage);
  await execGit(root, args, {
    timeout: GIT_MUTATION_TIMEOUT_MS,
  }).catch((error) => {
    throw new Error(`Unable to commit changes: ${error.message}`);
  });
  return getWorkspaceGitStatus(root);
}

export async function stashWorkspaceGitChanges(rootPath) {
  const root = resolveWorkspacePath(rootPath, null);
  await execGit(root, ["stash", "push", "--include-untracked", "-m", "PuppyOne saved changes"], {
    timeout: GIT_MUTATION_TIMEOUT_MS,
  }).catch((error) => {
    throw new Error(`Unable to stash changes: ${getGitErrorOutput(error)}`);
  });
  return getWorkspaceGitStatus(root);
}

export async function continueWorkspaceGitOperation(rootPath) {
  const root = resolveWorkspacePath(rootPath, null);
  const status = await getWorkspaceGitStatus(root);
  const operation = status.sourceControl.operation;
  if (!operation) {
    throw new Error("Unable to continue Git operation: no merge, rebase, cherry-pick, or revert is in progress.");
  }
  if (!operation.canContinue) {
    throw new Error("Unable to continue Git operation: resolve and stage all conflicted files first.");
  }

  await execGit(root, ["-c", "core.editor=true", operation.kind, "--continue"], {
    timeout: GIT_MUTATION_TIMEOUT_MS,
  }).catch((error) => {
    throw new Error(`Unable to continue ${operation.kind}: ${getGitErrorOutput(error)}`);
  });
  return getWorkspaceGitStatus(root);
}

export async function abortWorkspaceGitOperation(rootPath) {
  const root = resolveWorkspacePath(rootPath, null);
  const status = await getWorkspaceGitStatus(root);
  const operation = status.sourceControl.operation;
  if (!operation) {
    throw new Error("Unable to abort Git operation: no merge, rebase, cherry-pick, or revert is in progress.");
  }

  await execGit(root, [operation.kind, "--abort"], {
    timeout: GIT_MUTATION_TIMEOUT_MS,
  }).catch((error) => {
    throw new Error(`Unable to abort ${operation.kind}: ${getGitErrorOutput(error)}`);
  });
  return getWorkspaceGitStatus(root);
}

export async function checkoutWorkspaceGitBranch(rootPath, branchName, options = {}) {
  const root = resolveWorkspacePath(rootPath, null);
  const normalizedBranch = await normalizeGitBranchName(root, branchName);
  const args = await buildGitBranchSwitchArgs(root, normalizedBranch, options);

  await execGit(root, args, { timeout: GIT_MUTATION_TIMEOUT_MS }).catch((error) => {
    throw new Error(formatGitCheckoutError(error));
  });

  return getWorkspaceGitStatus(root);
}

export async function stashAndCheckoutWorkspaceGitBranch(rootPath, branchName, options = {}) {
  const root = resolveWorkspacePath(rootPath, null);
  const normalizedBranch = await normalizeGitBranchName(root, branchName);
  const status = await getWorkspaceGitStatus(root);

  if (!status.isRepo) {
    throw new Error("Current workspace is not a Git repository.");
  }

  const hasLocalChanges = status.entries.length > 0;
  if (hasLocalChanges) {
    await execGit(root, [
      "stash",
      "push",
      "--include-untracked",
      "-m",
      `PuppyOne: before switching to ${normalizedBranch}`,
    ], { timeout: GIT_MUTATION_TIMEOUT_MS }).catch((error) => {
      throw new Error(`Unable to stash changes: ${getGitErrorOutput(error)}`);
    });
  }

  const args = await buildGitBranchSwitchArgs(root, normalizedBranch, options);
  await execGit(root, args, { timeout: GIT_MUTATION_TIMEOUT_MS }).catch(async (error) => {
    if (hasLocalChanges) {
      await execGit(root, ["stash", "pop"], { timeout: GIT_MUTATION_TIMEOUT_MS }).catch(() => {});
    }
    throw new Error(formatGitCheckoutError(error));
  });

  return getWorkspaceGitStatus(root);
}

export async function commitAndCheckoutWorkspaceGitBranch(rootPath, branchName, options = {}) {
  const root = resolveWorkspacePath(rootPath, null);
  const normalizedBranch = await normalizeGitBranchName(root, branchName);
  const status = await getWorkspaceGitStatus(root);

  if (!status.isRepo) {
    throw new Error("Current workspace is not a Git repository.");
  }

  if (status.entries.length > 0) {
    await execGit(root, ["add", "--all"], { timeout: GIT_MUTATION_TIMEOUT_MS }).catch((error) => {
      throw new Error(`Unable to stage changes: ${getGitErrorOutput(error)}`);
    });
    await execGit(root, ["commit", "-m", `Commit before switching to ${normalizedBranch}`], {
      timeout: GIT_MUTATION_TIMEOUT_MS,
    }).catch((error) => {
      throw new Error(`Unable to commit changes: ${getGitErrorOutput(error)}`);
    });
  }

  const args = await buildGitBranchSwitchArgs(root, normalizedBranch, options);
  await execGit(root, args, { timeout: GIT_MUTATION_TIMEOUT_MS }).catch((error) => {
    throw new Error(formatGitCheckoutError(error));
  });

  return getWorkspaceGitStatus(root);
}

export async function createWorkspaceGitBranch(rootPath, branchName) {
  const root = resolveWorkspacePath(rootPath, null);
  const normalizedBranch = await normalizeGitBranchName(root, branchName);
  await execGit(root, ["switch", "-c", normalizedBranch], {
    timeout: GIT_MUTATION_TIMEOUT_MS,
  }).catch((error) => {
    throw new Error(`Unable to create branch: ${error.message}`);
  });
  return getWorkspaceGitStatus(root);
}

export async function fetchWorkspaceGit(rootPath, options = {}) {
  const root = resolveWorkspacePath(rootPath, null);
  const remotes = await readGitRemotes(root);

  if (remotes.length === 0) {
    throw new Error("Unable to fetch remotes: no Git remotes are configured.");
  }

  const requestedRemoteName = typeof options.remoteName === "string"
    ? options.remoteName.trim()
    : "";
  const selectedRemotes = requestedRemoteName
    ? remotes.filter((remote) => remote.name === requestedRemoteName)
    : remotes;

  if (requestedRemoteName && selectedRemotes.length === 0) {
    throw new Error(`Unable to fetch remote '${requestedRemoteName}': remote is not configured.`);
  }

  const failures = [];
  for (const remote of selectedRemotes) {
    await execGit(root, ["fetch", "--prune", remote.name], { timeout: GIT_NETWORK_TIMEOUT_MS }).catch((error) => {
      failures.push(`remote '${remote.name}': ${getGitErrorOutput(error)}`);
    });
  }

  if (failures.length === selectedRemotes.length) {
    throw new Error(`Unable to fetch remotes: ${failures.join("; ")}`);
  }

  if (failures.length > 0) {
    console.warn(`Some Git remotes could not be fetched: ${failures.join("; ")}`);
  }

  return getWorkspaceGitStatus(root);
}

export async function pullWorkspaceGit(rootPath) {
  const root = resolveWorkspacePath(rootPath, null);
  const currentStatus = await getWorkspaceGitStatus(root);
  assertNoInProgressGitOperation(currentStatus, "pull");
  const config = await readPuppyoneWorkspaceConfig(root).catch(() => null);
  const remotes = await readGitRemotes(root);
  if (hasEffectivePuppyoneHostingTarget(remotes, config)) {
    const target = await buildPuppyoneCloudSyncTarget(root, config);
    if (!target.remote || !target.branch) {
      throw new Error("Unable to pull changes: PuppyOne Cloud remote is not configured.");
    }
    await execGit(root, ["fetch", "--prune", target.remote], { timeout: GIT_NETWORK_TIMEOUT_MS }).catch((error) => {
      throw new Error(`Unable to fetch cloud changes: ${getGitErrorOutput(error)}`);
    });

    const nextStatus = await getWorkspaceGitStatus(root);
    if (nextStatus.sourceControl.remote.behind === 0) return nextStatus;

    const pullModeArgs = nextStatus.sourceControl.remote.ahead > 0
      ? ["pull", "--rebase", "--autostash", target.remote, target.branch]
      : ["pull", "--ff-only", "--autostash", target.remote, target.branch];
    await execGit(root, pullModeArgs, { timeout: GIT_NETWORK_TIMEOUT_MS }).catch((error) => {
      throw new Error(`Unable to pull cloud changes: ${getGitErrorOutput(error)}`);
    });
    return getWorkspaceGitStatus(root);
  }

  const pullArgs = await buildDefaultPullArgs(root);
  await execGit(root, pullArgs, { timeout: GIT_NETWORK_TIMEOUT_MS }).catch((error) => {
    throw new Error(`Unable to pull changes: ${getGitErrorOutput(error)}`);
  });
  return getWorkspaceGitStatus(root);
}

export async function pushWorkspaceGit(rootPath) {
  const root = resolveWorkspacePath(rootPath, null);
  const currentStatus = await getWorkspaceGitStatus(root);
  assertNoInProgressGitOperation(currentStatus, "push");
  const config = await readPuppyoneWorkspaceConfig(root).catch(() => null);
  const remotes = await readGitRemotes(root);
  if (hasEffectivePuppyoneHostingTarget(remotes, config)) {
    if (!choosePuppyoneRemoteName(remotes, config)) {
      throw new Error("Unable to push changes: PuppyOne Cloud remote is not configured.");
    }
    await pushWorkspaceGitWithDefaultUpstream(root);
    return getWorkspaceGitStatus(root);
  }

  await execGit(root, ["push"], { timeout: GIT_NETWORK_TIMEOUT_MS }).catch((error) => {
    if (isMissingUpstreamError(error)) {
      return pushWorkspaceGitWithDefaultUpstream(root);
    }
    throw new Error(`Unable to push changes: ${getGitErrorOutput(error)}`);
  });
  return getWorkspaceGitStatus(root);
}

/**
 * Push one immutable, preflighted commit to an explicit remote branch.
 *
 * This is deliberately separate from the interactive `pushWorkspaceGit`
 * operation: Cloud initialization must not infer a remote, read workspace
 * sync preferences, or resolve `HEAD` after the renderer has authorized a
 * different revision. The identity guard is repeated in the main process
 * under the repository mutation lock, then the refspec names the expected
 * object id directly. A concurrent external checkout therefore cannot make us
 * upload a different commit.
 */
export async function pushWorkspaceGitCommitToRemote(rootPath, request = {}) {
  const root = resolveWorkspacePath(rootPath, null);
  const remoteName = normalizeGitRemoteName(request.remoteName);
  const destinationBranch = await normalizeGitBranchName(root, request.destinationBranch);
  const expectedBranch = await normalizeGitBranchName(root, request.expectedBranch);
  const expectedHeadCommitId = request.expectedHeadCommitId;
  assertSafeCommitId(expectedHeadCommitId);

  const [currentBranchResult, currentHeadResult, remoteUrl] = await Promise.all([
    execGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], { optionalLocks: false })
      .catch(() => ({ stdout: "" })),
    execGit(root, ["rev-parse", "--verify", "HEAD^{commit}"], { optionalLocks: false })
      .catch(() => ({ stdout: "" })),
    execGit(root, ["remote", "get-url", remoteName], { optionalLocks: false })
      .then((result) => result.stdout.trim())
      .catch(() => ""),
  ]);
  const currentBranch = currentBranchResult.stdout.trim();
  const currentHeadCommitId = currentHeadResult.stdout.trim();

  if (!currentHeadCommitId) {
    throw new Error("Unable to initialize Cloud project: the repository no longer has a HEAD commit.");
  }
  if (!currentBranch || currentBranch !== expectedBranch) {
    throw new Error("Unable to initialize Cloud project: the current branch changed before push.");
  }
  if (currentHeadCommitId.toLowerCase() !== expectedHeadCommitId.toLowerCase()) {
    throw new Error("Unable to initialize Cloud project: HEAD changed before push.");
  }
  if (!remoteUrl) {
    throw new Error(`Unable to initialize Cloud project: remote '${remoteName}' is not configured.`);
  }

  const destinationRef = `refs/heads/${destinationBranch}`;
  await execGit(
    root,
    ["push", remoteName, `${expectedHeadCommitId}:${destinationRef}`],
    { timeout: GIT_NETWORK_TIMEOUT_MS },
  ).catch((error) => {
    throw new Error(`Unable to push Cloud project: ${getGitErrorOutput(error)}`);
  });

  // Establish the normal Git relationship used by later Push/Pull operations,
  // but only if the checkout still matches the identity authorized above.
  // This mutates repository config only; it never stages or rewrites files.
  const [branchAfterPushResult, headAfterPushResult] = await Promise.all([
    execGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], { optionalLocks: false })
      .catch(() => ({ stdout: "" })),
    execGit(root, ["rev-parse", "--verify", "HEAD^{commit}"], { optionalLocks: false })
      .catch(() => ({ stdout: "" })),
  ]);
  const branchAfterPush = branchAfterPushResult.stdout.trim();
  const headAfterPush = headAfterPushResult.stdout.trim();
  if (!headAfterPush) {
    throw new Error("Unable to finish Cloud initialization: the repository no longer has a HEAD commit.");
  }
  if (branchAfterPush !== expectedBranch) {
    throw new Error("Unable to finish Cloud initialization: the current branch changed after push.");
  }
  if (headAfterPush.toLowerCase() !== expectedHeadCommitId.toLowerCase()) {
    throw new Error("Unable to finish Cloud initialization: HEAD changed after push.");
  }
  await execGit(root, [
    "branch",
    `--set-upstream-to=${remoteName}/${destinationBranch}`,
    expectedBranch,
  ], { timeout: GIT_MUTATION_TIMEOUT_MS }).catch((error) => {
    throw new Error(`Unable to configure the Cloud branch upstream: ${getGitErrorOutput(error)}`);
  });
  return getWorkspaceGitStatus(root);
}

export async function publishWorkspaceGitBranch(rootPath, remoteName = null) {
  const root = resolveWorkspacePath(rootPath, null);
  const status = await getWorkspaceGitStatus(root);
  assertNoInProgressGitOperation(status, "publish");
  await pushWorkspaceGitWithDefaultUpstream(root, remoteName);
  return getWorkspaceGitStatus(root);
}

export async function syncWorkspaceGit(rootPath) {
  const root = resolveWorkspacePath(rootPath, null);
  const status = await getWorkspaceGitStatus(root);

  if (!status.isRepo) {
    throw new Error("Current workspace is not a Git repository.");
  }
  assertNoInProgressGitOperation(status, "sync");
  if (status.sourceControl.remote.canPublish) {
    await pushWorkspaceGitWithDefaultUpstream(root);
    return getWorkspaceGitStatus(root);
  }

  if (status.sourceControl.remote.behind > 0) {
    const pullArgs = await buildDefaultPullArgs(root);
    await execGit(root, pullArgs, { timeout: GIT_NETWORK_TIMEOUT_MS }).catch((error) => {
      throw new Error(`Unable to sync changes: ${getGitErrorOutput(error)}`);
    });
  }

  const refreshedStatus = await getWorkspaceGitStatus(root);
  if (refreshedStatus.sourceControl.remote.ahead > 0) {
    await execGit(root, ["push"], { timeout: GIT_NETWORK_TIMEOUT_MS }).catch((error) => {
      if (isMissingUpstreamError(error)) {
        return pushWorkspaceGitWithDefaultUpstream(root);
      }
      throw new Error(`Unable to sync changes: ${getGitErrorOutput(error)}`);
    });
  }

  return getWorkspaceGitStatus(root);
}

async function nodeFromEntry(folder, entry, parentRelative) {
  const entryPath = path.join(folder, entry.name);
  const relativePath = joinRelativePath(parentRelative, entry.name);
  const metadata = await fs.lstat(entryPath).catch(() => null);
  if (!metadata || metadata.isSymbolicLink()) return null;

  const isFolder = metadata.isDirectory();
  const kind = isFolder ? "folder" : classifyFile(entry.name);
  const { preview, content } = isFolder
    ? { preview: null, content: null }
    : await readPreview(entryPath, metadata.size);

  return {
    id: relativePath,
    name: entry.name,
    path: relativePath,
    type: kind,
    mimeType: isFolder ? null : getMimeType(entryPath),
    size: isFolder ? null : formatFileSize(metadata.size),
    modified: Number.isFinite(metadata.mtimeMs)
      ? String(Math.floor(metadata.mtimeMs / 1000))
      : null,
    preview,
    content,
    children: null,
  };
}

function normalizeNewEntryName(value) {
  if (typeof value !== "string") {
    throw new Error("Name is required.");
  }

  const name = value.trim();
  if (!name) {
    throw new Error("Name is required.");
  }
  if (name === "." || name === ".." || name.includes("/") || name.includes("\\") || path.isAbsolute(name)) {
    throw new Error("Name must be a single file or folder name.");
  }
  if (name.includes("\0")) {
    throw new Error("Name contains an invalid character.");
  }
  return name;
}

function joinRelativePath(parent, name) {
  return parent ? `${parent}/${name}` : name;
}

function classifyFile(name) {
  return classifyLocalFile(name);
}

async function readPreview(filePath, size) {
  if (size > MAX_PREVIEW_BYTES || !isPreviewable(filePath)) {
    return { preview: null, content: null };
  }

  const bytes = await fs.readFile(filePath).catch(() => null);
  if (!bytes || bytes.includes(0)) return { preview: null, content: null };

  const content = bytes.toString("utf8").slice(0, 1600);
  const preview = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join("\n");

  return {
    preview: preview || null,
    content: content || null,
  };
}

function isPreviewable(filePath) {
  return isLocalFilePreviewable(filePath);
}

function formatFileSize(bytes) {
  const kb = 1024;
  const mb = kb * 1024;
  const gb = mb * 1024;

  if (bytes >= gb) return `${(bytes / gb).toFixed(1)} GB`;
  if (bytes >= mb) return `${(bytes / mb).toFixed(1)} MB`;
  if (bytes >= kb) return `${(bytes / kb).toFixed(1)} KB`;
  return `${bytes} B`;
}

function createFileSystemIdentity(metadata, canonicalPath) {
  const device = Number(metadata.dev);
  const inode = Number(metadata.ino);
  if (Number.isFinite(device) && Number.isFinite(inode) && inode > 0) {
    return `fs:${device}:${inode}`;
  }
  // Some virtual/network filesystems do not expose a stable inode. Keep the
  // fallback explicit; it remains a local workspace-instance concern only.
  return `path:${canonicalPath}`;
}

function createWorkspaceInstanceId(fsIdentity) {
  return `wsi_${crypto.createHash("sha256").update(fsIdentity).digest("base64url").slice(0, 24)}`;
}

function getGitErrorOutput(error) {
  const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
  const stdout = typeof error?.stdout === "string" ? error.stdout.trim() : "";

  if (isGitTimeoutError(error)) {
    const timeoutSeconds = Number.isFinite(error?.gitTimeoutMs)
      ? Math.round(error.gitTimeoutMs / 1000)
      : Math.round(GIT_DEFAULT_TIMEOUT_MS / 1000);
    const timeoutMessage = `Git command timed out after ${timeoutSeconds}s. The operation may be waiting for credentials, network access, or a remote server response.`;
    return [stderr, stdout, timeoutMessage].filter(Boolean).join("\n");
  }

  if (stderr) return stderr;
  if (stdout) return stdout;
  return error instanceof Error ? error.message : String(error);
}

function isGitTimeoutError(error) {
  return Boolean(
    error?.killed === true ||
      error?.signal === "SIGTERM" ||
      /timed out|timeout/i.test(error instanceof Error ? error.message : String(error)),
  );
}

function isMissingUpstreamError(error) {
  const message = getGitErrorOutput(error);
  return /no upstream branch|has no upstream branch|--set-upstream/i.test(message);
}

function assertNoInProgressGitOperation(status, requestedOperation) {
  const operation = status?.sourceControl?.operation;
  if (operation) {
    throw new Error(
      `Unable to ${requestedOperation} changes while ${operation.kind} is in progress. Resolve and continue it, or abort it first.`,
    );
  }
  const conflictCount = status?.sourceControl?.groups
    ?.find((group) => group.id === "merge")
    ?.resources?.length ?? 0;
  if (conflictCount > 0) {
    throw new Error(
      `Unable to ${requestedOperation} changes while unresolved file conflicts remain. Resolve and stage them first.`,
    );
  }
}

async function buildDefaultPullArgs(rootPath) {
  const config = await readPuppyoneWorkspaceConfig(rootPath).catch(() => null);
  const remotes = await readGitRemotes(rootPath);
  const puppyoneHostingActive = hasEffectivePuppyoneHostingTarget(remotes, config);
  const upstream = await execGit(rootPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
    .then((result) => result.stdout.trim())
    .catch(() => "");
  if (upstream && !puppyoneHostingActive) return ["pull", "--rebase", "--autostash"];

  const branch = await execGit(rootPath, ["branch", "--show-current"])
    .then((result) => result.stdout.trim())
    .catch(() => "");
  const rawBranches = await readGitBranches(rootPath);
  const headCommitId = await execGit(rootPath, ["rev-parse", "HEAD"])
    .then((result) => result.stdout.trim())
    .catch(() => "");
  const branches = normalizeGitBranches(rawBranches, branch || "detached", headCommitId);
  const target = chooseGitSyncTarget(remotes, branches, branch || "detached", config);
  const remoteName = target.remote;
  const branchName = target.branch;

  if (remoteName && branchName) return ["pull", "--rebase", "--autostash", remoteName, branchName];
  return ["pull", "--rebase", "--autostash"];
}

async function pushWorkspaceGitWithDefaultUpstream(rootPath, requestedRemoteName = null) {
  const branch = await execGit(rootPath, ["branch", "--show-current"])
    .then((result) => result.stdout.trim())
    .catch(() => "");
  if (!branch) {
    throw new Error("Unable to push changes: current workspace is not on a branch.");
  }
  const config = await readPuppyoneWorkspaceConfig(rootPath).catch(() => null);
  const remotes = await readGitRemotes(rootPath);
  const targetBranch = getConfiguredSyncBranch(config, branch, hasEffectivePuppyoneHostingTarget(remotes, config));
  const refspec = targetBranch === branch ? branch : `HEAD:${targetBranch}`;
  const remote = await chooseDefaultPushRemote(rootPath, requestedRemoteName);
  await execGit(rootPath, ["push", "--set-upstream", remote, refspec], { timeout: GIT_NETWORK_TIMEOUT_MS }).catch((error) => {
    throw new Error(`Unable to push changes: ${getGitErrorOutput(error)}`);
  });
}

async function chooseDefaultPushRemote(rootPath, requestedRemoteName = null) {
  const remotes = await readGitRemotes(rootPath);
  if (requestedRemoteName) {
    const normalizedRemoteName = normalizeGitRemoteName(requestedRemoteName);
    if (remotes.some((remote) => remote.name === normalizedRemoteName)) return normalizedRemoteName;
    throw new Error(`Unable to push changes: remote '${normalizedRemoteName}' is not configured.`);
  }
  const config = await readPuppyoneWorkspaceConfig(rootPath).catch(() => null);
  // A canonical PuppyOne Project remote is the hosted source of truth even
  // when this repository also keeps a GitHub `origin`. Initialization maps any
  // local branch to puppyone/main; later ordinary Push must preserve that same
  // contract instead of silently selecting origin by name precedence.
  const puppyoneRemote = choosePuppyoneRemoteName(remotes, config);
  if (puppyoneRemote) return puppyoneRemote;
  const preferredRemoteName = config?.sync?.sourceOfTruth?.remote ?? config?.git?.primaryRemote ?? config?.backup?.remote;
  if (preferredRemoteName && remotes.some((remote) => remote.name === preferredRemoteName)) return preferredRemoteName;
  if (remotes.some((remote) => remote.name === "origin")) return "origin";
  if (remotes.some((remote) => remote.name === "puppyone")) return "puppyone";
  const firstRemote = remotes[0]?.name;
  if (firstRemote) return firstRemote;
  throw new Error("Unable to push changes: no Git remote is configured.");
}

async function buildPuppyoneCloudSyncTarget(rootPath, config) {
  const remotes = await readGitRemotes(rootPath);
  const branch = await execGit(rootPath, ["branch", "--show-current"])
    .then((result) => result.stdout.trim())
    .catch(() => "");
  const rawBranches = await readGitBranches(rootPath);
  const headCommitId = await execGit(rootPath, ["rev-parse", "HEAD"])
    .then((result) => result.stdout.trim())
    .catch(() => "");
  const branches = normalizeGitBranches(rawBranches, branch || "detached", headCommitId);
  return chooseGitSyncTarget(remotes, branches, branch || "detached", config);
}

function formatGitCheckoutError(error) {
  const message = getGitErrorOutput(error);
  if (/local changes.*overwritten|would be overwritten|commit your changes or stash/i.test(message)) {
    return "Cannot switch branch because local changes would be overwritten. Commit or stash your changes before switching branches.";
  }
  if (/already checked out|is already used by worktree/i.test(message)) {
    return "Cannot switch branch because that branch is already checked out in another worktree.";
  }
  if (/pathspec .* did not match|invalid reference|not a commit/i.test(message)) {
    return "Cannot find that branch. Fetch remotes and try again.";
  }
  return `Unable to checkout branch: ${message}`;
}

async function buildGitBranchSwitchArgs(rootPath, normalizedBranch, options = {}) {
  if (!options.remote) {
    return ["switch", normalizedBranch];
  }

  const localBranch = normalizedBranch.split("/").slice(1).join("/");
  const localExists = localBranch
    ? await execGit(rootPath, ["show-ref", "--verify", "--quiet", `refs/heads/${localBranch}`])
      .then(() => true)
      .catch(() => false)
    : false;

  return localExists ? ["switch", localBranch] : ["switch", "--track", normalizedBranch];
}

async function getWorkspaceCommitCount(rootPath) {
  const isRepo = await execGit(rootPath, ["rev-parse", "--is-inside-work-tree"])
    .then((result) => result.stdout.trim() === "true")
    .catch(() => false);
  if (!isRepo) return 0;
  return execGit(rootPath, ["rev-list", "--count", "HEAD"])
    .then((result) => Number.parseInt(result.stdout.trim(), 10) || 0)
    .catch(() => 0);
}

async function readGitBranches(rootPath, options = {}) {
  const signal = options.signal;
  const result = await execGit(rootPath, [
    "for-each-ref",
    "refs/heads",
    "refs/remotes",
    "--format=%(refname)%09%(refname:short)%09%(HEAD)%09%(upstream:short)%09%(upstream:track,nobracket)%09%(objectname:short)%09%(contents:subject)%09%(committerdate:iso-strict)%09%(authorname)",
  ], { optionalLocks: false, signal }).catch(() => {
    throwIfGitStatusAborted(signal);
    return { stdout: "" };
  });

  return result.stdout
    .split(/\r?\n/)
    .map(parseGitBranchLine)
    .filter(Boolean);
}

function normalizeGitBranches(branches, currentBranchName, headCommitId) {
  if (!currentBranchName || currentBranchName === "detached") return branches;

  let foundCurrentBranch = false;
  const normalized = branches.map((branch) => {
    if (branch.remote || branch.name !== currentBranchName) return branch;
    foundCurrentBranch = true;
    return {
      ...branch,
      current: true,
    };
  });

  if (foundCurrentBranch) return normalized;

  return [
    {
      name: currentBranchName,
      current: true,
      remote: false,
      upstream: null,
      ahead: 0,
      behind: 0,
      lastCommitId: headCommitId || null,
      lastCommitMessage: null,
      lastCommitDate: null,
      lastCommitAuthorName: null,
    },
    ...normalized,
  ];
}

async function readGitSyncTarget(
  rootPath,
  remotes,
  branches,
  currentBranchName,
  headCommitId,
  config = undefined,
  options = {},
) {
  const signal = options.signal;
  throwIfGitStatusAborted(signal);
  const resolvedConfig = config === undefined
    ? await readPuppyoneWorkspaceConfig(rootPath).catch(() => null)
    : config;
  const target = chooseGitSyncTarget(remotes, branches, currentBranchName, resolvedConfig);
  const remoteName = target.remote;
  const branchName = target.branch;

  if (!remoteName || !branchName) {
    return {
      remote: remoteName ?? null,
      branch: branchName ?? null,
      ref: null,
      exists: false,
      ahead: 0,
      behind: 0,
      incomingFileSummary: createEmptyGitFileSummary(),
      incomingPreview: [],
      outgoingPreview: [],
    };
  }

  const remoteRef = `refs/remotes/${remoteName}/${branchName}`;
  const remoteExists = await execGit(
    rootPath,
    ["rev-parse", "--verify", "--quiet", remoteRef],
    { optionalLocks: false, signal },
  )
    .then((result) => Boolean(result.stdout.trim()))
    .catch(() => {
      throwIfGitStatusAborted(signal);
      return false;
    });

  if (!remoteExists) {
    return {
      remote: remoteName,
      branch: branchName,
      ref: `${remoteName}/${branchName}`,
      exists: false,
      ahead: 0,
      behind: 0,
      incomingFileSummary: createEmptyGitFileSummary(),
      incomingPreview: [],
      outgoingPreview: [],
    };
  }

  const counts = headCommitId
    ? await readGitAheadBehindCounts(rootPath, remoteRef, { signal })
    : { ahead: 0, behind: 0 };
  const comparisons = counts.ahead > 0 || counts.behind > 0
    ? await resolveGitRemoteDiffComparisons(rootPath, remoteRef, {
      signal,
      hasHead: Boolean(headCommitId),
    })
    : null;
  const [incomingPreview, outgoingPreview, incomingFileSummary] = await Promise.all([
    counts.behind > 0
      ? readGitComparisonPreview(rootPath, comparisons.incoming, "remote", {
        signal,
        limit: GIT_REMOTE_PREVIEW_LIMIT,
      })
      : [],
    counts.ahead > 0
      ? readGitComparisonPreview(rootPath, comparisons.outgoing, "committed", {
        signal,
        limit: GIT_REMOTE_PREVIEW_LIMIT,
      })
      : [],
    counts.behind > 0
      ? readGitComparisonFileSummary(rootPath, comparisons.incoming, { signal })
      : createEmptyGitFileSummary(),
  ]);

  return {
    remote: remoteName,
    branch: branchName,
    ref: `${remoteName}/${branchName}`,
    exists: true,
    ahead: counts.ahead,
    behind: counts.behind,
    incomingFileSummary,
    incomingPreview,
    outgoingPreview,
  };
}

function createEmptyGitFileSummary() {
  return {
    total: 0,
    added: 0,
    modified: 0,
    deleted: 0,
    renamed: 0,
    copied: 0,
    changed: 0,
  };
}

function chooseConfiguredRemoteName(remotes, config) {
  const configuredRemoteName = config?.sync?.sourceOfTruth?.remote ?? config?.git?.primaryRemote ?? config?.backup?.remote;
  if (configuredRemoteName && remotes.some((remote) => remote.name === configuredRemoteName)) return configuredRemoteName;
  if (remotes.some((remote) => remote.name === "origin")) return "origin";
  if (remotes.some((remote) => remote.name.toLowerCase() === "puppyone")) return "puppyone";
  return remotes[0]?.name ?? null;
}

function createNoRepositoryHosting() {
  return {
    kind: "local-only",
    remoteName: null,
    branchName: null,
    ref: null,
    ready: false,
    reason: "no-repository",
    identity: null,
  };
}

function resolveGitEffectiveHosting({ remotes, branches, currentBranchName, syncTarget, config }) {
  const configuredService = config?.sync?.sourceOfTruth?.service ?? null;
  const configuredRemoteName = config?.sync?.sourceOfTruth?.remote ?? config?.git?.primaryRemote ?? config?.backup?.remote ?? null;
  const configuredRemote = configuredRemoteName ? remotes.find((remote) => remote.name === configuredRemoteName) ?? null : null;
  const syncRemote = syncTarget?.remote ? remotes.find((remote) => remote.name === syncTarget.remote) ?? null : null;
  const currentBranch = branches.find((branch) => branch.current && !branch.remote) ?? null;
  const upstreamRemoteName = currentBranch?.upstream ? splitRemoteBranchName(currentBranch.upstream)?.remote ?? null : null;
  const upstreamRemote = upstreamRemoteName ? remotes.find((remote) => remote.name === upstreamRemoteName) ?? null : null;
  const branchName = syncTarget?.branch ?? normalizeCurrentBranchName(currentBranchName);
  const ref = syncTarget?.ref ?? (syncTarget?.remote && branchName ? `${syncTarget.remote}/${branchName}` : null);

  if (isPuppyoneHostingConfig(config)) {
    const puppyoneRemoteName = choosePuppyoneRemoteName(remotes, config);
    const puppyoneRemote = puppyoneRemoteName ? remotes.find((remote) => remote.name === puppyoneRemoteName) ?? null : null;
    if (puppyoneRemote) {
      return {
        kind: "puppyone-cloud",
        remoteName: puppyoneRemote?.name ?? null,
        branchName: branchName ?? PUPPYONE_CLOUD_DEFAULT_BRANCH,
        ref: puppyoneRemote?.name ? ref ?? `${puppyoneRemote.name}/${branchName ?? PUPPYONE_CLOUD_DEFAULT_BRANCH}` : null,
        ready: Boolean(puppyoneRemote),
        reason: puppyoneRemote ? "configured" : "missing-remote",
        identity: buildPuppyoneHostingIdentity(puppyoneRemote),
      };
    }
  }

  if (configuredService === "github") {
    const githubRemote = configuredRemote && isGithubRemote(configuredRemote)
      ? configuredRemote
      : remotes.find(isGithubRemote) ?? null;
    if (githubRemote) {
      return buildRemoteHosting({
        kind: "github",
        remote: githubRemote,
        branchName,
        ref,
        reason: configuredRemoteName ? "configured" : "remote-detected",
      });
    }
  }

  for (const candidate of [configuredRemote, syncRemote, upstreamRemote]) {
    if (!candidate) continue;
    if (isGithubRemote(candidate)) {
      return buildRemoteHosting({
        kind: "github",
        remote: candidate,
        branchName,
        ref,
        reason: candidate === upstreamRemote ? "upstream-detected" : configuredRemoteName ? "configured" : "remote-detected",
      });
    }
    if (isPuppyoneRemote(candidate)) {
      return buildRemoteHosting({
        kind: "puppyone-cloud",
        remote: candidate,
        branchName: branchName ?? PUPPYONE_CLOUD_DEFAULT_BRANCH,
        ref,
        reason: candidate === upstreamRemote ? "upstream-detected" : configuredRemoteName ? "configured" : "remote-detected",
      });
    }
  }

  const detectedGithubRemote = remotes.find(isGithubRemote) ?? null;
  if (detectedGithubRemote) {
    return buildRemoteHosting({
      kind: "github",
      remote: detectedGithubRemote,
      branchName,
      ref,
      reason: "remote-detected",
    });
  }

  const detectedPuppyoneRemote = remotes.find(isPuppyoneRemote) ?? null;
  if (detectedPuppyoneRemote) {
    return buildRemoteHosting({
      kind: "puppyone-cloud",
      remote: detectedPuppyoneRemote,
      branchName: branchName ?? PUPPYONE_CLOUD_DEFAULT_BRANCH,
      ref,
      reason: "remote-detected",
    });
  }

  const fallbackRemoteName = syncTarget?.remote ?? chooseConfiguredRemoteName(remotes, config);
  const fallbackRemote = fallbackRemoteName ? remotes.find((remote) => remote.name === fallbackRemoteName) ?? null : null;
  if (fallbackRemote) {
    return buildRemoteHosting({
      kind: "generic-git",
      remote: fallbackRemote,
      branchName,
      ref,
      reason: configuredRemoteName ? "configured" : syncTarget?.remote ? "upstream-detected" : "remote-detected",
    });
  }

  return {
    kind: "local-only",
    remoteName: null,
    branchName: normalizeCurrentBranchName(currentBranchName),
    ref: null,
    ready: true,
    reason: "local-only",
    identity: null,
  };
}

function buildRemoteHosting({ kind, remote, branchName, ref, reason }) {
  return {
    kind,
    remoteName: remote.name,
    branchName: branchName ?? null,
    ref: ref ?? (branchName ? `${remote.name}/${branchName}` : null),
    ready: true,
    reason,
    identity: kind === "github"
      ? buildGithubHostingIdentity(remote)
      : kind === "puppyone-cloud"
        ? buildPuppyoneHostingIdentity(remote)
        : null,
  };
}

function getRemoteUrl(remote) {
  return remote?.fetchUrl ?? remote?.pushUrl ?? null;
}

function isGithubRemote(remote) {
  return isGithubRemoteUrl(remote?.fetchUrl) || isGithubRemoteUrl(remote?.pushUrl);
}

function isGithubRemoteUrl(rawUrl) {
  if (!rawUrl) return false;
  return /(^|[/:@])github\.com([/:]|$)/i.test(rawUrl);
}

function isPuppyoneRemote(remote) {
  return isPuppyoneRemoteUrl(remote?.fetchUrl) || isPuppyoneRemoteUrl(remote?.pushUrl);
}

function isPuppyoneRemoteUrl(rawUrl) {
  return Boolean(parsePuppyoneRemoteInfo(rawUrl));
}

function buildGithubHostingIdentity(remote) {
  const repo = parseGithubRemoteUrl(getRemoteUrl(remote));
  if (!repo) {
    return {
      provider: "github",
      label: remote?.name ?? "GitHub",
      href: null,
    };
  }
  return {
    provider: "github",
    label: repo.label,
    href: repo.href,
  };
}

function parseGithubRemoteUrl(rawUrl) {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  const sshScpMatch = trimmed.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (sshScpMatch) return formatGithubRepoIdentity(sshScpMatch[1], sshScpMatch[2]);

  try {
    const url = new URL(trimmed);
    if (url.hostname.toLowerCase() !== "github.com") return null;
    const [owner, repo] = url.pathname.replace(/^\/+/, "").split("/");
    return formatGithubRepoIdentity(owner, repo);
  } catch {
    return null;
  }
}

function formatGithubRepoIdentity(owner, repo) {
  const cleanOwner = typeof owner === "string" ? owner.trim() : "";
  const cleanRepo = typeof repo === "string" ? repo.trim().replace(/\.git$/i, "") : "";
  if (!cleanOwner || !cleanRepo) return null;
  return {
    label: cleanRepo,
    href: `https://github.com/${cleanOwner}/${cleanRepo}`,
  };
}

function buildPuppyoneHostingIdentity(remote) {
  const info = parsePuppyoneRemoteInfo(getRemoteUrl(remote));
  return {
    provider: "puppyone-cloud",
    label: info?.displayId ?? remote?.name ?? "Puppyone Cloud",
    href: null,
  };
}

export function parsePuppyoneRemoteInfo(rawUrl) {
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    if (
      !["http:", "https:"].includes(url.protocol)
      || !url.host
      || url.username
      || url.password
      || url.search
      || url.hash
    ) {
      return null;
    }
    const accessPointMatch = url.pathname.match(/^\/git\/ap\/([^/]+)\.git$/);
    const accessKey = accessPointMatch?.[1];
    if (accessPointMatch) {
      return {
        kind: "access-point",
        host: url.host,
        origin: url.origin.toLowerCase(),
        displayId: accessKey ? maskSecret(accessKey) : "access point",
        accessKey,
      };
    }

    const id = "[A-Za-z0-9][A-Za-z0-9_-]{0,199}";
    const scopedMatch = url.pathname.match(
      new RegExp(`^/git/(${id})/scopes/(${id})\\.git$`),
    );
    if (scopedMatch) {
      return {
        kind: "scope",
        host: url.host,
        origin: url.origin.toLowerCase(),
        displayId: `${scopedMatch[1]}/${scopedMatch[2]}`,
        projectId: scopedMatch[1],
        scopeId: scopedMatch[2],
      };
    }

    const projectMatch = url.pathname.match(new RegExp(`^/git/(${id})\\.git$`));
    const projectId = projectMatch?.[1];
    if (projectMatch) {
      return {
        kind: "project",
        host: url.host,
        origin: url.origin.toLowerCase(),
        displayId: projectId ?? "project",
        projectId,
      };
    }
  } catch {
    return null;
  }

  return null;
}

function maskSecret(value) {
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function parseGitAheadBehindCounts(output) {
  const [aheadText, behindText] = output.trim().split(/\s+/);
  return {
    ahead: Number.parseInt(aheadText, 10) || 0,
    behind: Number.parseInt(behindText, 10) || 0,
  };
}

async function readGitAheadBehindCounts(rootPath, remoteRef, options = {}) {
  const signal = options.signal;
  const symmetricCounts = await execGit(
    rootPath,
    ["rev-list", "--left-right", "--count", `HEAD...${remoteRef}`],
    { optionalLocks: false, signal },
  )
    .then((result) => parseGitAheadBehindCounts(result.stdout))
    .catch(() => {
      throwIfGitStatusAborted(signal);
      return null;
    });
  if (symmetricCounts) return symmetricCounts;

  const [aheadResult, behindResult] = await Promise.all([
    execGit(rootPath, ["rev-list", "--count", `${remoteRef}..HEAD`], { optionalLocks: false, signal })
      .catch(() => {
        throwIfGitStatusAborted(signal);
        return { stdout: "0" };
      }),
    execGit(rootPath, ["rev-list", "--count", `HEAD..${remoteRef}`], { optionalLocks: false, signal })
      .catch(() => {
        throwIfGitStatusAborted(signal);
        return { stdout: "0" };
      }),
  ]);

  return {
    ahead: Number.parseInt(aheadResult.stdout.trim(), 10) || 0,
    behind: Number.parseInt(behindResult.stdout.trim(), 10) || 0,
  };
}

async function attachGitRevisionPairs(rootPath, scope, detail, { comparison = null, signal } = {}) {
  if (!Array.isArray(detail.files) || detail.files.length === 0) return detail;
  const hasHead = scope === "staged"
    ? await execGit(rootPath, ["rev-parse", "--verify", "--quiet", "HEAD"], { signal })
      .then((result) => Boolean(result.stdout.trim()))
      .catch(() => {
        throwIfGitStatusAborted(signal);
        return false;
      })
    : true;

  const files = await Promise.all(detail.files.map(async (file) => {
    const specs = deriveGitRevisionSpecs({
      scope,
      file,
      comparison,
      hasHead,
      getMimeType,
    });
    const revisionPair = await resolveGitRevisionPair({
      rootPath,
      scope,
      path: file.path,
      oldPath: file.oldPath,
      status: file.status,
      before: specs.before,
      after: specs.after,
      signal,
    });
    return {
      ...file,
      mimeType: getMimeType(file.path) ?? getMimeType(file.oldPath ?? ""),
      revisionPair,
    };
  }));
  return { ...detail, files };
}


function formatGitFileDiffError(scope, error) {
  const message = getGitErrorOutput(error);
  if (/no merge base|no common ancestor/i.test(message)) {
    return "Cannot preview this diff because the local branch and remote branch do not share a common history. Pull with a merge or rebase strategy, then try again.";
  }
  if (/bad revision|unknown revision|ambiguous argument|not a valid object name/i.test(message)) {
    return scope === "remote"
      ? "Cannot preview this remote change because the remote branch is not available locally. Fetch remote changes and try again."
      : "Cannot preview this committed change because the comparison branch is not available locally. Fetch remote changes and try again.";
  }
  return scope === "remote"
    ? `Unable to preview remote change: ${message}`
    : `Unable to preview committed change: ${message}`;
}

function parseGitBranchLine(line) {
  if (!line.trim()) return null;
  const [
    refName,
    shortName,
    headMarker,
    upstream,
    trackingText,
    lastCommitId,
    lastCommitMessage,
    lastCommitDate,
    lastCommitAuthorName,
  ] = line.split("\t");

  if (!refName || !shortName) return null;
  const remote = refName.startsWith("refs/remotes/");
  if (remote && shortName.endsWith("/HEAD")) return null;
  if (remote && !shortName.includes("/")) return null;
  const { ahead, behind } = parseGitTrackingText(trackingText);

  return {
    name: shortName,
    current: headMarker === "*",
    remote,
    upstream: upstream || null,
    ahead,
    behind,
    lastCommitId: lastCommitId || null,
    lastCommitMessage: lastCommitMessage || null,
    lastCommitDate: lastCommitDate || null,
    lastCommitAuthorName: lastCommitAuthorName || null,
  };
}

function parseGitTrackingText(value) {
  const text = value || "";
  const aheadMatch = /ahead (\d+)/.exec(text);
  const behindMatch = /behind (\d+)/.exec(text);
  return {
    ahead: aheadMatch ? Number.parseInt(aheadMatch[1], 10) || 0 : 0,
    behind: behindMatch ? Number.parseInt(behindMatch[1], 10) || 0 : 0,
  };
}

async function readGitRemotes(rootPath, options = {}) {
  const signal = options.signal;
  const result = await execGit(rootPath, ["remote", "-v"], { optionalLocks: false, signal }).catch(() => {
    throwIfGitStatusAborted(signal);
    return { stdout: "" };
  });
  const remotes = new Map();

  for (const line of result.stdout.split(/\r?\n/)) {
    const match = /^(\S+)\s+(.+)\s+\((fetch|push)\)$/.exec(line.trim());
    if (!match) continue;
    const [, name, url, kind] = match;
    const remote = remotes.get(name) ?? {
      name,
      fetchUrl: null,
      pushUrl: null,
      branches: [],
    };
    if (kind === "fetch") remote.fetchUrl = url;
    if (kind === "push") remote.pushUrl = url;
    remotes.set(name, remote);
  }

  return [...remotes.values()];
}

async function readGitHistory(rootPath, limit, options = {}) {
  const baseArgs = [
    "log",
    ...(options.allBranches ? ["--all"] : []),
    "--topo-order",
    "-n",
    String(limit),
    "--date=iso-strict",
    "--pretty=format:%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%s",
  ];

  const [statusResult, statsResult, graphByCommit] = await Promise.all([
    execGit(rootPath, [
      ...baseArgs,
      "--name-status",
    ]).catch(() => ({ stdout: "" })),
    execGit(rootPath, [
      ...baseArgs,
      "--numstat",
    ]).catch(() => ({ stdout: "" })),
    readGitGraphLayout(rootPath, limit, options),
  ]);

  if (!statusResult.stdout.trim()) return [];

  const statsByCommit = new Map(
    statsResult.stdout
      .split("\x1e")
      .map(parseGitNumstatSection)
      .filter(Boolean)
      .map((commit) => [commit.commit_id, commit.changes]),
  );

  return statusResult.stdout
    .split("\x1e")
    .map(parseGitCommitSection)
    .filter(Boolean)
    .map((commit) => ({
      ...commit,
      graph_prefix: graphByCommit.get(commit.commit_id)?.prefix ?? "",
      graph_continuation_prefixes: graphByCommit.get(commit.commit_id)?.continuations ?? [],
      changes: mergeGitChangeStats(commit.changes, statsByCommit.get(commit.commit_id) ?? []),
    }));
}

async function readGitGraphLayout(rootPath, limit, options = {}) {
  const result = await execGit(rootPath, [
    "log",
    ...(options.allBranches ? ["--all"] : []),
    "--topo-order",
    "-n",
    String(limit),
    "--graph",
    "--pretty=format:%x1e%H",
  ]).catch(() => ({ stdout: "" }));

  return parseGitGraphLayout(result.stdout);
}

function parseGitGraphLayout(output) {
  const graphByCommit = new Map();
  let currentCommitId = null;

  for (const line of output.split(/\r?\n/)) {
    const markerIndex = line.indexOf("\x1e");
    if (markerIndex >= 0) {
      const commitId = line.slice(markerIndex + 1).trim();
      if (!commitId) {
        currentCommitId = null;
        continue;
      }
      currentCommitId = commitId;
      graphByCommit.set(commitId, {
        prefix: line.slice(0, markerIndex).replace(/\s+$/, ""),
        continuations: [],
      });
      continue;
    }

    if (!currentCommitId) continue;
    const continuation = line.replace(/\s+$/, "");
    if (!continuation.trim()) continue;
    graphByCommit.get(currentCommitId)?.continuations.push(continuation);
  }

  return graphByCommit;
}

function parseGitNumstatSection(section) {
  const lines = section.replace(/^\r?\n/, "").split(/\r?\n/);
  const header = lines.shift();
  if (!header) return null;

  const [commitId] = header.split("\x1f");
  if (!commitId) return null;

  return {
    commit_id: commitId,
    changes: lines
      .map(parseGitNumstatLine)
      .filter(Boolean),
  };
}

function parseGitNumstatLine(line) {
  if (!line.trim()) return null;
  const parts = line.split("\t");
  if (parts.length < 3) return null;

  const [additionsText, deletionsText, ...pathParts] = parts;
  return {
    path: normalizeNumstatPath(pathParts.join("\t")),
    additions: parseNumstatCount(additionsText),
    deletions: parseNumstatCount(deletionsText),
  };
}

function mergeGitChangeStats(changes, stats) {
  const unusedStats = new Set(stats);
  const statsByPath = new Map(stats.map((stat) => [stat.path, stat]));
  const nextChanges = changes.map((change) => {
    const stat = statsByPath.get(change.path);
    if (!stat) return change;
    unusedStats.delete(stat);
    return {
      ...change,
      additions: stat.additions,
      deletions: stat.deletions,
    };
  });

  for (const stat of unusedStats) {
    nextChanges.push({
      path: stat.path,
      oldPath: null,
      status: "changed",
      additions: stat.additions,
      deletions: stat.deletions,
    });
  }

  return nextChanges;
}

function normalizeNumstatPath(value) {
  const normalized = value.trim();
  if (!normalized.includes("=>")) return normalized;

  const braceMatch = /^(.*)\{(.+)\s=>\s(.+)\}(.*)$/.exec(normalized);
  if (braceMatch) {
    const [, prefix, , nextName, suffix] = braceMatch;
    return `${prefix}${nextName}${suffix}`.replace(/\/+/g, "/");
  }

  const parts = normalized.split(/\s=>\s/);
  return parts[parts.length - 1] || normalized;
}

function parseNumstatCount(value) {
  if (value === "-") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseGitCommitSection(section) {
  const lines = section.replace(/^\r?\n/, "").split(/\r?\n/);
  const header = lines.shift();
  if (!header) return null;

  const [commitId, parentsText, authorName, authorEmail, createdAt, ...messageParts] = header.split("\x1f");
  if (!commitId) return null;

  return {
    commit_id: commitId,
    parent_ids: parentsText ? parentsText.split(" ").filter(Boolean) : [],
    author_name: authorName || "Unknown",
    author_email: authorEmail || "",
    created_at: createdAt || null,
    message: messageParts.join("\x1f") || "(no message)",
    changes: lines
      .map(parseGitNameStatusLine)
      .filter(Boolean),
  };
}

function parseGitNameStatusLine(line) {
  if (!line.trim()) return null;
  const parts = line.split("\t");
  const code = parts[0] || "";
  const statusCode = code[0];

  if (statusCode === "R") {
    return {
      path: parts[2] || parts[1] || "",
      oldPath: parts[1] || null,
      status: "renamed",
      additions: null,
      deletions: null,
    };
  }

  if (statusCode === "C") {
    return {
      path: parts[2] || parts[1] || "",
      oldPath: parts[1] || null,
      status: "copied",
      additions: null,
      deletions: null,
    };
  }

  const status = statusCode === "A"
    ? "added"
    : statusCode === "D"
      ? "deleted"
      : statusCode === "M"
        ? "modified"
        : "changed";

  return {
    path: parts[1] || "",
    oldPath: null,
    status,
    additions: null,
    deletions: null,
  };
}

function parseGitPatch(patchText) {
  const files = [];
  let current = null;
  let oldLine = 0;
  let newLine = 0;
  let totalDiffLines = 0;

  const pushCurrent = () => {
    if (!current) return;
    const { _additions, _deletions, _omittedLines, ...file } = current;
    files.push({
      ...file,
      additions: current.binary ? null : _additions,
      deletions: current.binary ? null : _deletions,
      truncated: _omittedLines > 0,
      omittedLines: _omittedLines,
    });
  };

  const pushDiffLine = (diffLine) => {
    if (!current) return;
    if (
      current.lines.length >= GIT_DETAIL_MAX_FILE_DIFF_LINES ||
      totalDiffLines >= GIT_DETAIL_MAX_TOTAL_DIFF_LINES
    ) {
      current._omittedLines += 1;
      return;
    }
    current.lines.push(diffLine);
    totalDiffLines += 1;
  };

  for (const line of patchText.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      pushCurrent();
      current = parseGitDiffHeader(line);
      oldLine = 0;
      newLine = 0;
      continue;
    }

    if (!current) continue;

    if (line.startsWith("new file mode ")) {
      current.status = "added";
      continue;
    }
    if (line.startsWith("deleted file mode ")) {
      current.status = "deleted";
      continue;
    }
    if (line.startsWith("rename from ")) {
      current.oldPath = line.slice("rename from ".length);
      current.status = "renamed";
      continue;
    }
    if (line.startsWith("rename to ")) {
      current.path = line.slice("rename to ".length);
      current.status = "renamed";
      continue;
    }
    if (line.startsWith("Binary files ")) {
      current.binary = true;
      continue;
    }
    if (line.startsWith("@@ ")) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      oldLine = match ? Number.parseInt(match[1], 10) : 0;
      newLine = match ? Number.parseInt(match[2], 10) : 0;
      pushDiffLine({ kind: "hunk", text: line });
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      current._additions += 1;
      pushDiffLine({ kind: "add", text: line.slice(1), newLine: newLine || undefined });
      newLine += 1;
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      current._deletions += 1;
      pushDiffLine({ kind: "remove", text: line.slice(1), oldLine: oldLine || undefined });
      oldLine += 1;
      continue;
    }
    if (line.startsWith(" ")) {
      pushDiffLine({
        kind: "context",
        text: line.slice(1),
        oldLine: oldLine || undefined,
        newLine: newLine || undefined,
      });
      oldLine += 1;
      newLine += 1;
    }
  }

  pushCurrent();
  return files;
}

function parseGitDiffHeader(line) {
  const body = line.slice("diff --git ".length);
  const marker = " b/";
  const markerIndex = body.indexOf(marker);
  const oldPath = markerIndex >= 0 ? stripGitPrefix(body.slice(0, markerIndex)) : "";
  const nextPath = markerIndex >= 0 ? body.slice(markerIndex + marker.length) : stripGitPrefix(body);

  return {
    path: nextPath,
    oldPath: oldPath && oldPath !== nextPath ? oldPath : null,
    status: "modified",
    binary: false,
    lines: [],
    _additions: 0,
    _deletions: 0,
    _omittedLines: 0,
  };
}

function stripGitPrefix(value) {
  if (value.startsWith("a/") || value.startsWith("b/")) return value.slice(2);
  return value;
}

function assertSafeCommitId(commitId) {
  if (typeof commitId !== "string" || !/^[0-9a-fA-F]{4,64}$/.test(commitId)) {
    throw new Error("Commit id must be a Git object id.");
  }
}

async function buildUntrackedFileDiff(rootPath, relativePath, options = {}) {
  const filePath = await resolveExistingWorkspacePath(rootPath, relativePath);
  const metadata = await fs.stat(filePath).catch((error) => {
    throw new Error(`Unable to read untracked file: ${error.message}`);
  });

  if (metadata.isDirectory()) {
    return {
      path: relativePath,
      oldPath: null,
      status: "added",
      additions: null,
      deletions: null,
      binary: true,
      lines: [],
    };
  }

  if (metadata.size > MAX_EDITOR_BYTES) {
    return {
      path: relativePath,
      oldPath: null,
      status: "added",
      additions: null,
      deletions: null,
      binary: true,
      lines: [],
    };
  }

  const bytes = await fs.readFile(filePath, { signal: options.signal }).catch((error) => {
    throw new Error(`Unable to read untracked file: ${error.message}`);
  });
  if (bytes.includes(0)) {
    return {
      path: relativePath,
      oldPath: null,
      status: "added",
      additions: null,
      deletions: null,
      binary: true,
      lines: [],
    };
  }

  const lines = bytes.toString("utf8").split(/\r?\n/).map((line, index) => ({
    kind: "add",
    text: line,
    newLine: index + 1,
  }));

  return {
    path: relativePath,
    oldPath: null,
    status: "added",
    additions: lines.length,
    deletions: 0,
    binary: false,
    lines,
  };
}

function normalizeGitPathList(paths, options = {}) {
  const values = Array.isArray(paths) ? paths : [];
  if (values.length === 0) {
    if (options.allowEmpty) return [];
    throw new Error("At least one file path is required.");
  }

  return values.map((value) => {
    const normalized = normalizeRelativePath(value);
    if (!normalized) throw new Error("File path is required.");
    return normalized;
  });
}

async function normalizeCommitMessage(rootPath, message) {
  const normalized = typeof message === "string" ? message.trim() : "";
  if (normalized) return normalized;
  return buildDefaultCommitMessage(rootPath);
}

function normalizeOneShotGitIdentity(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 254 || /[\0\r\n]/.test(normalized)) return null;
  return normalized;
}

async function buildDefaultCommitMessage(rootPath) {
  const result = await execGit(rootPath, ["diff", "--cached", "--name-only"]).catch(() => null);
  const stagedPaths = (result?.stdout ?? "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (stagedPaths.length === 1) {
    return `Update ${path.basename(stagedPaths[0]) || stagedPaths[0]}`;
  }

  if (stagedPaths.length > 1) {
    return `Update ${stagedPaths.length} files`;
  }

  return "Update workspace";
}

async function normalizeGitBranchName(rootPath, branchName) {
  if (typeof branchName !== "string") {
    throw new Error("Branch name is required.");
  }
  const normalized = branchName.trim();
  if (!normalized) throw new Error("Branch name is required.");
  if (normalized.startsWith("-")) throw new Error("Branch name is invalid.");

  await execGit(rootPath, ["check-ref-format", "--branch", normalized]).catch((error) => {
    throw new Error(`Branch name is invalid: ${error.message}`);
  });
  return normalized;
}

function normalizeGitRemoteName(remoteName) {
  if (typeof remoteName !== "string") {
    throw new Error("Remote name is required.");
  }
  const normalized = remoteName.trim();
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(normalized) || normalized.startsWith("-")) {
    throw new Error("Remote name is invalid.");
  }
  return normalized;
}

function normalizeGitRemoteUrl(remoteUrl) {
  if (typeof remoteUrl !== "string") {
    throw new Error("Remote URL is required.");
  }
  const normalized = remoteUrl.trim();
  let url;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("Remote URL is invalid.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Remote URL must use http or https.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Remote URL must not contain credentials or query data.");
  }
  const id = "[A-Za-z0-9][A-Za-z0-9_-]{0,199}";
  const canonicalPath = new RegExp(`^/git/(?:${id}\\.git|${id}/scopes/${id}\\.git)$`);
  if (!canonicalPath.test(url.pathname)) {
    throw new Error("Remote URL is not a PuppyOne Git endpoint.");
  }
  return url.toString();
}
