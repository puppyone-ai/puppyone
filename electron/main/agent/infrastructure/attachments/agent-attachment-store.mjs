import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { agentContractLimits } from "../../../../../shared/agent-contract/constants.mjs";

const MAX_REFERENCES = agentContractLimits.maxReferenceCount;
const MAX_REFERENCE_BYTES = agentContractLimits.maxReferenceBytes;
const MAX_TOTAL_REFERENCE_BYTES = agentContractLimits.maxTotalReferenceBytes;
const DEFAULT_TTL_MS = 30 * 60_000;
const COPY_CHUNK_BYTES = 64 * 1024;

/** Main-owned, process-scoped immutable snapshots for external Agent inputs.
 * @param {{ rootPath: string, fsModule?: typeof fs, now?: () => number, ttlMs?: number }} [options]
 */
export function createAgentAttachmentStore({
  rootPath,
  fsModule = fs,
  now = () => Date.now(),
  ttlMs = DEFAULT_TTL_MS,
} = {}) {
  if (typeof rootPath !== "string" || !path.isAbsolute(rootPath)) {
    throw new TypeError("Agent attachment staging requires an absolute root path.");
  }
  const entries = new Map();
  const groups = new Map();
  const processDirectory = path.join(rootPath, `${process.pid}-${randomUUID()}`);
  let initialization = null;
  let sweepTimer = null;
  let closed = false;

  async function initialize() {
    if (initialization) return initialization;
    initialization = (async () => {
      await fsModule.promises.mkdir(rootPath, { recursive: true, mode: 0o700 });
      await fsModule.promises.chmod(rootPath, 0o700).catch(() => {});
      await sweepOrphanDirectories();
      await fsModule.promises.mkdir(processDirectory, { recursive: true, mode: 0o700 });
      await fsModule.promises.chmod(processDirectory, 0o700).catch(() => {});
      sweepTimer = setInterval(() => {
        void sweepExpired().catch(() => {});
      }, Math.min(60_000, Math.max(1_000, ttlMs)));
      sweepTimer.unref?.();
    })();
    return initialization;
  }

  async function stage({ ownerId, workspaceRoot, epoch, sourcePaths, sources }) {
    assertOpen();
    assertOwner(ownerId);
    assertWorkspace(workspaceRoot);
    assertOpaqueId(epoch, "reference epoch");
    if (sources !== undefined && sourcePaths !== undefined) throw new Error("Attachment sources are invalid.");
    const selected = sources ?? (Array.isArray(sourcePaths) ? sourcePaths.map((sourcePath) => ({ path: sourcePath })) : null);
    if (!Array.isArray(selected) || selected.length === 0 || selected.length > MAX_REFERENCES) {
      throw new Error("Select between 1 and 32 attachment files.");
    }
    // Copy inline bytes before the first await. Only these bytes are granted;
    // names/MIME supplied by the renderer never authorize a filesystem path.
    let inlineBytes = 0;
    const inputs = selected.map((input) => {
      if (input?.path !== undefined && input.bytes === undefined) return { path: input.path };
      if (input?.path !== undefined || !(input?.bytes instanceof Uint8Array)
        || typeof input.name !== "string" || !input.name || input.name.length > 512
        || /[\\/\u0000-\u001f\u007f]/.test(input.name)) throw new Error("The inline attachment is invalid.");
      if (input.bytes.byteLength === 0) throw new Error("The selected attachment is empty.");
      inlineBytes += input.bytes.byteLength;
      if (inlineBytes > MAX_TOTAL_REFERENCE_BYTES) throw new Error("Attachments exceed the 25 MB total safety limit.");
      return { name: input.name, bytes: Buffer.from(input.bytes) };
    });
    await initialize();
    await sweepExpired();
    const result = [];
    const createdEntries = [];
    try {
      for (const input of inputs) {
        const staged = await stageOne({ ownerId, workspaceRoot, epoch, input });
        result.push(staged.reference);
        if (staged.created) createdEntries.push(staged.entry);
      }
    } catch (error) {
      await revokeEntries(createdEntries);
      throw new Error(safeStagingError(error, inputs.flatMap((input) => typeof input.path === "string" ? [input.path] : []), processDirectory));
    }
    return result;
  }

  async function stageOne({ ownerId, workspaceRoot, epoch, input }) {
    const sourcePath = input.path;
    let sourceLstat = null;
    let source = null;
    if (!input.bytes) {
      if (typeof sourcePath !== "string" || !path.isAbsolute(sourcePath)) {
        throw new Error("The selected attachment could not be resolved.");
      }
      sourceLstat = await fsModule.promises.lstat(sourcePath).catch(() => null);
      if (!sourceLstat || sourceLstat.isSymbolicLink() || !sourceLstat.isFile()) {
        throw new Error("Only regular, non-symbolic-link files can be attached.");
      }
      const flags = fsModule.constants.O_RDONLY | (fsModule.constants.O_NOFOLLOW ?? 0);
      source = await fsModule.promises.open(sourcePath, flags).catch(() => null);
      if (!source) throw new Error("The selected attachment changed before it could be staged.");
    }
    const snapshotName = `${randomUUID()}.snapshot`;
    const snapshotPath = path.join(processDirectory, snapshotName);
    let destination = null;
    try {
      const before = source ? await source.stat() : { size: input.bytes.byteLength };
      if (source && !before.isFile()) throw new Error("Only regular files can be attached.");
      if (source && !sameFileSnapshot(sourceLstat, before)) {
        throw new Error("The selected attachment changed before it could be staged.");
      }
      if (before.size > MAX_REFERENCE_BYTES) throw new Error("An attachment exceeds the 25 MB safety limit.");
      const groupKey = referenceGroupKey(ownerId, workspaceRoot, epoch);

      destination = await fsModule.promises.open(snapshotPath, "wx", 0o600);
      const hash = createHash("sha256");
      let header = Buffer.alloc(0);
      const buffer = Buffer.allocUnsafe(COPY_CHUNK_BYTES);
      let offset = 0;
      while (offset < before.size) {
        const length = Math.min(buffer.byteLength, before.size - offset);
        const bytesRead = source
          ? (await source.read(buffer, 0, length, offset)).bytesRead
          : input.bytes.copy(buffer, 0, offset, offset + length);
        if (bytesRead <= 0) throw new Error("The selected attachment changed while it was being staged.");
        if (header.length < 16) header = Buffer.from(buffer.subarray(0, Math.min(bytesRead, 16)));
        hash.update(buffer.subarray(0, bytesRead));
        let written = 0;
        while (written < bytesRead) {
          const result = await destination.write(buffer, written, bytesRead - written, offset + written);
          written += result.bytesWritten;
        }
        offset += bytesRead;
      }
      if ((source && !sameFileSnapshot(before, await source.stat())) || offset !== before.size) {
        throw new Error("The selected attachment changed while it was being staged.");
      }
      await destination.sync();
      await destination.close();
      destination = null;
      await fsModule.promises.chmod(snapshotPath, 0o600).catch(() => {});

      const displayName = safeDisplayName(input.name ?? path.basename(sourcePath));
      const mime = inferMimeType(displayName, header);
      const digest = hash.digest("hex");
      const duplicate = Array.from(entries.values()).find((entry) => (
        entry.ownerId === ownerId
        && entry.workspaceRoot === workspaceRoot
        && entry.epoch === epoch
        && entry.displayName === displayName
        && entry.mime === mime
        && entry.size === before.size
        && entry.digest === digest
      ));
      if (duplicate) {
        await fsModule.promises.rm(snapshotPath, { force: true });
        return { reference: draftForEntry(duplicate), entry: duplicate, created: false };
      }

      const group = groups.get(groupKey) ?? { count: 0, bytes: 0 };
      if (group.count >= MAX_REFERENCES) throw new Error("Attachments exceed the 32-file safety limit.");
      if (group.bytes + before.size > MAX_TOTAL_REFERENCE_BYTES) {
        throw new Error("Attachments exceed the 25 MB total safety limit.");
      }

      const id = `ref-${randomUUID()}`;
      const token = randomBytes(32).toString("base64url");
      const createdAt = now();
      const entry = {
        id,
        token,
        ownerId,
        workspaceRoot,
        epoch,
        snapshotPath,
        displayName,
        mime,
        size: before.size,
        digest,
        createdAt,
        expiresAt: createdAt + ttlMs,
        leaseId: null,
        groupKey,
      };
      entries.set(token, entry);
      groups.set(groupKey, { count: group.count + 1, bytes: group.bytes + before.size });
      return { reference: draftForEntry(entry), entry, created: true };
    } catch (error) {
      await destination?.close().catch(() => {});
      await fsModule.promises.rm(snapshotPath, { force: true }).catch(() => {});
      throw error;
    } finally {
      await source?.close().catch(() => {});
    }
  }

  async function authorize({ ownerId, workspaceRoot, epoch, references }) {
    assertOpen();
    assertOwner(ownerId);
    assertWorkspace(workspaceRoot);
    assertOpaqueId(epoch, "reference epoch");
    await initialize();
    await sweepExpired();
    const authorized = [];
    for (const reference of Array.isArray(references) ? references.slice(0, MAX_REFERENCES) : []) {
      const token = typeof reference?.token === "string" ? reference.token : "";
      const entry = entries.get(token);
      if (!entry || entry.ownerId !== ownerId || entry.workspaceRoot !== workspaceRoot
        || entry.epoch !== epoch || entry.id !== reference?.id) {
        throw new Error("An attachment grant is invalid, expired, or belongs to another workspace.");
      }
      if (entry.leaseId) throw new Error("An attachment grant is already in use by another turn.");
      if (entry.expiresAt <= now()) {
        await revokeEntries([entry]);
        throw new Error("An attachment grant expired. Add the file again.");
      }
      const bytes = await fsModule.promises.readFile(entry.snapshotPath).catch(() => null);
      if (!bytes || bytes.byteLength !== entry.size || createHash("sha256").update(bytes).digest("hex") !== entry.digest) {
        await revokeEntries([entry]);
        throw new Error("A staged attachment is no longer available.");
      }
      authorized.push({
        authorized: true,
        id: entry.id,
        kind: "staged-attachment",
        path: entry.snapshotPath,
        name: entry.displayName,
        mime: entry.mime,
        size: entry.size,
      });
    }
    return authorized;
  }

  async function lease({ ownerId, workspaceRoot, epoch, tokens, leaseId }) {
    assertOpen();
    assertOwner(ownerId);
    assertWorkspace(workspaceRoot);
    assertOpaqueId(epoch, "reference epoch");
    assertOpaqueId(leaseId, "reference lease");
    await initialize();
    await sweepExpired();
    const uniqueTokens = Array.from(new Set(Array.isArray(tokens) ? tokens : []));
    const matches = uniqueTokens.map((token) => entries.get(token));
    if (matches.some((entry) => !entry || entry.ownerId !== ownerId || entry.workspaceRoot !== workspaceRoot
      || entry.epoch !== epoch || entry.leaseId)) {
      throw new Error("An attachment grant cannot be leased for this turn.");
    }
    for (const entry of matches) entry.leaseId = leaseId;
    return { leaseId, leased: matches.length };
  }

  async function releaseLease({ ownerId, workspaceRoot, tokens, leaseId }) {
    assertOwner(ownerId);
    assertWorkspace(workspaceRoot);
    const uniqueTokens = Array.from(new Set(Array.isArray(tokens) ? tokens : []));
    let released = 0;
    for (const token of uniqueTokens) {
      const entry = entries.get(token);
      if (!entry || entry.ownerId !== ownerId || entry.workspaceRoot !== workspaceRoot || entry.leaseId !== leaseId) continue;
      entry.leaseId = null;
      entry.expiresAt = now() + ttlMs;
      released += 1;
    }
    return { released };
  }

  async function revoke({ ownerId, workspaceRoot, tokens }) {
    assertOwner(ownerId);
    assertWorkspace(workspaceRoot);
    const matches = Array.from(new Set(Array.isArray(tokens) ? tokens : [])).flatMap((token) => {
      const entry = entries.get(token);
      return entry && !entry.leaseId && entry.ownerId === ownerId && entry.workspaceRoot === workspaceRoot ? [entry] : [];
    });
    await revokeEntries(matches);
    return { revoked: matches.length };
  }

  /** Main-only terminal cleanup. Renderer revocation cannot break a live lease. */
  async function revokeLeased({ ownerId, workspaceRoot, tokens }) {
    assertOwner(ownerId);
    assertWorkspace(workspaceRoot);
    const matches = Array.from(new Set(Array.isArray(tokens) ? tokens : [])).flatMap((token) => {
      const entry = entries.get(token);
      return entry && entry.ownerId === ownerId && entry.workspaceRoot === workspaceRoot ? [entry] : [];
    });
    await revokeEntries(matches);
    return { revoked: matches.length };
  }

  async function revokeOwner(ownerId) {
    const matches = Array.from(entries.values()).filter((entry) => entry.ownerId === ownerId);
    await revokeEntries(matches);
  }

  async function revokeWorkspace(ownerId, workspaceRoot) {
    assertOwner(ownerId);
    assertWorkspace(workspaceRoot);
    const matches = Array.from(entries.values()).filter((entry) => (
      entry.ownerId === ownerId && entry.workspaceRoot === workspaceRoot
    ));
    await revokeEntries(matches);
  }

  async function sweepExpired() {
    const expired = Array.from(entries.values()).filter((entry) => !entry.leaseId && entry.expiresAt <= now());
    await revokeEntries(expired);
    await sweepOrphanDirectories();
  }

  async function revokeEntries(values) {
    await Promise.all(values.map(async (entry) => {
      if (!entries.delete(entry.token)) return;
      const group = groups.get(entry.groupKey);
      if (group) {
        const next = { count: Math.max(0, group.count - 1), bytes: Math.max(0, group.bytes - entry.size) };
        if (next.count === 0) groups.delete(entry.groupKey);
        else groups.set(entry.groupKey, next);
      }
      await fsModule.promises.rm(entry.snapshotPath, { force: true }).catch(() => {});
    }));
  }

  async function close() {
    if (closed) return;
    closed = true;
    if (sweepTimer) clearInterval(sweepTimer);
    sweepTimer = null;
    await revokeEntries(Array.from(entries.values()));
    await fsModule.promises.rm(processDirectory, { recursive: true, force: true }).catch(() => {});
  }

  async function sweepOrphanDirectories() {
    const children = await fsModule.promises.readdir(rootPath, { withFileTypes: true }).catch(() => []);
    await Promise.all(children.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const candidate = path.join(rootPath, entry.name);
      if (candidate === processDirectory) return;
      const metadata = await fsModule.promises.stat(candidate).catch(() => null);
      if (metadata && metadata.mtimeMs + ttlMs <= now()) {
        await fsModule.promises.rm(candidate, { recursive: true, force: true }).catch(() => {});
      }
    }));
  }

  function assertOpen() {
    if (closed) throw new Error("Agent attachment staging is closed.");
  }

  return {
    initialize,
    stage,
    authorize,
    lease,
    releaseLease,
    revoke,
    revokeLeased,
    revokeOwner,
    revokeWorkspace,
    sweepExpired,
    close,
  };
}

