import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveGitRepositoryIdentity } from "../../local-api/workspace.mjs";
import {
  CLOUD_INITIALIZATION_CHECKPOINTS,
  normalizeCloudInitializationJournalRecord,
} from "./cloud-initialization/journal/schema-v2.mjs";

const JOURNAL_DIRECTORY = "puppyone";
// Keep the established path so installed clients can migrate in place. The
// record inside this file is schema v2 after its first successful read.
const JOURNAL_FILENAME = "pending-cloud-publish.v1.json";
const MAX_JOURNAL_BYTES = 128 * 1024;
const JOURNAL_LOCK_TIMEOUT_MS = 5_000;
const JOURNAL_LOCK_STALE_MS = 30_000;
const JOURNAL_LOCK_RETRY_MS = 20;

export const CLOUD_PUBLISH_PHASES = CLOUD_INITIALIZATION_CHECKPOINTS;

/** A durable, worktree-specific write-ahead log stored in Git's own git-dir. */
export function createCloudPublishJournal(options = {}) {
  const now = options.now ?? (() => Date.now());
  const store = createWorktreeGitOperationJournal({
    ...options,
    filename: JOURNAL_FILENAME,
    normalizeEntry: normalizeCloudInitializationJournalRecord,
    canTransition: isCloudInitializationTransitionAllowed,
    stateField: "checkpoint",
  });
  return {
    ...store,
    async read(rootPath) {
      const entry = await store.read(rootPath);
      const record = entry.record;
      if (!record?.migrated_from || record.migrated_from.persisted) return entry;
      const migrated = {
        ...record,
        revision: record.revision + 1,
        migrated_from: { ...record.migrated_from, persisted: true },
        updated_at: new Date(now()).toISOString(),
      };
      return store.write(rootPath, migrated, {
        expectedOperationId: record.operation_id,
        expectedRevision: record.revision,
        expectedState: record.checkpoint,
      });
    },
  };
}

/** Shared durability primitive for every main-owned Cloud Git operation. */
export function createWorktreeGitOperationJournal({
  filename,
  normalizeEntry,
  prepareEntry = (record) => record,
  canTransition = () => true,
  stateField = "phase",
  fsApi = fs.promises,
  now = () => Date.now(),
  resolveRepositoryIdentity = resolveGitRepositoryIdentity,
} = {}) {
  if (typeof filename !== "string" || !/^[a-z0-9][a-z0-9.-]+\.json$/.test(filename)) {
    throw new TypeError("Cloud Git operation journal filename is invalid.");
  }
  if (typeof normalizeEntry !== "function") {
    throw new TypeError("Cloud Git operation journal normalizer is required.");
  }
  async function resolvePaths(rootPath) {
    const identity = await resolveRepositoryIdentity(rootPath);
    if (!identity?.repository || !identity.gitDir || !identity.commonDir) {
      throw createJournalError("Current workspace is not a Git repository.", "REPOSITORY_REQUIRED");
    }
    const directory = path.join(identity.gitDir, JOURNAL_DIRECTORY);
    return {
      identity,
      directory,
      journalPath: path.join(directory, filename),
    };
  }

  async function read(rootPath) {
    const paths = await resolvePaths(rootPath);
    return { ...paths, record: await readEntryAtPath(paths.journalPath, normalizeEntry, fsApi) };
  }

  async function write(rootPath, record, options = {}) {
    const paths = await resolvePaths(rootPath);
    const normalized = normalizeEntry(prepareEntry(record));
    await ensureSafeDirectory(paths.directory, fsApi);
    return withJournalLock(paths, fsApi, async () => {
      const current = await readEntryAtPath(paths.journalPath, normalizeEntry, fsApi);
      assertJournalCompareAndSwap(current, options, stateField);
      assertMonotonicJournalUpdate(current, normalized, canTransition, options, stateField);
      await writeJsonAtomic(paths.journalPath, normalized, fsApi, now, {
        createOnly: options.createOnly === true,
      });
      return { ...paths, record: normalized };
    });
  }

  async function clear(rootPath, options = {}) {
    const paths = await resolvePaths(rootPath);
    await ensureSafeDirectory(paths.directory, fsApi);
    await withJournalLock(paths, fsApi, async () => {
      const current = await readEntryAtPath(paths.journalPath, normalizeEntry, fsApi);
      if (!current) return;
      assertJournalCompareAndSwap(current, options, stateField);
      await fsApi.rm(paths.journalPath, { force: true }).catch((error) => {
        throw createJournalError("Unable to clear the Cloud Git operation journal.", "JOURNAL_IO_FAILED", error);
      });
      await syncDirectoryBestEffort(paths.directory, fsApi);
    });
  }

  return { read, write, clear, resolvePaths };
}

