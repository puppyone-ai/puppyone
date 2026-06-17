import fs from "node:fs/promises";
import path from "node:path";

const MAX_ENTRIES_PER_FOLDER = 500;
const MAX_PREVIEW_BYTES = 4096;

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
    commitCount: 0,
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

function joinRelativePath(parent, name) {
  return parent ? `${parent}/${name}` : name;
}

function classifyFile(name) {
  const extension = path.extname(name).slice(1).toLowerCase();
  switch (extension) {
    case "json":
    case "jsonl":
      return "json";
    case "md":
    case "mdx":
    case "markdown":
      return "markdown";
    case "jpg":
    case "jpeg":
    case "png":
    case "gif":
    case "webp":
    case "svg":
    case "avif":
    case "heic":
      return "image";
    case "pdf":
      return "pdf";
    case "mp4":
    case "mov":
    case "webm":
    case "avi":
    case "mkv":
      return "video";
    default:
      return "file";
  }
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
  const extension = path.extname(filePath).slice(1).toLowerCase();
  return new Set([
    "c",
    "cpp",
    "css",
    "go",
    "h",
    "html",
    "java",
    "js",
    "json",
    "jsonl",
    "jsx",
    "log",
    "md",
    "mdx",
    "py",
    "rb",
    "rs",
    "scss",
    "sh",
    "toml",
    "ts",
    "tsx",
    "txt",
    "xml",
    "yaml",
    "yml",
  ]).has(extension);
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