function draftForEntry(entry) {
  return {
    id: entry.id,
    kind: "staged-attachment",
    token: entry.token,
    displayName: entry.displayName,
    mime: entry.mime,
    size: entry.size,
    status: "ready",
  };
}

function referenceGroupKey(ownerId, workspaceRoot, epoch) {
  return `${ownerId}\0${workspaceRoot}\0${epoch}`;
}

function assertOwner(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Agent attachment owner is invalid.");
}

function assertWorkspace(value) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error("Agent attachment workspace is invalid.");
}

function assertOpaqueId(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9:._-]{1,256}$/.test(value)) throw new Error(`${label} is invalid.`);
}

function sameFileSnapshot(before, after) {
  return before.size === after.size
    && before.mtimeMs === after.mtimeMs
    && (before.ino === undefined || after.ino === undefined || before.ino === after.ino)
    && (before.dev === undefined || after.dev === undefined || before.dev === after.dev);
}

function safeDisplayName(value) {
  const name = String(value || "attachment")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 512);
  return name || "attachment";
}

function inferMimeType(filePath, header) {
  const detected = sniffMimeType(header);
  const extensionMime = MIME_BY_EXTENSION.get(path.extname(filePath).toLowerCase());
  if (MAGIC_VERIFIED_MIME_TYPES.has(extensionMime) && detected !== extensionMime) {
    return "application/octet-stream";
  }
  return detected || extensionMime || "application/octet-stream";
}

