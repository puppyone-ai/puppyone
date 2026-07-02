import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const MAX_ENTRIES_PER_FOLDER = 500;
const MAX_PREVIEW_BYTES = 4096;
const MAX_EDITOR_BYTES = 1024 * 1024;
const GIT_HISTORY_LIMIT = 100;
const GIT_ALL_BRANCH_HISTORY_LIMIT = 320;
const GIT_REMOTE_PREVIEW_LIMIT = 12;
const GIT_MAX_BUFFER = 1024 * 1024 * 4;
const GIT_EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const PUPPYONE_CONFIG_DIR = ".puppyone";
const PUPPYONE_CONFIG_FILE = "config.json";
const GIT_RESOURCE_GROUPS = Object.freeze([
  { id: "merge", label: "Merge Changes" },
  { id: "index", label: "Staged Changes" },
  { id: "workingTree", label: "Changes" },
  { id: "untracked", label: "Untracked Changes" },
]);
const DEFAULT_PUPPYONE_WORKSPACE_CONFIG = Object.freeze({
  version: 1,
  sync: {
    sourceOfTruth: {
      service: "puppyone",
      remote: null,
      branch: null,
    },
  },
  git: {
    primaryRemote: null,
    watchedBranch: null,
  },
  backup: {
    enabled: false,
    service: "puppyone",
    remote: null,
    branch: null,
  },
  cloud: {
    projectId: null,
  },
});
const execFileAsync = promisify(execFile);
const localApiDir = path.dirname(fileURLToPath(import.meta.url));
const fileFormatRegistry = loadFileFormatRegistry();
const unknownFormat = fileFormatRegistry.unknownFormat;
const mimeTypeByExtension = new Map(Object.entries({
  "3g2": "video/3gpp2",
  "3gp": "video/3gpp",
  "3gpp": "video/3gpp",
  "7z": "application/x-7z-compressed",
  aac: "audio/aac",
  aif: "audio/aiff",
  aifc: "audio/aiff",
  aiff: "audio/aiff",
  apng: "image/apng",
  avi: "video/x-msvideo",
  avif: "image/avif",
  azw: "application/x-mobipocket-ebook",
  azw3: "application/x-mobipocket-ebook",
  bmp: "image/bmp",
  bz: "application/x-bzip2",
  bz2: "application/x-bzip2",
  cer: "application/pkix-cert",
  cr2: "image/x-canon-cr2",
  crt: "application/x-x509-ca-cert",
  css: "text/css",
  csv: "text/csv",
  db: "application/vnd.sqlite3",
  db3: "application/vnd.sqlite3",
  der: "application/pkix-cert",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  eot: "application/vnd.ms-fontobject",
  epub: "application/epub+zip",
  flac: "audio/flac",
  flv: "video/x-flv",
  gif: "image/gif",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  gz: "application/gzip",
  heic: "image/heic",
  heif: "image/heif",
  htm: "text/html",
  html: "text/html",
  ico: "image/x-icon",
  img: "application/x-iso9660-image",
  ipynb: "application/x-ipynb+json",
  iso: "application/x-iso9660-image",
  jpe: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  jpg: "image/jpeg",
  js: "application/javascript",
  json: "application/json",
  json5: "application/json",
  jsonc: "application/json",
  jsonl: "application/x-ndjson",
  key: "application/x-pem-file",
  lzma: "application/x-lzma",
  m2v: "video/mpeg",
  m4a: "audio/mp4",
  m4b: "audio/mp4",
  m4v: "video/mp4",
  md: "text/markdown",
  markdown: "text/markdown",
  mdx: "text/markdown",
  mid: "audio/midi",
  midi: "audio/midi",
  mkv: "video/x-matroska",
  mobi: "application/x-mobipocket-ebook",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  mpe: "video/mpeg",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
  ndjson: "application/x-ndjson",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  ogv: "video/ogg",
  opus: "audio/opus",
  otf: "font/otf",
  p12: "application/x-pkcs12",
  pdf: "application/pdf",
  pem: "application/x-pem-file",
  pfx: "application/x-pkcs12",
  pjp: "image/jpeg",
  pjpeg: "image/jpeg",
  png: "image/png",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  psd: "image/vnd.adobe.photoshop",
  qt: "video/quicktime",
  rar: "application/vnd.rar",
  rtf: "application/rtf",
  sqlite: "application/vnd.sqlite3",
  sqlite3: "application/vnd.sqlite3",
  stl: "model/stl",
  svg: "image/svg+xml",
  tar: "application/x-tar",
  "tar.bz2": "application/x-bzip2",
  "tar.gz": "application/gzip",
  "tar.xz": "application/x-xz",
  tbz: "application/x-bzip2",
  tbz2: "application/x-bzip2",
  tgz: "application/gzip",
  tif: "image/tiff",
  tiff: "image/tiff",
  tsv: "text/tab-separated-values",
  ttc: "font/ttf",
  ttf: "font/ttf",
  txz: "application/x-xz",
  wav: "audio/wav",
  wave: "audio/wav",
  weba: "audio/webm",
  webm: "video/webm",
  webp: "image/webp",
  wma: "audio/x-ms-wma",
  wmv: "video/x-ms-wmv",
  woff: "font/woff",
  woff2: "font/woff2",
  xhtml: "text/html",
  xls: "application/vnd.ms-excel",
  xlsb: "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xml: "application/xml",
  xz: "application/x-xz",
  zip: "application/zip",
}));
const mimeOverrideExtensions = [...mimeTypeByExtension.keys()].sort((left, right) => right.length - left.length);
const filenameIndex = new Map();
const extensionIndex = new Map();
const mimeIndex = new Map();
const filenamePatterns = [];

for (const format of fileFormatRegistry.formats) {
  for (const filename of format.filenames ?? []) {
    filenameIndex.set(filename.toLowerCase(), format);
  }
  for (const pattern of format.filenamePatterns ?? []) {
    filenamePatterns.push({
      regex: globPatternToRegExp(pattern.toLowerCase()),
      format,
    });
  }
  for (const extension of format.extensions ?? []) {
    extensionIndex.set(extension.toLowerCase(), format);
  }
  for (const mimeType of format.mimeTypes ?? []) {
    mimeIndex.set(mimeType.toLowerCase(), format);
  }
}

export async function workspaceFromPath(folderPath) {
  const resolvedPath = path.resolve(folderPath);
  const metadata = await fs.stat(resolvedPath).catch((error) => {
    throw new Error(`Unable to open folder: ${error.message}`);
  });

  if (!metadata.isDirectory()) {
    throw new Error("Selected path is not a folder.");
  }

  return {
    id: stableWorkspaceId(resolvedPath),
    name: path.basename(resolvedPath) || resolvedPath,
    path: resolvedPath,
    status: "protected",
    commitCount: await getWorkspaceCommitCount(resolvedPath),
    cloudState: "local",
  };
}

export async function listFolderChildren(rootPath, folderPath) {
  const folder = resolveWorkspacePath(rootPath, folderPath);
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

export async function readWorkspaceFile(rootPath, relativePath) {
  const filePath = resolveWorkspacePath(rootPath, relativePath);
  return fs.readFile(filePath);
}

export async function readWorkspaceTextFile(rootPath, relativePath) {
  const filePath = resolveWorkspacePath(rootPath, relativePath);
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
    };
  }

  return {
    path: normalizeRelativePath(relativePath),
    name: path.basename(filePath),
    type: classifyFile(filePath),
    content: bytes.toString("utf8"),
    mimeType: getMimeType(filePath) ?? "text/plain; charset=utf-8",
    size: formatFileSize(metadata.size),
  };
}

