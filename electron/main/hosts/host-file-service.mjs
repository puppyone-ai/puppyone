import crypto from "node:crypto";
import fs from "node:fs/promises";
import { watch as watchPath, constants } from "node:fs";
import path from "node:path";
import { normalizeRelativePath, resolveExistingWorkspacePath, isSameOrInsidePath } from "../../local-api/files/path-policy.mjs";

/** Host file protocol v1 (`puppyone-cloud/contracts/host-file-protocol-v1.json`). */
export const MAX_BYTES = 8 * 1024 * 1024;
export const MAX_ENTRIES = 10_000;
const MAX_EVENT_PATHS = 256;
const COALESCE_MS = 100;
const TEMP_PREFIX = ".puppyone-write-";

export class HostFileError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function relativePath(value, { root = false } = {}) {
  if (typeof value !== "string" || value.length > 4096 || value.includes("\\") || value.includes("\0") ||
      value.startsWith("/") ||
      value.split("/").some((part) => part === ".." || part === "." || part.toLowerCase() === ".git")) {
    throw new HostFileError("invalid_path");
  }
  let normalized;
  try { normalized = normalizeRelativePath(value); } catch { throw new HostFileError("invalid_path"); }
  if (!root && !normalized) throw new HostFileError("invalid_path");
  return normalized;
}

const revision = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const split = (name) => {
  const slash = name.lastIndexOf("/");
  return { parent: slash < 0 ? "" : name.slice(0, slash), base: name.slice(slash + 1) };
};
const describe = (name, info) => ({ name, kind: info.isDirectory() ? "directory" : "file",
  size: Number(info.size), modified_ns: String(info.mtimeNs ?? BigInt(Math.trunc(info.mtimeMs * 1e6))) });

function decodeContent(contentBase64) {
  if (typeof contentBase64 !== "string" || contentBase64.length > Math.ceil(MAX_BYTES / 3) * 4 + 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(contentBase64)) {
    throw new HostFileError("invalid_content");
  }
  const bytes = Buffer.from(contentBase64, "base64");
  if (bytes.length > MAX_BYTES || bytes.toString("base64") !== contentBase64) throw new HostFileError("invalid_content");
  return bytes;
}

function fileErrorCode(error) {
  if (error instanceof HostFileError) return error.code;
  return { ENOENT: "not_found", ENOTDIR: "not_found", EEXIST: "already_exists", ENOTEMPTY: "not_empty",
    ELOOP: "invalid_path" }[error?.code] ?? "file_operation_failed";
}

/**
 * A root-closed service. `resolveFolder` must load the CURRENT local registration
 * and revocation state on every call; a transport-supplied root is never accepted.
 * This is deliberately not a shell, Git or general local workspace IPC bridge.
 */