function safeStagingError(error, sourcePaths, processDirectory) {
  let message = error instanceof Error ? error.message : String(error);
  for (const sourcePath of sourcePaths) message = message.split(sourcePath).join("[selected file]");
  message = message.split(processDirectory).join("[private staging]");
  return message.replace(/[\r\n]+/g, " ").slice(0, 500) || "The attachment could not be staged safely.";
}

function sniffMimeType(header) {
  if (!Buffer.isBuffer(header)) return null;
  if (header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "image/jpeg";
  const prefix = header.subarray(0, 6).toString("ascii");
  if (prefix === "GIF87a" || prefix === "GIF89a") return "image/gif";
  if (header.length >= 12 && header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (header.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  return null;
}

const MIME_BY_EXTENSION = new Map([
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".gif", "image/gif"], [".webp", "image/webp"], [".svg", "image/svg+xml"],
  [".pdf", "application/pdf"], [".txt", "text/plain"], [".md", "text/markdown"],
  [".mdx", "text/markdown"], [".json", "application/json"], [".jsonl", "application/json"],
  [".csv", "text/csv"], [".tsv", "text/tab-separated-values"], [".html", "text/html"],
  [".htm", "text/html"], [".xml", "application/xml"], [".yaml", "application/yaml"],
  [".yml", "application/yaml"], [".toml", "application/toml"], [".js", "text/javascript"],
  [".mjs", "text/javascript"], [".cjs", "text/javascript"], [".jsx", "text/javascript"],
  [".ts", "text/typescript"], [".tsx", "text/typescript"], [".css", "text/css"],
  [".py", "text/x-python"], [".rb", "text/x-ruby"], [".go", "text/x-go"],
  [".rs", "text/x-rust"], [".java", "text/x-java-source"], [".swift", "text/x-swift"],
  [".sh", "text/x-shellscript"], [".bash", "text/x-shellscript"], [".zsh", "text/x-shellscript"],
  [".sql", "text/x-sql"], [".graphql", "text/x-graphql"], [".gql", "text/x-graphql"],
]);
const MAGIC_VERIFIED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

export const agentAttachmentStoreLimits = Object.freeze({
  maxReferences: MAX_REFERENCES,
  maxReferenceBytes: MAX_REFERENCE_BYTES,
  maxTotalReferenceBytes: MAX_TOTAL_REFERENCE_BYTES,
  defaultTtlMs: DEFAULT_TTL_MS,
});
