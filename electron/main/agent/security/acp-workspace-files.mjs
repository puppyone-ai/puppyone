import fs from "node:fs";
import path from "node:path";

const MAX_TEXT_FILE_BYTES = 4 * 1024 * 1024;
const MAX_LINE_WINDOW = 100_000;

/**
 * Main-process ACP file delegate with a canonical workspace boundary.
 *
 * Some ACP agents ask the client to perform text reads/writes. Absolute paths,
 * symlinks and newly-created parent directories all remain constrained to the
 * workspace selected by trusted IPC. Reads may additionally use exact files
 * or directory scopes explicitly referenced in the current turn; writes may not.
 */
export function createAcpWorkspaceFileSystem({ workspaceRoot, fsModule = fs, getReadReferences = () => [] }) {
  let canonicalRootPromise = null;
  const canonicalRoot = () => {
    canonicalRootPromise ??= fsModule.promises.realpath(path.resolve(workspaceRoot));
    return canonicalRootPromise;
  };

  async function readTextFile(request) {
    const root = await canonicalRoot();
    const target = await canonicalExistingFile(root, request?.path, fsModule, getReadReferences());
    const flags = fsModule.constants.O_RDONLY | (fsModule.constants.O_NOFOLLOW ?? 0);
    const handle = await fsModule.promises.open(target, flags);
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile()) throw new Error("ACP can only read regular workspace files.");
      if (metadata.size > MAX_TEXT_FILE_BYTES) throw new Error("ACP text file exceeds the 4 MB safety limit.");
      const content = await handle.readFile("utf8");
      if (content.includes("\0")) throw new Error("ACP cannot read a binary file through the text-file delegate.");
      const start = boundedInteger(request?.line, 1, Number.MAX_SAFE_INTEGER, 1) - 1;
      const limit = boundedInteger(request?.limit, 0, MAX_LINE_WINDOW, 0);
      if (request?.line === undefined && request?.limit === undefined) return { content };
      const lines = content.split(/\r?\n/u);
      return { content: lines.slice(start, limit > 0 ? start + limit : lines.length).join("\n") };
    } finally {
      await handle.close();
    }
  }

  async function writeTextFile(request) {
    const content = typeof request?.content === "string" ? request.content : null;
    if (content === null) throw new Error("ACP text-file writes require text content.");
    if (Buffer.byteLength(content, "utf8") > MAX_TEXT_FILE_BYTES) {
      throw new Error("ACP text-file write exceeds the 4 MB safety limit.");
    }
    const root = await canonicalRoot();
    const target = resolveWorkspacePath(root, request?.path);
    await ensureCanonicalParent(root, path.dirname(target), fsModule);
    let targetMetadata = null;
    try {
      targetMetadata = await fsModule.promises.lstat(target);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (targetMetadata?.isSymbolicLink()) throw new Error("ACP cannot write through a symbolic link.");
    if (targetMetadata && !targetMetadata.isFile()) throw new Error("ACP can only write regular workspace files.");
    const flags = fsModule.constants.O_WRONLY
      | fsModule.constants.O_CREAT
      | (fsModule.constants.O_NOFOLLOW ?? 0);
    const handle = await fsModule.promises.open(target, flags, 0o600);
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile()) throw new Error("ACP write target changed during authorization.");
      if (targetMetadata && !sameFileIdentity(targetMetadata, metadata)) {
        throw new Error("ACP write target changed during authorization.");
      }
      const canonicalTarget = await fsModule.promises.realpath(target);
      assertInside(root, canonicalTarget);
      // Do not truncate until the opened descriptor has been verified. This
      // prevents a parent/symlink swap from destroying an external file on
      // platforms where O_NOFOLLOW is unavailable or incomplete.
      await handle.truncate(0);
      await handle.writeFile(content, "utf8");
    } finally {
      await handle.close();
    }
    return {};
  }

  return { readTextFile, writeTextFile };
}

function sameFileIdentity(expected, actual) {
  if (!expected || !actual) return false;
  if (Number.isFinite(expected.dev) && Number.isFinite(expected.ino)
    && Number.isFinite(actual.dev) && Number.isFinite(actual.ino)) {
    return expected.dev === actual.dev && expected.ino === actual.ino;
  }
  return expected.size === actual.size
    && Math.trunc(expected.mtimeMs) === Math.trunc(actual.mtimeMs);
}

async function canonicalExistingFile(root, rawPath, fsModule, references) {
  if (typeof rawPath !== "string" || !rawPath || rawPath.length > 4_096) throw new Error("ACP workspace path is invalid.");
  const target = path.resolve(root, rawPath);
  const canonical = await fsModule.promises.realpath(target).catch(() => {
    throw new Error("ACP workspace file does not exist.");
  });
  if (!isInside(root, canonical)) {
    const granted = references.some((reference) => {
      if (reference?.authorized !== true || reference.kind !== "workspace-entry"
        || typeof reference.authorizedWorkspaceRoot !== "string" || typeof reference.path !== "string") return false;
      if (!isInside(reference.authorizedWorkspaceRoot, canonical)) return false;
      return reference.entryType === "directory" ? isInside(reference.path, canonical) : reference.path === canonical;
    });
    if (!granted) throw new Error("ACP file access must stay inside the authorized workspace or a referenced read scope.");
  }
  return canonical;
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function ensureCanonicalParent(root, parent, fsModule) {
  assertInside(root, parent);
  const relative = path.relative(root, parent);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let metadata;
    try {
      metadata = await fsModule.promises.lstat(current);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await fsModule.promises.mkdir(current, { mode: 0o700 });
      metadata = await fsModule.promises.lstat(current);
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error("ACP write parent must remain a real workspace directory.");
    }
    const canonical = await fsModule.promises.realpath(current);
    assertInside(root, canonical);
  }
}

function resolveWorkspacePath(root, rawPath) {
  if (typeof rawPath !== "string" || !rawPath || rawPath.length > 4_096) {
    throw new Error("ACP workspace path is invalid.");
  }
  const target = path.resolve(path.isAbsolute(rawPath) ? rawPath : path.join(root, rawPath));
  assertInside(root, target);
  return target;
}

function assertInside(root, target) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("ACP file access must stay inside the authorized workspace.");
  }
}

function boundedInteger(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

export const acpWorkspaceFilePolicy = Object.freeze({
  maxTextFileBytes: MAX_TEXT_FILE_BYTES,
  maxLineWindow: MAX_LINE_WINDOW,
});