export function createHostFileService({ resolveFolder, platform = process.platform,
  /** Test seam: runs between a path check and the filesystem call it guards. */
  beforeIo = async () => {} }) {
  const writes = new Map();
  async function serialize(key, operation) {
    const previous = writes.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    writes.set(key, current);
    try { return await current; }
    finally { if (writes.get(key) === current) writes.delete(key); }
  }

  async function admit(folderId, capability) {
    const folder = await resolveFolder(folderId);
    if (!folder || folder.state !== "active" || !folder.rootPath || !folder.capabilities?.includes(capability)) {
      throw new HostFileError("folder_unavailable");
    }
    const rootPath = await fs.realpath(folder.rootPath).catch(() => { throw new HostFileError("root_changed"); });
    if (rootPath !== folder.rootPath) throw new HostFileError("root_changed");
    return rootPath;
  }

  async function entry(rootPath, name) {
    let location;
    try {
      location = await resolveExistingWorkspacePath(rootPath, name);
    } catch {
      throw new HostFileError(await missingInside(rootPath, name) ? "not_found" : "invalid_path");
    }
    if (!isSameOrInsidePath(rootPath, location)) throw new HostFileError("invalid_path");
    return location;
  }

  // "Not found" only when the parent itself resolves inside the root. A missing
  // name behind a symlinked or escaping parent stays an invalid path, so the
  // response never reveals what exists outside the registered folder.
  async function missingInside(rootPath, name) {
    const { parent, base } = split(name);
    const directory = await resolveExistingWorkspacePath(rootPath, parent).catch(() => null);
    if (!directory || !isSameOrInsidePath(rootPath, directory)) return false;
    return fs.lstat(path.join(directory, base)).then(() => false, (error) => error?.code === "ENOENT");
  }

  /** A not-yet-existing name whose parent directory resolves inside the root. */
  async function newEntry(rootPath, name) {
    const { parent, base } = split(name);
    const directory = await entry(rootPath, parent);
    if (!(await fs.lstat(directory)).isDirectory()) throw new HostFileError("not_found");
    return path.join(directory, base);
  }

  /**
   * Path races: Node has no openat(), so every operation resolves a canonical
   * path, acts on it, and then proves the path still resolves to the same place
   * inside the root. A directory swapped for a symlink between the check and the
   * act (only possible for a process already running on this computer) makes the
   * operation fail instead of reaching outside the registered folder.
   */
  async function stillAt(rootPath, location) {
    const current = await fs.realpath(location).catch(() => null);
    if (current !== location || !isSameOrInsidePath(rootPath, current)) throw new HostFileError("invalid_path");
  }

  async function readBounded(rootPath, location) {
    const expected = await fs.lstat(location, { bigint: true });
    await beforeIo("read", location);
    const handle = await fs.open(location, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await handle.stat({ bigint: true });
      if (before.dev !== expected.dev || before.ino !== expected.ino) throw new HostFileError("invalid_path");
      if (!before.isFile() || before.size > BigInt(MAX_BYTES)) throw new HostFileError("unsupported_file");
      const bytes = await handle.readFile();
      const after = await handle.stat({ bigint: true });
      if (bytes.length > MAX_BYTES) throw new HostFileError("unsupported_file");
      if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) {
        throw new HostFileError("conflict");
      }
      // Bytes read through a parent that moved since the check are never returned.
      await stillAt(rootPath, location);
      return { bytes, info: after };
    } finally { await handle.close(); }
  }

  async function removeTree(rootPath, location, budget) {
    const info = await fs.lstat(location);
    if (--budget.left < 0) throw new HostFileError("too_many_entries");
    if (info.isDirectory()) {
      await stillAt(rootPath, location);
      await beforeIo("remove", location);
      const children = await fs.readdir(location);
      // readdir follows a swapped-in symlink; prove the listing came from here.
      await stillAt(rootPath, location);
      const now = await fs.lstat(location);
      if (now.ino !== info.ino || now.dev !== info.dev) throw new HostFileError("invalid_path");
      for (const child of children) await removeTree(rootPath, path.join(location, child), budget);
      await fs.rmdir(location);
    } else {
      // unlink never follows a symlink; it removes the link itself.
      await stillAt(rootPath, path.dirname(location));
      await fs.unlink(location);
    }
  }

  const guarded = (operation) => async (...values) => {
    try { return await operation(...values); }
    catch (error) { throw error instanceof HostFileError ? error : new HostFileError(fileErrorCode(error)); }
  };

  const operations = {
    async list(folderId, requested = "") {
      const rootPath = await admit(folderId, "folder.read");
      const location = await entry(rootPath, relativePath(requested, { root: true }));
      await beforeIo("list", location);
      const items = await fs.readdir(location, { withFileTypes: true });
      await stillAt(rootPath, location);
      if (items.length > MAX_ENTRIES) throw new HostFileError("too_many_entries");
      const entries = [];
      for (const item of items) {
        if (item.name.toLowerCase() === ".git" || item.name.startsWith(TEMP_PREFIX) || item.isSymbolicLink() ||
            !(item.isFile() || item.isDirectory())) continue;
        const info = await fs.lstat(path.join(location, item.name), { bigint: true }).catch(() => null);
        if (info && (info.isFile() || info.isDirectory())) entries.push(describe(item.name, info));
      }
      // Directories first, then by code point (the same order on every host).
      const rank = (entry) => (entry.kind === "directory" ? 0 : 1);
      entries.sort((left, right) => rank(left) - rank(right) || Number(left.name > right.name) - Number(left.name < right.name));
      return { entries };
    },
    async read(folderId, requested) {
      const rootPath = await admit(folderId, "folder.read");
      const name = relativePath(requested);
      const { bytes, info } = await readBounded(rootPath, await entry(rootPath, name));
      return { ...describe(split(name).base, info), content_base64: bytes.toString("base64"), revision: revision(bytes) };
    },
    async write(folderId, requested, contentBase64, expectedRevision) {
      const rootPath = await admit(folderId, "folder.write");
      const name = relativePath(requested);
      const bytes = decodeContent(contentBase64);
      if (expectedRevision !== null && (typeof expectedRevision !== "string" || !/^[a-f0-9]{64}$/.test(expectedRevision))) {
        throw new HostFileError("revision_required");
      }
      return serialize(`${folderId}:${name}`, async () => {
        const creating = expectedRevision === null;
        let location;
        let mode = 0o644;
        if (creating) {
          location = await newEntry(rootPath, name);
        } else {
          location = await entry(rootPath, name);
          const info = await fs.lstat(location);
          if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > MAX_BYTES) {
            throw new HostFileError("unsupported_file");
          }
          mode = info.mode & 0o777;
          if (revision((await readBounded(rootPath, location)).bytes) !== expectedRevision) throw new HostFileError("conflict");
        }
        const temp = path.join(path.dirname(location), `${TEMP_PREFIX}${crypto.randomUUID()}`);
        let handle;
        try {
          handle = await fs.open(temp, "wx", mode);
          await handle.writeFile(bytes);
          await handle.sync();
          await handle.close(); handle = undefined;
          // The temporary file and its final name share a directory that must not have moved.
          await beforeIo("write", location);
          await stillAt(rootPath, path.dirname(location));
          if (creating) {
            // No-clobber creation: link fails if anything appeared at the name.
            await fs.link(temp, location).catch((error) => {
              throw new HostFileError(error?.code === "EEXIST" ? "conflict" : fileErrorCode(error));
            });
          } else {
            // The local user may also edit the file. Never silently overwrite that edit.
            const latest = await entry(rootPath, name);
            if (latest !== location || revision((await readBounded(rootPath, latest)).bytes) !== expectedRevision) {
              throw new HostFileError("conflict");
            }
            await fs.rename(temp, location);
          }
          return { revision: revision(bytes), size: bytes.length };
        } finally {
          await handle?.close();
          await fs.unlink(temp).catch((error) => { if (error.code !== "ENOENT") throw error; });
        }
      });
    },
    async mkdir(folderId, requested) {
      const rootPath = await admit(folderId, "folder.write");
      const location = await newEntry(rootPath, relativePath(requested));
      await beforeIo("mkdir", location);
      await stillAt(rootPath, path.dirname(location));
      await fs.mkdir(location, { mode: 0o755 });
      return {};
    },
    async move(folderId, requested, destination) {
      const rootPath = await admit(folderId, "folder.write");
      const from = relativePath(requested);
      const to = relativePath(destination);
      if (to === from || to.startsWith(`${from}/`)) throw new HostFileError("invalid_path");
      return serialize(`${folderId}:${from}`, async () => {
        const source = await entry(rootPath, from);
        const target = await newEntry(rootPath, to);
        const info = await fs.lstat(source);
        await beforeIo("move", source);
        await stillAt(rootPath, path.dirname(source));
        await stillAt(rootPath, path.dirname(target));
        if (info.isFile()) {
          // A hard link refuses an existing target, so a move never overwrites.
          await fs.link(source, target);
          await fs.unlink(source);
        } else if (info.isDirectory()) {
          if (await fs.lstat(target).then(() => true, () => false)) throw new HostFileError("already_exists");
          await fs.rename(source, target);
        } else throw new HostFileError("unsupported_file");
        return {};
      });
    },
    async remove(folderId, requested) {
      const rootPath = await admit(folderId, "folder.write");
      const name = relativePath(requested);
      return serialize(`${folderId}:${name}`, async () => {
        const location = await entry(rootPath, name);
        if (location === rootPath) throw new HostFileError("invalid_path");
        await removeTree(rootPath, location, { left: MAX_ENTRIES });
        return {};
      });
    },
  };

  /**
   * Coalesced change notifications for one registered folder. `onEvent` receives
   * `{paths, reset}`; a reset means "rescan". Returns a stop function.
   */
  async function watch(folderId, onEvent) {
    const rootPath = await admit(folderId, "folder.read");
    const changed = new Set();
    let reset = false;
    let timer = null;
    let stopped = false;
    const watchers = new Map();
    const flush = () => {
      timer = null;
      if (stopped) return;
      const paths = [...changed];
      changed.clear();
      if (reset || paths.length > MAX_EVENT_PATHS) { reset = false; onEvent({ paths: [], reset: true }); }
      else if (paths.length) onEvent({ paths, reset: false });
    };
    const record = (relative) => {
      if (stopped) return;
      const name = relative ? String(relative).split(path.sep).join("/") : "";
      const parts = name.split("/");
      if (parts.some((part) => part.toLowerCase() === ".git") || parts.at(-1)?.startsWith(TEMP_PREFIX)) return;
      if (!name || changed.size >= MAX_EVENT_PATHS) reset = true; else changed.add(name);
      timer ??= setTimeout(flush, COALESCE_MS);
    };
    const failed = () => { reset = true; timer ??= setTimeout(flush, COALESCE_MS); if (platform === "linux") rescan(); };
    // Linux recursive fs.watch keeps stale inode watches after atomic saves; watch
    // each directory instead. macOS (FSEvents) and Windows watch the tree natively.
    const rescan = () => {
      if (platform !== "linux" || stopped) return;
      const seen = new Set();
      const visit = async (directory, relative) => {
        const info = await fs.lstat(directory).catch(() => null);
        if (!info?.isDirectory() || info.isSymbolicLink()) return;
        seen.add(directory);
        if (!watchers.has(directory)) {
          const watcher = watchPath(directory, (event, name) => {
            record(name ? [relative, String(name)].filter(Boolean).join("/") : relative);
            if (event === "rename") void rescan();
          });
          watcher.on("error", failed);
          watchers.set(directory, watcher);
        }
        for (const child of await fs.readdir(directory, { withFileTypes: true }).catch(() => [])) {
          if (child.isDirectory() && child.name.toLowerCase() !== ".git") {
            await visit(path.join(directory, child.name), relative ? `${relative}/${child.name}` : child.name);
          }
        }
      };
      return visit(rootPath, "").then(() => {
        for (const [directory, watcher] of watchers) if (!seen.has(directory)) { watcher.close(); watchers.delete(directory); }
      });
    };
    if (platform === "linux") await rescan();
    else {
      const watcher = watchPath(rootPath, { recursive: true }, (_event, name) => record(name));
      watcher.on("error", failed);
      watchers.set(rootPath, watcher);
    }
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    };
  }

  const api = {
    list: guarded(operations.list),
    read: guarded(operations.read),
    write: guarded(operations.write),
    mkdir: guarded(operations.mkdir),
    move: guarded(operations.move),
    remove: guarded(operations.remove),
    watch: guarded(watch),
  };
  return Object.freeze({ ...api, run: (request) => runHostFileOperation(api, request) });
}

/** Dispatch one protocol request frame to the service. Unknown actions fail closed. */
export function runHostFileOperation(service, request) {
  const { action, folder_id: folderId } = request ?? {};
  if (action === "list") return service.list(folderId, typeof request.path === "string" ? request.path : "");
  if (typeof request?.path !== "string") return Promise.reject(new HostFileError("invalid_path"));
  if (action === "read") return service.read(folderId, request.path);
  if (action === "write") {
    if (!("expected_revision" in request)) return Promise.reject(new HostFileError("revision_required"));
    return service.write(folderId, request.path, request.content_base64, request.expected_revision);
  }
  if (action === "mkdir") return service.mkdir(folderId, request.path);
  if (action === "move") return service.move(folderId, request.path, request.destination);
  if (action === "remove") return service.remove(folderId, request.path);
  return Promise.reject(new HostFileError("file_operation_failed"));
}
