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
const GIT_MAX_BUFFER = 1024 * 1024 * 4;
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
    execGit(root, ["status", "--short"]).catch((error) => {
      throw new Error(`Unable to read git status: ${error.message}`);
    }),
    readGitBranches(root),
    readGitRemotes(root),
    readGitHistory(root, GIT_HISTORY_LIMIT),
    readGitHistory(root, GIT_HISTORY_LIMIT, { allBranches: true }),
  ]);
  const entries = statusResult.stdout
    .split(/\r?\n/)
    .map(parseGitStatusLine)
    .filter(Boolean);

  return {
    isRepo: true,
    branch: branchResult.stdout.trim() || symbolicBranchResult.stdout.trim() || "detached",
    headCommitId: headResult.stdout.trim() || null,
    totalCommits: Number.parseInt(countResult.stdout.trim(), 10) || commits.length,
    entries,
    stagedEntries: entries.filter(hasStagedStatus),
    unstagedEntries: entries.filter(hasUnstagedStatus),
    untrackedEntries: entries.filter((entry) => entry.status === "untracked"),
    branches,
    remotes: remotes.map((remote) => ({
      ...remote,
      branches: branches
        .filter((branch) => branch.remote && branch.name.startsWith(`${remote.name}/`))
        .map((branch) => branch.name),
    })),
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
  const normalizedPaths = normalizeGitPathList(paths, { allowEmpty: true });
  const args = normalizedPaths.length > 0 ? ["add", "--", ...normalizedPaths] : ["add", "--all"];
  await execGit(root, args).catch((error) => {
    throw new Error(`Unable to stage changes: ${error.message}`);
  });
  return getWorkspaceGitStatus(root);
}

export async function unstageWorkspaceGitPaths(rootPath, paths) {
  const root = resolveWorkspacePath(rootPath, null);
  const normalizedPaths = normalizeGitPathList(paths, { allowEmpty: true });
  const pathArgs = normalizedPaths.length > 0 ? normalizedPaths : ["."];
  await execGit(root, ["restore", "--staged", "--", ...pathArgs]).catch(async () => {
    await execGit(root, ["reset", "HEAD", "--", ...pathArgs]);
  }).catch((error) => {
    throw new Error(`Unable to unstage changes: ${error.message}`);
  });
  return getWorkspaceGitStatus(root);
}

export async function discardWorkspaceGitPaths(rootPath, paths) {
  const root = resolveWorkspacePath(rootPath, null);
  const normalizedPaths = normalizeGitPathList(paths);
  const status = await getWorkspaceGitStatus(root);
  const entriesByPath = new Map(status.entries.map((entry) => [entry.path, entry]));
  const trackedPaths = [];

  for (const relativePath of normalizedPaths) {
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

export async function commitWorkspaceGit(rootPath, message) {
  const root = resolveWorkspacePath(rootPath, null);
  const normalizedMessage = normalizeCommitMessage(message);
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
  await execGit(root, ["fetch", "--all", "--prune"]).catch((error) => {
    throw new Error(`Unable to fetch remotes: ${error.message}`);
  });
  return getWorkspaceGitStatus(root);
}

export async function pullWorkspaceGit(rootPath) {
  const root = resolveWorkspacePath(rootPath, null);
  await execGit(root, ["pull", "--ff-only"]).catch((error) => {
    throw new Error(`Unable to pull changes: ${error.message}`);
  });
  return getWorkspaceGitStatus(root);
}

export async function pushWorkspaceGit(rootPath) {
  const root = resolveWorkspacePath(rootPath, null);
  await execGit(root, ["push"]).catch((error) => {
    throw new Error(`Unable to push changes: ${error.message}`);
  });
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

function execGit(rootPath, args) {
  return execFileAsync("git", ["-C", rootPath, "-c", "core.quotePath=false", ...args], {
    timeout: 5000,
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

async function readGitHistory(rootPath, limit, options = {}) {
  const baseArgs = [
    "log",
    ...(options.allBranches ? ["--all"] : []),
    "-n",
    String(limit),
    "--date=iso-strict",
    "--pretty=format:%x1e%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%s",
  ];

  const [statusResult, statsResult] = await Promise.all([
    execGit(rootPath, [
      ...baseArgs,
      "--name-status",
    ]).catch(() => ({ stdout: "" })),
    execGit(rootPath, [
      ...baseArgs,
      "--numstat",
    ]).catch(() => ({ stdout: "" })),
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
      changes: mergeGitChangeStats(commit.changes, statsByCommit.get(commit.commit_id) ?? []),
    }));
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

function normalizeCommitMessage(message) {
  if (typeof message !== "string") {
    throw new Error("Commit message is required.");
  }
  const normalized = message.trim();
  if (!normalized) throw new Error("Commit message is required.");
  return normalized;
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

function parseGitStatusLine(line) {
  if (!line.trim()) return null;
  const staged = line[0] || " ";
  const unstaged = line[1] || " ";
  const pathText = line.slice(3).trim();
  if (!pathText) return null;
  const renameIndex = pathText.indexOf(" -> ");
  const oldPath = renameIndex >= 0 ? pathText.slice(0, renameIndex) : null;
  const nextPath = renameIndex >= 0 ? pathText.slice(renameIndex + " -> ".length) : pathText;

  return {
    path: nextPath,
    oldPath,
    staged: staged.trim() || null,
    unstaged: unstaged.trim() || null,
    status: getGitStatusLabel(staged, unstaged),
  };
}

function hasStagedStatus(entry) {
  return Boolean(entry.staged && entry.staged !== "?");
}

function hasUnstagedStatus(entry) {
  return entry.status !== "untracked" && Boolean(entry.unstaged && entry.unstaged !== "?");
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