export function getMimeType(filePath) {
  const format = resolveLocalFileFormat({ name: filePath });
  const mimeType = getMimeTypeOverride(filePath) ?? format.mimeTypes?.[0] ?? null;
  if (!mimeType) return null;
  return shouldUseUtf8Mime(format, mimeType) ? `${mimeType}; charset=utf-8` : mimeType;
}

export async function writeWorkspaceTextFile(rootPath, relativePath, content) {
  if (typeof content !== "string") {
    throw new Error("File content must be text.");
  }
  const filePath = resolveWorkspacePath(rootPath, relativePath);
  const metadata = await fs.stat(filePath).catch((error) => {
    throw new Error(`Unable to write file: ${error.message}`);
  });
  if (metadata.isDirectory()) {
    throw new Error("Selected path is a folder.");
  }
  await fs.writeFile(filePath, content, "utf8");
}

export async function createWorkspaceEntry(rootPath, request) {
  const parentPath = request?.parentPath ?? null;
  const name = normalizeNewEntryName(request?.name);
  const kind = request?.kind;
  const parent = resolveWorkspacePath(rootPath, parentPath);
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
  const sourcePath = resolveWorkspacePath(rootPath, relativePath);
  const parentPath = path.posix.dirname(relativePath);
  const normalizedParent = parentPath === "." ? "" : parentPath;
  const nextRelativePath = joinRelativePath(normalizedParent, nextName);
  const targetPath = resolveWorkspacePath(rootPath, nextRelativePath);

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

  const sourcePath = resolveWorkspacePath(rootPath, fromRelativePath);
  const targetPath = resolveWorkspacePath(rootPath, toRelativePath);
  const targetParentPath = path.dirname(targetPath);

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

export async function deleteWorkspaceEntry(rootPath, request) {
  const relativePath = normalizeRelativePath(request?.path);
  if (!relativePath) {
    throw new Error("Cannot delete the workspace root.");
  }

  const targetPath = resolveWorkspacePath(rootPath, relativePath);
  await fs.rm(targetPath, { recursive: true, force: false }).catch((error) => {
    throw new Error(`Unable to delete entry: ${error.message}`);
  });

  return { path: relativePath };
}

export async function getWorkspaceGitStatus(rootPath) {
  const root = resolveWorkspacePath(rootPath, null);
  const isRepo = await execGit(root, ["rev-parse", "--is-inside-work-tree"])
    .then((result) => result.stdout.trim() === "true")
    .catch(() => false);

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
      sourceControl,
      commits: [],
      allCommits: [],
    };
  }

  const [
    branchResult,
    symbolicBranchResult,
    headResult,
    countResult,
    statusResult,
    branches,
    remotes,
    commits,
    allCommits,
  ] = await Promise.all([
    execGit(root, ["branch", "--show-current"]).catch(() => ({ stdout: "" })),
    execGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => ({ stdout: "" })),
    execGit(root, ["rev-parse", "HEAD"]).catch(() => ({ stdout: "" })),
    execGit(root, ["rev-list", "--count", "HEAD"]).catch(() => ({ stdout: "0" })),
    execGit(root, ["status", "--porcelain=v2", "-z", "--branch"]).catch((error) => {
      throw new Error(`Unable to read git status: ${error.message}`);
    }),
    readGitBranches(root),
    readGitRemotes(root),
    readGitHistory(root, GIT_HISTORY_LIMIT),
    readGitHistory(root, GIT_ALL_BRANCH_HISTORY_LIMIT, { allBranches: true }),
  ]);
  const parsedStatus = parseGitPorcelainV2Status(statusResult.stdout);
  const branchName = branchResult.stdout.trim() || symbolicBranchResult.stdout.trim() || "detached";
  const normalizedBranches = normalizeGitBranches(branches, branchName, headResult.stdout.trim());
  const normalizedRemotes = remotes.map((remote) => ({
    ...remote,
    branches: normalizedBranches
      .filter((branch) => branch.remote && branch.name.startsWith(`${remote.name}/`))
      .map((branch) => branch.name),
  }));
  const syncTarget = await readGitSyncTarget(root, normalizedRemotes, normalizedBranches, branchName, headResult.stdout.trim());
  const currentBranch = normalizedBranches.find((branch) => branch.current && !branch.remote) ?? null;
  const sourceControl = buildGitSourceControlSnapshot({
    entries: parsedStatus.entries,
    branchName,
    syncTarget,
    currentBranch,
    headCommitId: headResult.stdout.trim() || null,
  });

  return {
    isRepo: true,
    branch: branchName,
    headCommitId: headResult.stdout.trim() || null,
    totalCommits: Number.parseInt(countResult.stdout.trim(), 10) || commits.length,
    entries: parsedStatus.entries,
    stagedEntries: parsedStatus.entries.filter(hasStagedStatus),
    unstagedEntries: parsedStatus.entries.filter(hasUnstagedStatus),
    untrackedEntries: parsedStatus.entries.filter((entry) => entry.status === "untracked"),
    branches: normalizedBranches,
    remotes: normalizedRemotes,
    syncTarget,
    sourceControl,
    commits,
    allCommits,
  };
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
    execGit(root, ["branch", "--show-current"]).catch(() => ({ stdout: "" })),
    execGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => ({ stdout: "" })),
    execGit(root, ["rev-parse", "HEAD"]).catch(() => ({ stdout: "" })),
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

export async function initializeWorkspaceGitRepository(rootPath) {
  const root = resolveWorkspacePath(rootPath, null);
  const isRepo = await execGit(root, ["rev-parse", "--is-inside-work-tree"])
    .then((result) => result.stdout.trim() === "true")
    .catch(() => false);

  if (!isRepo) {
    await execGit(root, ["init"]).catch((error) => {
      throw new Error(`Unable to initialize repository: ${getGitErrorOutput(error)}`);
    });
  }

  return getWorkspaceGitStatus(root);
}

export async function configureWorkspaceCloudRemote(rootPath, remoteUrl, remoteName = "puppyone") {
  const root = resolveWorkspacePath(rootPath, null);
  const normalizedRemoteName = normalizeGitRemoteName(remoteName);
  const normalizedRemoteUrl = normalizeGitRemoteUrl(remoteUrl);
  const isRepo = await execGit(root, ["rev-parse", "--is-inside-work-tree"])
    .then((result) => result.stdout.trim() === "true")
    .catch(() => false);

  if (!isRepo) {
    await execGit(root, ["init"]).catch((error) => {
      throw new Error(`Unable to initialize repository: ${getGitErrorOutput(error)}`);
    });
  }

  const remoteExists = await execGit(root, ["remote", "get-url", normalizedRemoteName])
    .then(() => true)
    .catch(() => false);
  const args = remoteExists
    ? ["remote", "set-url", normalizedRemoteName, normalizedRemoteUrl]
    : ["remote", "add", normalizedRemoteName, normalizedRemoteUrl];

  await execGit(root, args).catch((error) => {
    throw new Error(`Unable to configure Cloud remote: ${getGitErrorOutput(error)}`);
  });

  return getWorkspaceGitStatus(root);
}

