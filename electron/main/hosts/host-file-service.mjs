import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { normalizeRelativePath, resolveExistingWorkspacePath, isSameOrInsidePath } from "../../local-api/files/path-policy.mjs";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 10_000;

export class HostFileError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function relativePath(value, { root = false } = {}) {
  if (typeof value !== "string" || value.includes("\\") || value.includes("\0") || value.startsWith("/") ||
      value.split("/").some((part) => part === ".." || part === "." || part.toLowerCase() === ".git")) {
    throw new HostFileError("invalid_path");
  }
  const normalized = normalizeRelativePath(value);
  if (!root && !normalized) throw new HostFileError("invalid_path");
  return normalized;
}

const revision = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

/**
 * A root-closed service. `resolveFolder` must load the CURRENT local registration
 * and revocation state on every call; a transport-supplied root is never accepted.
 * This is deliberately not a shell, Git or general local workspace IPC bridge.
 */
export function createHostFileService({ resolveFolder }) {
  const writes = new Map();
  async function serializeWrite(key, operation) {
    const previous = writes.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    writes.set(key, current);
    try { return await current; }
    finally { if (writes.get(key) === current) writes.delete(key); }
  }

  async function admit(folderId, action) {
    const folder = await resolveFolder(folderId);
    if (!folder || folder.state !== "active" || !folder.rootPath ||
        !folder.capabilities?.includes(action === "read" || action === "list" ? "folder.read" : "folder.write")) {
      throw new HostFileError("folder_unavailable");
    }
    const rootPath = await fs.realpath(folder.rootPath);
    if (rootPath !== folder.rootPath) throw new HostFileError("root_changed");
    return rootPath;
  }

  async function entry(rootPath, name) {
    const location = await resolveExistingWorkspacePath(rootPath, name);
    if (!isSameOrInsidePath(rootPath, location)) throw new HostFileError("invalid_path");
    return location;
  }

  return Object.freeze({
    async list(folderId, requested = "") {
      const rootPath = await admit(folderId, "list");
      const name = relativePath(requested, { root: true });
      const location = await entry(rootPath, name);
      const items = await fs.readdir(location, { withFileTypes: true });
      if (items.length > MAX_ENTRIES) throw new HostFileError("too_many_entries");
      return items.filter((item) => item.name.toLowerCase() !== ".git" && !item.isSymbolicLink() &&
        (item.isFile() || item.isDirectory())).map((item) => ({ name: item.name, type: item.isDirectory() ? "folder" : "file" }));
    },
    async read(folderId, requested) {
      const rootPath = await admit(folderId, "read");
      const location = await entry(rootPath, relativePath(requested));
      const handle = await fs.open(location, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > MAX_BYTES) throw new HostFileError("unsupported_file");
        const bytes = await handle.readFile();
        if (bytes.length > MAX_BYTES) throw new HostFileError("unsupported_file");
        return { content_base64: bytes.toString("base64"), revision: revision(bytes) };
      } finally { await handle.close(); }
    },
    async write(folderId, requested, contentBase64, expectedRevision) {
      const rootPath = await admit(folderId, "write");
      const name = relativePath(requested);
      if (typeof contentBase64 !== "string" || contentBase64.length > Math.ceil(MAX_BYTES / 3) * 4 + 4 ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(contentBase64)) {
        throw new HostFileError("invalid_content");
      }
      const bytes = Buffer.from(contentBase64, "base64");
      if (bytes.length > MAX_BYTES || bytes.toString("base64") !== contentBase64) throw new HostFileError("invalid_content");
      if (typeof expectedRevision !== "string" || !/^[a-f0-9]{64}$/.test(expectedRevision)) {
        throw new HostFileError("revision_required");
      }
      return serializeWrite(`${folderId}:${name}`, async () => {
        const location = await entry(rootPath, name);
        const info = await fs.lstat(location);
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > MAX_BYTES) {
          throw new HostFileError("unsupported_file");
        }
        const current = await fs.readFile(location);
        if (current.length > MAX_BYTES) throw new HostFileError("unsupported_file");
        if (revision(current) !== expectedRevision) throw new HostFileError("conflict");
        const temp = path.join(path.dirname(location), `.puppyone-write-${crypto.randomUUID()}`);
        let handle;
        try {
          handle = await fs.open(temp, "wx", info.mode & 0o777);
          await handle.writeFile(bytes);
          await handle.sync();
          await handle.close(); handle = undefined;
          // The local user may also edit the file. Never silently overwrite that edit.
          const latest = await entry(rootPath, name);
          if (latest !== location || revision(await fs.readFile(latest)) !== expectedRevision) {
            throw new HostFileError("conflict");
          }
          await fs.rename(temp, location);
          return { revision: revision(bytes) };
        } finally {
          await handle?.close();
          await fs.unlink(temp).catch((error) => { if (error.code !== "ENOENT") throw error; });
        }
      });
    },
  });
}