async function readEntryAtPath(journalPath, normalizeEntry, fsApi) {
    let metadata;
    try {
      metadata = await fsApi.lstat(journalPath);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw createJournalError("Unable to inspect the Cloud Git operation journal.", "JOURNAL_IO_FAILED", error);
    }
    if (
      !metadata.isFile()
      || metadata.isSymbolicLink()
      || metadata.size > MAX_JOURNAL_BYTES
      || (process.platform !== "win32" && (metadata.mode & 0o077) !== 0)
    ) {
      throw createJournalError("Cloud Git operation journal is invalid.", "JOURNAL_CORRUPT");
    }
    let raw;
    try {
      raw = await fsApi.readFile(journalPath, "utf8");
    } catch (error) {
      throw createJournalError("Unable to read the Cloud Git operation journal.", "JOURNAL_IO_FAILED", error);
    }
    let value;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw createJournalError("Cloud Git operation journal is corrupt.", "JOURNAL_CORRUPT", error);
    }
    return normalizeEntry(value);
}

export const normalizeJournalRecord = normalizeCloudInitializationJournalRecord;

async function ensureSafeDirectory(directory, fsApi) {
  await fsApi.mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await fsApi.lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw createJournalError("Cloud publish journal directory is unsafe.", "JOURNAL_IO_FAILED");
  }
  await fsApi.chmod(directory, 0o700).catch(() => undefined);
}

async function withJournalLock(paths, fsApi, operation) {
  const lockPath = `${paths.journalPath}.lock`;
  const startedAt = Date.now();
  let handle = null;
  while (!handle) {
    try {
      handle = await fsApi.open(lockPath, "wx", 0o600);
      await handle.writeFile(`${process.pid}\n`, "utf8");
      await handle.sync();
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw createJournalError("Unable to lock the Cloud Git operation journal.", "JOURNAL_IO_FAILED", error);
      }
      const stale = await fsApi.lstat(lockPath)
        .then((metadata) => Date.now() - metadata.mtimeMs > JOURNAL_LOCK_STALE_MS)
        .catch(() => false);
      if (stale) {
        await fsApi.rm(lockPath, { force: true }).catch(() => undefined);
        continue;
      }
      if (Date.now() - startedAt >= JOURNAL_LOCK_TIMEOUT_MS) {
        throw createJournalError("Cloud Git operation journal is busy.", "JOURNAL_IO_FAILED");
      }
      await new Promise((resolve) => setTimeout(resolve, JOURNAL_LOCK_RETRY_MS));
    }
  }
  try {
    return await operation();
  } finally {
    await handle.close().catch(() => undefined);
    await fsApi.rm(lockPath, { force: true }).catch(() => undefined);
  }
}

function assertJournalCompareAndSwap(current, options, stateField) {
  if (options.createOnly === true) {
    if (!current) return;
    throw createJournalError(
      "A Cloud Git operation is already pending for this worktree.",
      "IDENTITY_MISMATCH",
    );
  }
  if (!current) {
    throw createJournalError("Pending Cloud Git operation disappeared.", "IDENTITY_MISMATCH");
  }
  if (
    (options.expectedOperationId && current.operation_id !== options.expectedOperationId)
    || (Number.isInteger(options.expectedRevision) && current.revision !== options.expectedRevision)
    || ((options.expectedState || options.expectedPhase)
      && current[stateField] !== (options.expectedState || options.expectedPhase))
  ) {
    throw createJournalError(
      "Pending Cloud Git operation changed in another Desktop process.",
      "IDENTITY_MISMATCH",
    );
  }
}