export async function readPuppyoneWorkspaceConfig(rootPath) {
  const root = resolveWorkspacePath(rootPath, null);
  const configPath = path.join(root, PUPPYONE_CONFIG_DIR, PUPPYONE_CONFIG_FILE);
  const rawConfig = await fs.readFile(configPath, "utf8").catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw new Error(`Unable to read PuppyOne config: ${error.message}`);
  });

  if (!rawConfig) return normalizePuppyoneWorkspaceConfig(null);

  try {
    return normalizePuppyoneWorkspaceConfig(JSON.parse(rawConfig));
  } catch (error) {
    throw new Error(`Unable to parse PuppyOne config: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function writePuppyoneWorkspaceConfig(rootPath, config) {
  const root = resolveWorkspacePath(rootPath, null);
  const configDir = path.join(root, PUPPYONE_CONFIG_DIR);
  const configPath = path.join(configDir, PUPPYONE_CONFIG_FILE);
  const normalizedConfig = normalizePuppyoneWorkspaceConfig(config, {
    updatedAt: new Date().toISOString(),
  });

  await fs.mkdir(configDir, { recursive: true }).catch((error) => {
    throw new Error(`Unable to create PuppyOne config directory: ${error.message}`);
  });
  await fs.writeFile(configPath, `${JSON.stringify(normalizedConfig, null, 2)}\n`, "utf8").catch((error) => {
    throw new Error(`Unable to write PuppyOne config: ${error.message}`);
  });

  return normalizedConfig;
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

export async function getWorkspaceGitFileDiff(rootPath, relativePath, scope = "unstaged") {
  const root = resolveWorkspacePath(rootPath, null);
  const normalizedPath = normalizeRelativePath(relativePath);
  if (!normalizedPath) throw new Error("File path is required.");

  if (scope === "untracked") {
    return {
      commit_id: "working-tree",
      files: [await buildUntrackedFileDiff(root, normalizedPath)],
    };
  }

  if (scope === "remote") {
    const status = await getWorkspaceGitStatus(root);
    const target = status.sourceControl.remote.target;
    if (!target?.remote || !target.branch || target.exists !== true) {
      throw new Error("Remote branch is not available.");
    }

    const remoteRef = `refs/remotes/${target.remote}/${target.branch}`;
    const diffRange = await resolveGitRemoteDiffRange(root, "incoming", remoteRef);
    const patchResult = await execGit(root, [
      "diff",
      "--find-renames",
      "--patch",
      "--unified=3",
      "--no-ext-diff",
      diffRange,
      "--",
      normalizedPath,
    ]).catch((error) => {
      throw new Error(formatGitFileDiffError("remote", error));
    });

    return {
      commit_id: target.ref ?? remoteRef,
      files: parseGitPatch(patchResult.stdout),
    };
  }

  if (scope === "committed") {
    const status = await getWorkspaceGitStatus(root);
    const target = status.sourceControl.remote.target;
    if (!target?.remote || !target.branch || target.exists !== true) {
      throw new Error("Remote branch is not available.");
    }

    const remoteRef = `refs/remotes/${target.remote}/${target.branch}`;
    const diffRange = await resolveGitRemoteDiffRange(root, "outgoing", remoteRef);
    const patchResult = await execGit(root, [
      "diff",
      "--find-renames",
      "--patch",
      "--unified=3",
      "--no-ext-diff",
      diffRange,
      "--",
      normalizedPath,
    ]).catch((error) => {
      throw new Error(formatGitFileDiffError("committed", error));
    });

    return {
      commit_id: "local-commits",
      files: parseGitPatch(patchResult.stdout),
    };
  }

  const args = [
    "diff",
    "--find-renames",
    "--patch",
    "--unified=3",
    "--no-ext-diff",
  ];
  if (scope === "staged") args.push("--cached");
  args.push("--", normalizedPath);

  const patchResult = await execGit(root, args).catch((error) => {
    throw new Error(`Unable to read git file diff: ${error.message}`);
  });

  return {
    commit_id: "working-tree",
    files: parseGitPatch(patchResult.stdout),
  };
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

export async function commitWorkspaceGit(rootPath, message) {
  const root = resolveWorkspacePath(rootPath, null);
  const normalizedMessage = await normalizeCommitMessage(root, message);
  await execGit(root, ["commit", "-m", normalizedMessage]).catch((error) => {
    throw new Error(`Unable to commit changes: ${error.message}`);
  });
  return getWorkspaceGitStatus(root);
}

export async function checkoutWorkspaceGitBranch(rootPath, branchName, options = {}) {
  const root = resolveWorkspacePath(rootPath, null);
  const normalizedBranch = await normalizeGitBranchName(root, branchName);
  const args = await buildGitBranchSwitchArgs(root, normalizedBranch, options);

  await execGit(root, args).catch((error) => {
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
    ]).catch((error) => {
      throw new Error(`Unable to stash changes: ${getGitErrorOutput(error)}`);
    });
  }

  const args = await buildGitBranchSwitchArgs(root, normalizedBranch, options);
  await execGit(root, args).catch(async (error) => {
    if (hasLocalChanges) {
      await execGit(root, ["stash", "pop"]).catch(() => {});
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
    await execGit(root, ["add", "--all"]).catch((error) => {
      throw new Error(`Unable to stage changes: ${getGitErrorOutput(error)}`);
    });
    await execGit(root, ["commit", "-m", `Commit before switching to ${normalizedBranch}`]).catch((error) => {
      throw new Error(`Unable to commit changes: ${getGitErrorOutput(error)}`);
    });
  }

  const args = await buildGitBranchSwitchArgs(root, normalizedBranch, options);
  await execGit(root, args).catch((error) => {
    throw new Error(formatGitCheckoutError(error));
  });

  return getWorkspaceGitStatus(root);
}

export async function createWorkspaceGitBranch(rootPath, branchName) {
  const root = resolveWorkspacePath(rootPath, null);
  const normalizedBranch = await normalizeGitBranchName(root, branchName);
  await execGit(root, ["switch", "-c", normalizedBranch]).catch((error) => {
    throw new Error(`Unable to create branch: ${error.message}`);
  });
  return getWorkspaceGitStatus(root);
}

export async function fetchWorkspaceGit(rootPath) {
  const root = resolveWorkspacePath(rootPath, null);
  const remotes = await readGitRemotes(root);

  if (remotes.length === 0) {
    throw new Error("Unable to fetch remotes: no Git remotes are configured.");
  }

  const failures = [];
  for (const remote of remotes) {
    await execGit(root, ["fetch", "--prune", remote.name], { timeout: 30000 }).catch((error) => {
      failures.push(`remote '${remote.name}': ${getGitErrorOutput(error)}`);
    });
  }

  if (failures.length === remotes.length) {
    throw new Error(`Unable to fetch remotes: ${failures.join("; ")}`);
  }

  if (failures.length > 0) {
    console.warn(`Some Git remotes could not be fetched: ${failures.join("; ")}`);
  }

  return getWorkspaceGitStatus(root);
}

export async function pullWorkspaceGit(rootPath) {
  const root = resolveWorkspacePath(rootPath, null);
  const pullArgs = await buildDefaultPullArgs(root);
  await execGit(root, pullArgs, { timeout: 30000 }).catch((error) => {
    throw new Error(`Unable to pull changes: ${getGitErrorOutput(error)}`);
  });
  return getWorkspaceGitStatus(root);
}

export async function pushWorkspaceGit(rootPath) {
  const root = resolveWorkspacePath(rootPath, null);
  await execGit(root, ["push"], { timeout: 30000 }).catch((error) => {
    if (isMissingUpstreamError(error)) {
      return pushWorkspaceGitWithDefaultUpstream(root);
    }
    throw new Error(`Unable to push changes: ${getGitErrorOutput(error)}`);
  });
  return getWorkspaceGitStatus(root);
}

export async function publishWorkspaceGitBranch(rootPath, remoteName = null) {
  const root = resolveWorkspacePath(rootPath, null);
  await pushWorkspaceGitWithDefaultUpstream(root, remoteName);
  return getWorkspaceGitStatus(root);
}

export async function syncWorkspaceGit(rootPath) {
  const root = resolveWorkspacePath(rootPath, null);
  const status = await getWorkspaceGitStatus(root);

  if (!status.isRepo) {
    throw new Error("Current workspace is not a Git repository.");
  }
  if (status.sourceControl.remote.canPublish) {
    await pushWorkspaceGitWithDefaultUpstream(root);
    return getWorkspaceGitStatus(root);
  }

  if (status.sourceControl.remote.behind > 0) {
    const pullArgs = await buildDefaultPullArgs(root);
    await execGit(root, pullArgs, { timeout: 30000 }).catch((error) => {
      throw new Error(`Unable to sync changes: ${getGitErrorOutput(error)}`);
    });
  }

  const refreshedStatus = await getWorkspaceGitStatus(root);
  if (refreshedStatus.sourceControl.remote.ahead > 0) {
    await execGit(root, ["push"], { timeout: 30000 }).catch((error) => {
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
    size: isFolder ? null : formatFileSize(metadata.size),
    modified: Number.isFinite(metadata.mtimeMs)
      ? String(Math.floor(metadata.mtimeMs / 1000))
      : null,
    preview,
    content,
    children: null,
  };
}

function resolveWorkspacePath(rootPath, relativePath) {
  const root = path.resolve(rootPath);
  const normalizedRelative = normalizeRelativePath(relativePath);
  const resolved = normalizedRelative ? path.resolve(root, normalizedRelative) : root;
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Folder path is outside the selected workspace.");
  }
  return resolved;
}

function normalizeRelativePath(value) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") {
    throw new Error("Folder path must be a string.");
  }
  if (path.isAbsolute(value)) {
    throw new Error("Folder path is outside the selected workspace.");
  }
  const normalized = path.normalize(value).replaceAll("\\", "/");
  if (normalized === "." || normalized === "") return "";
  if (normalized.startsWith("../") || normalized === ".." || normalized.includes("/../")) {
    throw new Error("Folder path is outside the selected workspace.");
  }
  return normalized;
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
  return getSemanticKindForFormat(resolveLocalFileFormat({ name }));
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
  return isTextLikeFormat(resolveLocalFileFormat({ name: filePath }));
}

function loadFileFormatRegistry() {
  const candidatePaths = [
    path.resolve(localApiDir, "../vendor/shared-ui/src/core/fileFormats.json"),
    path.resolve(localApiDir, "../../frontend/shared-ui/src/core/fileFormats.json"),
  ];

  for (const registryPath of candidatePaths) {
    try {
      return JSON.parse(readFileSync(registryPath, "utf8"));
    } catch {
      // Try the next candidate. The source path keeps dev usable before vendor sync.
    }
  }

  throw new Error("Unable to load PuppyOne file format registry.");
}

function resolveLocalFileFormat({ name, mimeType }) {
  if (name) {
    const base = path.basename(name).toLowerCase();
    const byName = filenameIndex.get(base);
    if (byName) return byName;

    const byExtension = matchExtension(name);
    if (byExtension) return byExtension;

    const byPattern = matchFilenamePattern(name);
    if (byPattern) return byPattern;
  }

  if (mimeType) {
    const normalizedMime = mimeType.toLowerCase().split(";")[0].trim();
    const byMime = mimeIndex.get(normalizedMime);
    if (byMime) return byMime;

    if (normalizedMime.startsWith("image/")) {
      return {
        ...unknownFormat,
        id: "image-unknown",
        label: "Image",
        category: "image",
        defaultViewer: "image-preview",
      };
    }

    if (
      normalizedMime.startsWith("text/") ||
      normalizedMime === "application/javascript" ||
      normalizedMime === "application/typescript"
    ) {
      return {
        ...unknownFormat,
        id: "text-unknown",
        label: "Text",
        category: "text",
        defaultViewer: "plain-text",
        monacoLanguage: "plaintext",
      };
    }
  }

  return unknownFormat;
}

function matchExtension(name) {
  const lower = path.basename(name).toLowerCase();
  const lastDot = lower.lastIndexOf(".");
  if (lastDot < 0) return null;

  const secondLastDot = lower.lastIndexOf(".", lastDot - 1);
  if (secondLastDot >= 0) {
    const compound = lower.slice(secondLastDot);
    const compoundMatch = extensionIndex.get(compound);
    if (compoundMatch) return compoundMatch;
  }

  return extensionIndex.get(lower.slice(lastDot)) ?? null;
}

function matchFilenamePattern(name) {
  const normalized = String(name).replace(/\\/g, "/").toLowerCase();
  const base = path.basename(normalized);

  for (const { regex, format } of filenamePatterns) {
    if (regex.test(normalized) || regex.test(base)) return format;
  }

  return null;
}

function globPatternToRegExp(pattern) {
  let source = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    const afterNext = pattern[index + 2];

    if (char === "*" && next === "*" && afterNext === "/") {
      source += "(?:.*/)?";
      index += 2;
      continue;
    }

    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      continue;
    }

    source += escapeRegExp(char);
  }

  return new RegExp(`${source}$`);
}

function escapeRegExp(value) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function getMimeTypeOverride(name) {
  const lower = path.basename(name).toLowerCase();
  for (const extension of mimeOverrideExtensions) {
    if (lower.endsWith(`.${extension}`)) {
      return mimeTypeByExtension.get(extension) ?? null;
    }
  }
  return null;
}

function getSemanticKindForFormat(format) {
  if (format.id === "json" || format.id === "jsonl") return "json";

  switch (format.defaultViewer) {
    case "markdown-editor":
      return "markdown";
    case "html-artifact":
      return "html";
    case "image-preview":
      return "image";
    case "audio-preview":
      return "audio";
    case "video-preview":
      return "video";
    case "pdf-preview":
      return "pdf";
    case "csv-table":
      return "spreadsheet";
    default:
      break;
  }

  switch (format.category) {
    case "markdown":
      return "markdown";
    case "image":
      return "image";
    case "audio":
      return "audio";
    case "video":
      return "video";
    case "archive":
      return "archive";
    case "document":
      return format.id === "xlsx" ? "spreadsheet" : "document";
    case "binary":
      return "binary";
    case "text":
      return "text";
    case "code":
    case "data":
      return "code";
    default:
      return "file";
  }
}

function isTextLikeFormat(format) {
  return (
    format.category === "markdown" ||
    format.category === "text" ||
    format.category === "code" ||
    format.defaultViewer === "csv-table" ||
    (format.category === "data" && format.defaultViewer === "monaco-code")
  );
}

function shouldUseUtf8Mime(format, mimeType) {
  return (
    mimeType.startsWith("text/") ||
    format.category === "markdown" ||
    format.category === "text" ||
    format.category === "code" ||
    format.category === "data" ||
    format.defaultViewer === "html-artifact" ||
    format.defaultViewer === "monaco-code" ||
    format.defaultViewer === "csv-table" ||
    format.defaultViewer === "plain-text"
  );
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

function stableWorkspaceId(folderPath) {
  return `local:${Buffer.from(folderPath).toString("base64url")}`;
}

function execGit(rootPath, args, options = {}) {
  return execFileAsync("git", ["-C", rootPath, "-c", "core.quotePath=false", ...args], {
    timeout: options.timeout ?? 5000,
    maxBuffer: GIT_MAX_BUFFER,
  });
}

function getGitErrorOutput(error) {
  if (typeof error?.stderr === "string" && error.stderr.trim()) {
    return error.stderr.trim();
  }
  if (typeof error?.stdout === "string" && error.stdout.trim()) {
    return error.stdout.trim();
  }
  return error instanceof Error ? error.message : String(error);
}

function isMissingUpstreamError(error) {
  const message = getGitErrorOutput(error);
  return /no upstream branch|has no upstream branch|--set-upstream/i.test(message);
}

async function buildDefaultPullArgs(rootPath) {
  const upstream = await execGit(rootPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
    .then((result) => result.stdout.trim())
    .catch(() => "");
  if (upstream) return ["pull", "--ff-only"];

  const remotes = await readGitRemotes(rootPath);
  const branch = await execGit(rootPath, ["branch", "--show-current"])
    .then((result) => result.stdout.trim())
    .catch(() => "");
  const config = await readPuppyoneWorkspaceConfig(rootPath).catch(() => null);
  const rawBranches = await readGitBranches(rootPath);
  const headCommitId = await execGit(rootPath, ["rev-parse", "HEAD"])
    .then((result) => result.stdout.trim())
    .catch(() => "");
  const branches = normalizeGitBranches(rawBranches, branch || "detached", headCommitId);
  const target = chooseGitSyncTarget(remotes, branches, branch || "detached", config);
  const remoteName = target.remote;
  const branchName = target.branch;

  if (remoteName && branchName) return ["pull", "--ff-only", remoteName, branchName];
  return ["pull", "--ff-only"];
}

async function pushWorkspaceGitWithDefaultUpstream(rootPath, requestedRemoteName = null) {
  const branch = await execGit(rootPath, ["branch", "--show-current"])
    .then((result) => result.stdout.trim())
    .catch(() => "");
  if (!branch) {
    throw new Error("Unable to push changes: current workspace is not on a branch.");
  }
  const config = await readPuppyoneWorkspaceConfig(rootPath).catch(() => null);
  const targetBranch = config?.sync?.sourceOfTruth?.branch ?? config?.backup?.branch ?? config?.git?.watchedBranch ?? branch;
  const refspec = targetBranch === branch ? branch : `HEAD:${targetBranch}`;
  const remote = await chooseDefaultPushRemote(rootPath, requestedRemoteName);
  await execGit(rootPath, ["push", "--set-upstream", remote, refspec], { timeout: 30000 }).catch((error) => {
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
  const preferredRemoteName = config?.sync?.sourceOfTruth?.remote ?? config?.git?.primaryRemote ?? config?.backup?.remote;
  if (preferredRemoteName && remotes.some((remote) => remote.name === preferredRemoteName)) return preferredRemoteName;
  if (remotes.some((remote) => remote.name === "origin")) return "origin";
  if (remotes.some((remote) => remote.name === "puppyone")) return "puppyone";
  const firstRemote = remotes[0]?.name;
  if (firstRemote) return firstRemote;
  throw new Error("Unable to push changes: no Git remote is configured.");
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

async function readGitBranches(rootPath) {
  const result = await execGit(rootPath, [
    "for-each-ref",
    "refs/heads",
    "refs/remotes",
    "--format=%(refname)%09%(refname:short)%09%(HEAD)%09%(upstream:short)%09%(upstream:track,nobracket)%09%(objectname:short)%09%(contents:subject)%09%(committerdate:iso-strict)",
  ]).catch(() => ({ stdout: "" }));

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
    },
    ...normalized,
  ];
}

async function readGitSyncTarget(rootPath, remotes, branches, currentBranchName, headCommitId) {
  const config = await readPuppyoneWorkspaceConfig(rootPath).catch(() => null);
  const target = chooseGitSyncTarget(remotes, branches, currentBranchName, config);
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
      incomingPreview: [],
      outgoingPreview: [],
    };
  }

  const remoteRef = `refs/remotes/${remoteName}/${branchName}`;
  const remoteExists = await execGit(rootPath, ["rev-parse", "--verify", "--quiet", remoteRef])
    .then((result) => Boolean(result.stdout.trim()))
    .catch(() => false);

  if (!remoteExists) {
    return {
      remote: remoteName,
      branch: branchName,
      ref: `${remoteName}/${branchName}`,
      exists: false,
      ahead: 0,
      behind: 0,
      incomingPreview: [],
      outgoingPreview: [],
    };
  }

  const counts = headCommitId ? await readGitAheadBehindCounts(rootPath, remoteRef) : { ahead: 0, behind: 0 };
  const incomingPreview = counts.behind > 0
    ? await readGitRemoteChangePreview(rootPath, `HEAD..${remoteRef}`)
    : [];
  const outgoingPreview = counts.ahead > 0
    ? await readGitOutgoingChangePreview(rootPath, `${remoteRef}..HEAD`)
    : [];

  return {
    remote: remoteName,
    branch: branchName,
    ref: `${remoteName}/${branchName}`,
    exists: true,
    ahead: counts.ahead,
    behind: counts.behind,
    incomingPreview,
    outgoingPreview,
  };
}

function chooseConfiguredRemoteName(remotes, config) {
  const configuredRemoteName = config?.sync?.sourceOfTruth?.remote ?? config?.git?.primaryRemote ?? config?.backup?.remote;
  if (configuredRemoteName && remotes.some((remote) => remote.name === configuredRemoteName)) return configuredRemoteName;
  if (remotes.some((remote) => remote.name === "origin")) return "origin";
  if (remotes.some((remote) => remote.name.toLowerCase() === "puppyone")) return "puppyone";
  return remotes[0]?.name ?? null;
}

function chooseGitSyncTarget(remotes, branches, currentBranchName, config) {
  const configuredRemoteName = config?.sync?.sourceOfTruth?.remote ?? config?.git?.primaryRemote ?? config?.backup?.remote;
  const configuredBranchName = config?.sync?.sourceOfTruth?.branch ?? config?.git?.watchedBranch ?? config?.backup?.branch;
  const remoteNames = new Set(remotes.map((remote) => remote.name));

  if (configuredRemoteName || configuredBranchName) {
    const remote = configuredRemoteName && remoteNames.has(configuredRemoteName)
      ? configuredRemoteName
      : findRemoteForBranch(branches, configuredBranchName)
        ?? preferExistingRemote(remotes, "origin")
        ?? preferExistingRemote(remotes, "puppyone")
        ?? remotes[0]?.name
        ?? null;
    return {
      remote,
      branch: configuredBranchName
        ?? findDefaultBranchForRemote(branches, remote)
        ?? normalizeCurrentBranchName(currentBranchName),
    };
  }

  const currentBranch = branches.find((branch) => branch.current && !branch.remote);
  if (currentBranch?.upstream) {
    const upstreamTarget = splitRemoteBranchName(currentBranch.upstream);
    if (upstreamTarget) return upstreamTarget;
  }

  const originMain = findRemoteBranch(branches, "origin", "main");
  if (originMain) return originMain;

  const puppyoneMain = findRemoteBranch(branches, "puppyone", "main");
  if (puppyoneMain) return puppyoneMain;

  const currentBranchNameSafe = normalizeCurrentBranchName(currentBranchName);
  if (currentBranchNameSafe) {
    const originCurrent = findRemoteBranch(branches, "origin", currentBranchNameSafe);
    if (originCurrent) return originCurrent;
    const puppyoneCurrent = findRemoteBranch(branches, "puppyone", currentBranchNameSafe);
    if (puppyoneCurrent) return puppyoneCurrent;
  }

  const fallbackRemote = preferExistingRemote(remotes, "origin")
    ?? preferExistingRemote(remotes, "puppyone")
    ?? remotes[0]?.name
    ?? null;

  return {
    remote: fallbackRemote,
    branch: findDefaultBranchForRemote(branches, fallbackRemote)
      ?? currentBranchNameSafe
      ?? null,
  };
}

function findRemoteBranch(branches, remoteName, branchName) {
  if (!remoteName || !branchName) return null;
  return branches.some((branch) => branch.remote && branch.name === `${remoteName}/${branchName}`)
    ? { remote: remoteName, branch: branchName }
    : null;
}

function findRemoteForBranch(branches, branchName) {
  if (!branchName) return null;
  const remoteBranch = branches.find((branch) => branch.remote && branch.name.endsWith(`/${branchName}`));
  return remoteBranch ? splitRemoteBranchName(remoteBranch.name)?.remote ?? null : null;
}

function findDefaultBranchForRemote(branches, remoteName) {
  if (!remoteName) return null;
  if (findRemoteBranch(branches, remoteName, "main")) return "main";
  if (findRemoteBranch(branches, remoteName, "master")) return "master";
  const firstRemoteBranch = branches.find((branch) => branch.remote && branch.name.startsWith(`${remoteName}/`));
  return firstRemoteBranch ? firstRemoteBranch.name.slice(remoteName.length + 1) : null;
}

function preferExistingRemote(remotes, remoteName) {
  return remotes.some((remote) => remote.name === remoteName) ? remoteName : null;
}

function normalizeCurrentBranchName(branchName) {
  return branchName && branchName !== "detached" ? branchName : null;
}

function splitRemoteBranchName(value) {
  const slashIndex = value.indexOf("/");
  if (slashIndex <= 0 || slashIndex >= value.length - 1) return null;
  return {
    remote: value.slice(0, slashIndex),
    branch: value.slice(slashIndex + 1),
  };
}

function parseGitAheadBehindCounts(output) {
  const [aheadText, behindText] = output.trim().split(/\s+/);
  return {
    ahead: Number.parseInt(aheadText, 10) || 0,
    behind: Number.parseInt(behindText, 10) || 0,
  };
}

async function readGitAheadBehindCounts(rootPath, remoteRef) {
  const symmetricCounts = await execGit(rootPath, ["rev-list", "--left-right", "--count", `HEAD...${remoteRef}`])
    .then((result) => parseGitAheadBehindCounts(result.stdout))
    .catch(() => null);
  if (symmetricCounts) return symmetricCounts;

  const [aheadResult, behindResult] = await Promise.all([
    execGit(rootPath, ["rev-list", "--count", `${remoteRef}..HEAD`]).catch(() => ({ stdout: "0" })),
    execGit(rootPath, ["rev-list", "--count", `HEAD..${remoteRef}`]).catch(() => ({ stdout: "0" })),
  ]);

  return {
    ahead: Number.parseInt(aheadResult.stdout.trim(), 10) || 0,
    behind: Number.parseInt(behindResult.stdout.trim(), 10) || 0,
  };
}

async function resolveGitRemoteDiffRange(rootPath, direction, remoteRef) {
  const hasHead = await execGit(rootPath, ["rev-parse", "--verify", "--quiet", "HEAD"])
    .then((result) => Boolean(result.stdout.trim()))
    .catch(() => false);

  if (!hasHead) {
    return direction === "incoming" ? `${GIT_EMPTY_TREE}..${remoteRef}` : `${remoteRef}..${GIT_EMPTY_TREE}`;
  }

  const mergeBase = await execGit(rootPath, ["merge-base", "HEAD", remoteRef])
    .then((result) => result.stdout.trim())
    .catch(() => "");

  if (mergeBase) {
    return direction === "incoming" ? `${mergeBase}..${remoteRef}` : `${mergeBase}..HEAD`;
  }

  return direction === "incoming" ? `HEAD..${remoteRef}` : `${remoteRef}..HEAD`;
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

async function readGitRemoteChangePreview(rootPath, range) {
  const result = await execGit(rootPath, [
    "log",
    "--name-status",
    "--format=",
    "-z",
    "--find-renames",
    range,
  ]).catch(() => ({ stdout: "" }));

  return uniqueGitPreviewResources(
    parseGitNameStatusPreview(result.stdout, "remote", GIT_REMOTE_PREVIEW_LIMIT * 4),
    GIT_REMOTE_PREVIEW_LIMIT,
  );
}

async function readGitOutgoingChangePreview(rootPath, range) {
  const result = await execGit(rootPath, [
    "log",
    "--name-status",
    "--format=",
    "-z",
    "--find-renames",
    range,
  ]).catch(() => ({ stdout: "" }));

  return uniqueGitPreviewResources(
    parseGitNameStatusPreview(result.stdout, "committed", GIT_REMOTE_PREVIEW_LIMIT * 4),
    GIT_REMOTE_PREVIEW_LIMIT,
  );
}

function uniqueGitPreviewResources(resources, limit) {
  const seen = new Set();
  const unique = [];

  for (const resource of resources) {
    const key = `${resource.oldPath ?? ""}\0${resource.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(resource);
    if (unique.length >= limit) break;
  }

  return unique;
}

function parseGitNameStatusPreview(output, group, limit) {
  const tokens = output.split("\0").filter(Boolean);
  const resources = [];

  for (let index = 0; index < tokens.length && resources.length < limit; index += 1) {
    const code = tokens[index] ?? "";
    const statusCode = code[0] ?? "";
    if (!statusCode) continue;

    if (statusCode === "R" || statusCode === "C") {
      const oldPath = tokens[index + 1] ?? null;
      const nextPath = tokens[index + 2] ?? oldPath;
      index += 2;
      if (nextPath) {
        resources.push(buildGitPreviewResource({
          path: nextPath,
          oldPath,
          status: statusCode === "R" ? "renamed" : "copied",
          group,
        }));
      }
      continue;
    }

    const filePath = tokens[index + 1] ?? null;
    index += 1;
    if (!filePath) continue;
    resources.push(buildGitPreviewResource({
      path: filePath,
      oldPath: null,
      status: gitNameStatusCodeToLabel(statusCode),
      group,
    }));
  }

  return resources;
}

function buildGitPreviewResource({ path: filePath, oldPath, status, group }) {
  return {
    id: `${group}:${oldPath ?? ""}:${filePath}:${status}`,
    group: "workingTree",
    path: filePath,
    oldPath: oldPath ?? null,
    status,
    staged: false,
    conflict: false,
    letter: gitStatusLabelToLetter(status),
  };
}

function gitNameStatusCodeToLabel(statusCode) {
  if (statusCode === "A") return "added";
  if (statusCode === "D") return "deleted";
  if (statusCode === "R") return "renamed";
  if (statusCode === "C") return "copied";
  if (statusCode === "M") return "modified";
  return "changed";
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

async function readGitRemotes(rootPath) {
  const result = await execGit(rootPath, ["remote", "-v"]).catch(() => ({ stdout: "" }));
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

function normalizePuppyoneWorkspaceConfig(value, options = {}) {
  const source = value && typeof value === "object" ? value : {};
  const sync = source.sync && typeof source.sync === "object" ? source.sync : {};
  const sourceOfTruth = sync.sourceOfTruth && typeof sync.sourceOfTruth === "object" ? sync.sourceOfTruth : {};
  const git = source.git && typeof source.git === "object" ? source.git : {};
  const backup = source.backup && typeof source.backup === "object" ? source.backup : {};
  const cloud = source.cloud && typeof source.cloud === "object" ? source.cloud : {};
  const primaryRemote = normalizeOptionalConfigText(git.primaryRemote);
  const watchedBranch = normalizeOptionalConfigText(git.watchedBranch);
  const sourceOfTruthService = normalizeBackendService(sourceOfTruth.service ?? backup.service);
  const sourceOfTruthRemote =
    normalizeOptionalConfigText(sourceOfTruth.remote)
    ?? primaryRemote
    ?? normalizeOptionalConfigText(backup.remote);
  const sourceOfTruthBranch =
    normalizeOptionalConfigText(sourceOfTruth.branch)
    ?? watchedBranch
    ?? normalizeOptionalConfigText(backup.branch);
  const updatedAt = typeof options.updatedAt === "string"
    ? options.updatedAt
    : typeof source.updatedAt === "string"
      ? source.updatedAt
      : undefined;

  return {
    ...DEFAULT_PUPPYONE_WORKSPACE_CONFIG,
    version: 1,
    sync: {
      sourceOfTruth: {
        service: sourceOfTruthService,
        remote: sourceOfTruthRemote,
        branch: sourceOfTruthBranch,
      },
    },
    git: {
      primaryRemote: primaryRemote ?? sourceOfTruthRemote,
      watchedBranch: watchedBranch ?? sourceOfTruthBranch,
    },
    backup: {
      enabled: backup.enabled === true || cloud.backupEnabled === true,
      service: normalizeBackendService(backup.service ?? sourceOfTruthService),
      remote: normalizeOptionalConfigText(backup.remote) ?? sourceOfTruthRemote,
      branch: normalizeOptionalConfigText(backup.branch) ?? sourceOfTruthBranch,
    },
    cloud: {
      projectId: normalizeOptionalConfigText(cloud.projectId),
    },
    ...(updatedAt ? { updatedAt } : {}),
  };
}

function normalizeBackendService(value) {
  return value === "github" || value === "custom" || value === "puppyone" ? value : "puppyone";
}

function normalizeOptionalConfigText(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

  const pushCurrent = () => {
    if (!current) return;
    const additions = current.lines.filter((line) => line.kind === "add").length;
    const deletions = current.lines.filter((line) => line.kind === "remove").length;
    files.push({
      ...current,
      additions: current.binary ? null : additions,
      deletions: current.binary ? null : deletions,
    });
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
      current.lines.push({ kind: "hunk", text: line });
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.lines.push({ kind: "add", text: line.slice(1), newLine: newLine || undefined });
      newLine += 1;
      continue;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      current.lines.push({ kind: "remove", text: line.slice(1), oldLine: oldLine || undefined });
      oldLine += 1;
      continue;
    }
    if (line.startsWith(" ")) {
      current.lines.push({
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

async function buildUntrackedFileDiff(rootPath, relativePath) {
  const filePath = resolveWorkspacePath(rootPath, relativePath);
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

  const bytes = await fs.readFile(filePath).catch((error) => {
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
  if (!/^\/git\/(?:ap\/)?[^/]+\.git$/.test(url.pathname)) {
    throw new Error("Remote URL is not a PuppyOne Git endpoint.");
  }
  return normalized;
}

function parseGitPorcelainV2Status(output) {
  const entries = [];
  const headers = {};
  const records = output.split("\0");

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;

    if (record.startsWith("# ")) {
      const spaceIndex = record.indexOf(" ", 2);
      if (spaceIndex > 2) {
        headers[record.slice(2, spaceIndex)] = record.slice(spaceIndex + 1);
      }
      continue;
    }

    const type = record[0];
    if (type === "1") {
      const entry = parseGitPorcelainV2OrdinaryRecord(record);
      if (entry) entries.push(entry);
      continue;
    }

    if (type === "2") {
      const { entry, consumedNext } = parseGitPorcelainV2RenameRecord(record, records[index + 1]);
      if (entry) entries.push(entry);
      if (consumedNext) index += 1;
      continue;
    }

    if (type === "u") {
      const entry = parseGitPorcelainV2UnmergedRecord(record);
      if (entry) entries.push(entry);
      continue;
    }

    if (type === "?") {
      const filePath = record.slice(2);
      if (filePath) {
        entries.push({
          path: filePath,
          oldPath: null,
          staged: "?",
          unstaged: "?",
          status: "untracked",
        });
      }
    }
  }

  return { headers, entries };
}

function parseGitPorcelainV2OrdinaryRecord(record) {
  const fields = splitGitPorcelainRecord(record, 8);
  if (fields.length < 9) return null;
  const xy = fields[1] || "  ";
  const filePath = fields[8];
  if (!filePath) return null;
  return buildGitStatusEntry({
    path: filePath,
    oldPath: null,
    staged: xy[0] || " ",
    unstaged: xy[1] || " ",
  });
}

function parseGitPorcelainV2RenameRecord(record, nextRecord) {
  const fields = splitGitPorcelainRecord(record, 9);
  if (fields.length < 10) return { entry: null, consumedNext: false };

  const xy = fields[1] || "  ";
  const pathText = fields[9] || "";
  const tabIndex = pathText.indexOf("\t");
  const filePath = tabIndex >= 0 ? pathText.slice(0, tabIndex) : pathText;
  const oldPathFromRecord = tabIndex >= 0 ? pathText.slice(tabIndex + 1) : null;
  const oldPathFromNext = oldPathFromRecord ?? nextRecord ?? null;
  const consumedNext = Boolean(!oldPathFromRecord && oldPathFromNext);

  return {
    consumedNext,
    entry: filePath
      ? buildGitStatusEntry({
        path: filePath,
        oldPath: oldPathFromNext,
        staged: xy[0] || " ",
        unstaged: xy[1] || " ",
      })
      : null,
  };
}

function parseGitPorcelainV2UnmergedRecord(record) {
  const fields = splitGitPorcelainRecord(record, 10);
  if (fields.length < 11) return null;
  const xy = fields[1] || "UU";
  const filePath = fields[10];
  if (!filePath) return null;
  return buildGitStatusEntry({
    path: filePath,
    oldPath: null,
    staged: xy[0] || "U",
    unstaged: xy[1] || "U",
    conflict: true,
  });
}

function splitGitPorcelainRecord(record, fixedFieldCount) {
  const fields = [];
  let cursor = 0;

  for (let index = 0; index < fixedFieldCount; index += 1) {
    const nextSpace = record.indexOf(" ", cursor);
    if (nextSpace < 0) {
      fields.push(record.slice(cursor));
      return fields;
    }
    fields.push(record.slice(cursor, nextSpace));
    cursor = nextSpace + 1;
  }

  fields.push(record.slice(cursor));
  return fields;
}

function buildGitStatusEntry({ path: filePath, oldPath, staged, unstaged, conflict = false }) {
  const normalizedStaged = normalizeGitStatusCode(staged);
  const normalizedUnstaged = normalizeGitStatusCode(unstaged);
  return {
    path: filePath,
    oldPath: oldPath || null,
    staged: normalizedStaged,
    unstaged: normalizedUnstaged,
    status: conflict ? "conflict" : getGitStatusLabel(normalizedStaged ?? " ", normalizedUnstaged ?? " "),
    ...(conflict ? { conflict: true } : {}),
  };
}

function buildGitSourceControlSnapshot({ entries, branchName, syncTarget, currentBranch, headCommitId }) {
  const resourcesByGroup = new Map(GIT_RESOURCE_GROUPS.map((group) => [group.id, []]));

  for (const entry of entries) {
    for (const resource of buildGitSourceControlResourcesForEntry(entry)) {
      resourcesByGroup.get(resource.group)?.push(resource);
    }
  }

  const groups = GIT_RESOURCE_GROUPS
    .map((group) => ({
      ...group,
      resources: resourcesByGroup.get(group.id) ?? [],
    }))
    .filter((group) => group.resources.length > 0 || group.id === "index" || group.id === "workingTree");
  const stagedCount = resourcesByGroup.get("index")?.length ?? 0;
  const workingCount = (resourcesByGroup.get("workingTree")?.length ?? 0) + (resourcesByGroup.get("untracked")?.length ?? 0);
  const mergeCount = resourcesByGroup.get("merge")?.length ?? 0;

  return {
    input: {
      placeholder: branchName && branchName !== "detached"
        ? `Message (⌘↩ to commit on ${branchName})`
        : "Message (⌘↩ to commit)",
      defaultMessage: buildDefaultCommitMessageFromResources(resourcesByGroup.get("index") ?? []),
    },
    groups,
    remote: buildGitSourceControlRemoteSummary({ branchName, syncTarget, currentBranch, headCommitId }),
    actions: {
      canStageAll: workingCount > 0 || mergeCount > 0,
      canUnstageAll: stagedCount > 0,
      canDiscardAll: workingCount > 0 || mergeCount > 0,
      canCommit: stagedCount > 0 && mergeCount === 0,
    },
  };
}

function buildGitSourceControlResourcesForEntry(entry) {
  if (entry.conflict || entry.status === "conflict" || isConflictStatus(entry.staged, entry.unstaged)) {
    return [buildGitSourceControlResource(entry, "merge", "conflict")];
  }

  const resources = [];
  if (entry.status === "untracked") {
    resources.push(buildGitSourceControlResource(entry, "untracked", "untracked"));
    return resources;
  }

  const stagedStatus = gitStatusCodeToLabel(entry.staged);
  if (stagedStatus) {
    resources.push(buildGitSourceControlResource(entry, "index", stagedStatus));
  }

  const unstagedStatus = gitStatusCodeToLabel(entry.unstaged);
  if (unstagedStatus) {
    resources.push(buildGitSourceControlResource(entry, "workingTree", unstagedStatus));
  }

  return resources;
}

function buildGitSourceControlResource(entry, group, status) {
  return {
    id: `${group}:${entry.oldPath ?? ""}:${entry.path}:${status}`,
    group,
    path: entry.path,
    oldPath: entry.oldPath ?? null,
    status,
    staged: group === "index",
    conflict: group === "merge",
    letter: gitStatusLabelToLetter(status),
  };
}

function buildGitSourceControlRemoteSummary({ branchName, syncTarget, currentBranch, headCommitId }) {
  const ahead = syncTarget?.ahead ?? currentBranch?.ahead ?? 0;
  const behind = syncTarget?.behind ?? currentBranch?.behind ?? 0;
  const hasBranch = Boolean(branchName && branchName !== "detached");
  const hasTarget = Boolean(syncTarget?.remote && syncTarget?.branch);
  const remoteExists = syncTarget?.exists === true;
  const upstream = currentBranch?.upstream ?? syncTarget?.ref ?? null;
  const canPublish = hasBranch && hasTarget && !remoteExists && Boolean(headCommitId);
  const canPull = remoteExists && behind > 0;
  const canPush = remoteExists && ahead > 0;
  const canSync = canPublish || (remoteExists && (ahead > 0 || behind > 0));

  let state = "synced";
  if (branchName == null && !headCommitId && !syncTarget) {
    state = "no-repository";
  } else if (!hasBranch) {
    state = "no-branch";
  } else if (!hasTarget) {
    state = "no-remote";
  } else if (!remoteExists) {
    state = "publish";
  } else if (ahead > 0 && behind > 0) {
    state = "diverged";
  } else if (behind > 0) {
    state = "incoming";
  } else if (ahead > 0) {
    state = "outgoing";
  }

  return {
    target: syncTarget,
    currentBranch: branchName ?? null,
    upstream,
    ahead,
    behind,
    incomingPreview: syncTarget?.incomingPreview ?? [],
    outgoingPreview: syncTarget?.outgoingPreview ?? [],
    canPull,
    canPush,
    canSync,
    canPublish,
    state,
  };
}

function buildDefaultCommitMessageFromResources(resources) {
  if (resources.length === 1) {
    return `Update ${path.basename(resources[0].path) || resources[0].path}`;
  }
  if (resources.length > 1) return `Update ${resources.length} files`;
  return "Update workspace";
}

function getDiscardableResources(sourceControl) {
  return (sourceControl?.groups ?? [])
    .filter((group) => group.id === "workingTree" || group.id === "untracked" || group.id === "merge")
    .flatMap((group) => group.resources);
}

function getResourceGitPaths(resource) {
  return resource.oldPath && resource.oldPath !== resource.path
    ? [resource.oldPath, resource.path]
    : [resource.path];
}

function uniqueGitPaths(paths) {
  return [...new Set(paths.map((value) => normalizeRelativePath(value)).filter(Boolean))];
}

function isConflictStatus(staged, unstaged) {
  const code = `${staged ?? " "}${unstaged ?? " "}`;
  return code.includes("U") || ["DD", "AA"].includes(code);
}

function normalizeGitStatusCode(code) {
  if (!code || code === " " || code === ".") return null;
  return code.trim() || null;
}

function gitStatusCodeToLabel(code) {
  if (!code || code === " " || code === "." || code === "?") return null;
  if (code === "M") return "modified";
  if (code === "A") return "added";
  if (code === "D") return "deleted";
  if (code === "R") return "renamed";
  if (code === "C") return "copied";
  if (code === "U") return "conflict";
  return "changed";
}

function gitStatusLabelToLetter(status) {
  if (status === "untracked") return "U";
  if (status === "added") return "A";
  if (status === "deleted") return "D";
  if (status === "renamed") return "R";
  if (status === "copied") return "C";
  if (status === "conflict") return "!";
  return "M";
}

function hasStagedStatus(entry) {
  return Boolean(entry.staged && entry.staged !== "?" && entry.staged !== ".");
}

function hasUnstagedStatus(entry) {
  return entry.status !== "untracked" && Boolean(entry.unstaged && entry.unstaged !== "?" && entry.unstaged !== ".");
}

function getGitStatusLabel(staged, unstaged) {
  const code = `${staged}${unstaged}`;
  if (code.includes("?")) return "untracked";
  if (code.includes("A")) return "added";
  if (code.includes("D")) return "deleted";
  if (code.includes("R")) return "renamed";
  if (code.includes("M")) return "modified";
  return "changed";
}