function assertMonotonicJournalUpdate(current, next, canTransition, options, stateField) {
  if (options.createOnly === true) {
    if (Number.isSafeInteger(next.revision) && next.revision !== 0) {
      throw createJournalError("New Cloud Git operation revision must start at zero.", "JOURNAL_CORRUPT");
    }
    return;
  }
  if (
    next.operation_id !== current.operation_id
    || (Number.isSafeInteger(current.revision) && next.revision !== current.revision + 1)
    || !canTransition(current[stateField], next[stateField], current, next)
  ) {
    throw createJournalError(
      "Cloud Git operation journal update is not monotonic.",
      "IDENTITY_MISMATCH",
    );
  }
}

function isCloudInitializationTransitionAllowed(from, to, current, next) {
  // Only an explicit server refusal can cancel durable cleanup intent. A
  // timeout or lost deletion response must remain in the cleanup workflow.
  if (from === "cleanup-requested" && next?.cleanup_state === "none"
    && next?.last_error?.code === "CLEANUP_NOT_ALLOWED"
    && ["project-created", "credential-issued", "push-attempt"].includes(to)) {
    return current?.project_id === next.project_id;
  }
  const transitions = {
    prepared: ["prepared", "project-created", "cleanup-requested"],
    "project-created": ["project-created", "credential-issued", "cleanup-requested"],
    "credential-issued": ["credential-issued", "remote-configured", "cleanup-requested"],
    "remote-configured": ["remote-configured", "push-attempt", "push-accepted", "cleanup-requested"],
    "push-attempt": ["push-attempt", "push-accepted", "cleanup-requested"],
    "push-accepted": ["push-accepted", "completed"],
    "cleanup-requested": ["cleanup-requested", "cleanup-server-complete", "push-accepted"],
    "cleanup-server-complete": ["cleanup-server-complete", "completed"],
    completed: ["completed"],
  };
  return transitions[from]?.includes(to) === true;
}

async function writeJsonAtomic(filePath, value, fsApi, now, { createOnly }) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${now()}.${crypto.randomBytes(8).toString("hex")}.tmp`,
  );
  let handle = null;
  let linked = false;
  try {
    handle = await fsApi.open(temporaryPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    if (createOnly) {
      try {
        await fsApi.link(temporaryPath, filePath);
        linked = true;
      } catch (error) {
        if (error?.code === "EEXIST") {
          throw createJournalError(
            "A Cloud publish operation is already pending for this worktree.",
            "JOURNAL_IO_FAILED",
            error,
          );
        }
        throw error;
      }
    } else {
      await fsApi.rename(temporaryPath, filePath);
    }
    await fsApi.chmod(filePath, 0o600).catch(() => undefined);
    await syncDirectoryBestEffort(directory, fsApi);
  } catch (error) {
    if (error?.publishCode) throw error;
    throw createJournalError("Unable to persist the Cloud publish journal.", "JOURNAL_IO_FAILED", error);
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    if (linked || createOnly) {
      await fsApi.rm(temporaryPath, { force: true }).catch(() => undefined);
    } else {
      await fsApi.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}

async function syncDirectoryBestEffort(directory, fsApi) {
  let handle = null;
  try {
    handle = await fsApi.open(directory, "r");
    await handle.sync();
  } catch {
    // Best effort on platforms/filesystems that do not support directory fsync.
  } finally {
    if (handle) await handle.close().catch(() => undefined);
  }
}

function createJournalError(message, publishCode, cause = undefined) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.publishCode = publishCode;
  return error;
}
