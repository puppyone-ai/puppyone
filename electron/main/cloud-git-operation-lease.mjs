import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveGitRepositoryIdentity } from "../local-api/workspace.mjs";
import { createPublishError } from "./cloud-publish-contract.mjs";

const LEASE_FILENAME = "cloud-git-operation.lease.json";
const LEASE_VERSION = 1;
const LEASE_DURATION_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 5_000;
const TAKEOVER_LOCK_TIMEOUT_MS = 5_000;
const TAKEOVER_LOCK_RETRY_MS = 10;
const TAKEOVER_LOCK_STALE_MS = 30_000;

/** Cross-process lease spanning the complete Cloud Git saga, not just writes. */
export function createCloudGitOperationLease({
  fsApi = fs.promises,
  resolveRepositoryIdentity = resolveGitRepositoryIdentity,
  randomUUID = crypto.randomUUID,
  now = () => Date.now(),
  isProcessAlive = defaultIsProcessAlive,
} = {}) {
  async function acquire(rootPath) {
    const identity = await resolveRepositoryIdentity(rootPath);
    if (!identity?.repository || !identity.commonDir) {
      throw createPublishError("REPOSITORY_REQUIRED", "Current workspace is not a Git repository.", false);
    }
    // Git remotes and repository-local credential config live in commonDir,
    // so linked worktrees must contend on the same lease.
    const directory = path.join(identity.commonDir, "puppyone");
    const leasePath = path.join(directory, LEASE_FILENAME);
    const takeoverPath = `${leasePath}.takeover`;
    await ensureSafeLeaseDirectory(directory, fsApi);
    const ownerToken = randomUUID();
    const claimed = await tryClaimLease({
      directory,
      leasePath,
      takeoverPath,
      ownerToken,
      fsApi,
      now,
      isProcessAlive,
    });
    if (!claimed) {
      throw createPublishError(
        "JOURNAL_IO_FAILED",
        "Another Desktop process is already updating this worktree's Cloud Git operation.",
        true,
      );
    }

    let released = false;
    let heartbeatRunning = false;
    const heartbeat = setInterval(() => {
      if (released || heartbeatRunning) return;
      heartbeatRunning = true;
      void refreshLease(leasePath, ownerToken, fsApi, now)
        .finally(() => { heartbeatRunning = false; });
    }, HEARTBEAT_INTERVAL_MS);
    heartbeat.unref?.();

    return {
      ownerToken,
      async release() {
        if (released) return;
        released = true;
        clearInterval(heartbeat);
        await withTakeoverLock({ takeoverPath, fsApi, now, isProcessAlive }, async () => {
          const current = await readLease(leasePath, fsApi).catch(() => null);
          if (current?.owner_token !== ownerToken) return;
          await fsApi.rm(leasePath, { force: true });
          await syncDirectoryBestEffort(directory, fsApi);
        });
      },
    };
  }

  return { acquire };
}

async function tryClaimLease({ directory, leasePath, takeoverPath, ownerToken, fsApi, now, isProcessAlive }) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const timestamp = now();
    const envelope = {
      version: LEASE_VERSION,
      owner_token: ownerToken,
      pid: process.pid,
      heartbeat_at: new Date(timestamp).toISOString(),
      expires_at: new Date(timestamp + LEASE_DURATION_MS).toISOString(),
    };
    let handle = null;
    try {
      handle = await fsApi.open(leasePath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify(envelope)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await syncDirectoryBestEffort(directory, fsApi);
      return true;
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      if (error?.code !== "EEXIST") throw error;
      const metadata = await fsApi.lstat(leasePath).catch(() => null);
      if (metadata?.isSymbolicLink() || (metadata && !metadata.isFile())) {
        throw createPublishError("JOURNAL_IO_FAILED", "Cloud Git operation lease is unsafe.", false);
      }
      const current = await readLease(leasePath, fsApi).catch(() => null);
      const expiry = Date.parse(current?.expires_at ?? "");
      const expired = Number.isFinite(expiry)
        ? now() >= expiry
        : Boolean(metadata && now() - metadata.mtimeMs >= LEASE_DURATION_MS);
      const hasOwnerPid = Number.isInteger(current?.pid) && current.pid > 0;
      const ownerAlive = hasOwnerPid && isProcessAlive(current.pid);
      if (ownerAlive) return false;
      const ownerDead = hasOwnerPid && !ownerAlive;
      // Expiry only recovers malformed/no-PID residue. A live PID always owns
      // the lease, even across machine sleep or a long event-loop stall.
      if (!ownerDead && !expired) return false;
      return withTakeoverLock({ takeoverPath, fsApi, now, isProcessAlive }, async () => {
        const latestMetadata = await fsApi.lstat(leasePath).catch(() => null);
        if (!latestMetadata) return tryCreateLease(leasePath, envelope, fsApi, directory);
        if (latestMetadata.isSymbolicLink() || !latestMetadata.isFile()) {
          throw createPublishError("JOURNAL_IO_FAILED", "Cloud Git operation lease is unsafe.", false);
        }
        const latest = await readLease(leasePath, fsApi).catch(() => null);
        if (!isLeaseReclaimable(latest, latestMetadata, now, isProcessAlive)) return false;
        await fsApi.rm(leasePath, { force: true });
        return tryCreateLease(leasePath, envelope, fsApi, directory);
      });
    }
  }
  return false;
}

async function tryCreateLease(leasePath, envelope, fsApi, directory) {
  let handle = null;
  try {
    handle = await fsApi.open(leasePath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(envelope)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await syncDirectoryBestEffort(directory, fsApi);
    return true;
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    if (error?.code === "EEXIST") return false;
    throw error;
  }
}

function isLeaseReclaimable(current, metadata, now, isProcessAlive) {
  const expiry = Date.parse(current?.expires_at ?? "");
  const expired = Number.isFinite(expiry)
    ? now() >= expiry
    : Boolean(metadata && now() - metadata.mtimeMs >= LEASE_DURATION_MS);
  const hasOwnerPid = Number.isInteger(current?.pid) && current.pid > 0;
  if (hasOwnerPid && isProcessAlive(current.pid)) return false;
  return hasOwnerPid || expired;
}

async function withTakeoverLock(options, operation) {
  const ownerToken = crypto.randomUUID();
  await acquireTakeoverLock(options, ownerToken);
  try {
    return await operation();
  } finally {
    await releaseTakeoverLock(options.takeoverPath, ownerToken, options.fsApi);
  }
}

async function acquireTakeoverLock({ takeoverPath, fsApi, now, isProcessAlive }, ownerToken) {
  const startedAt = now();
  while (true) {
    let handle = null;
    try {
      handle = await fsApi.open(takeoverPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({ owner_token: ownerToken, pid: process.pid })}\n`, "utf8");
      await handle.sync();
      await handle.close();
      return;
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      if (error?.code !== "EEXIST") throw error;
      const metadata = await fsApi.lstat(takeoverPath).catch(() => null);
      const current = await readTakeoverLock(takeoverPath, fsApi).catch(() => null);
      const live = Number.isInteger(current?.pid) && current.pid > 0 && isProcessAlive(current.pid);
      const stale = metadata && now() - metadata.mtimeMs >= TAKEOVER_LOCK_STALE_MS;
      if (!live && stale) {
        await fsApi.rm(takeoverPath, { force: true }).catch(() => undefined);
        continue;
      }
      if (now() - startedAt >= TAKEOVER_LOCK_TIMEOUT_MS) {
        throw createPublishError("JOURNAL_IO_FAILED", "Cloud Git operation takeover is busy.", true);
      }
      await new Promise((resolve) => setTimeout(resolve, TAKEOVER_LOCK_RETRY_MS));
    }
  }
}

async function readTakeoverLock(takeoverPath, fsApi) {
  const metadata = await fsApi.lstat(takeoverPath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 4096) return null;
  const value = JSON.parse(await fsApi.readFile(takeoverPath, "utf8"));
  return typeof value?.owner_token === "string" && Number.isInteger(value.pid) ? value : null;
}

async function releaseTakeoverLock(takeoverPath, ownerToken, fsApi) {
  const current = await readTakeoverLock(takeoverPath, fsApi).catch(() => null);
  if (current?.owner_token === ownerToken) await fsApi.rm(takeoverPath, { force: true });
}

async function refreshLease(leasePath, ownerToken, fsApi, now) {
  const current = await readLease(leasePath, fsApi);
  if (current?.owner_token !== ownerToken) return;
  const timestamp = now();
  const next = {
    ...current,
    heartbeat_at: new Date(timestamp).toISOString(),
    expires_at: new Date(timestamp + LEASE_DURATION_MS).toISOString(),
  };
  const handle = await fsApi.open(leasePath, "r+");
  try {
    const latest = await readLease(leasePath, fsApi);
    if (latest?.owner_token !== ownerToken) return;
    await handle.truncate(0);
    await handle.writeFile(`${JSON.stringify(next)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readLease(leasePath, fsApi) {
  const metadata = await fsApi.lstat(leasePath);
  if (
    !metadata.isFile()
    || metadata.isSymbolicLink()
    || metadata.size > 16 * 1024
    || (process.platform !== "win32" && (metadata.mode & 0o077) !== 0)
  ) {
    throw createPublishError("JOURNAL_IO_FAILED", "Cloud Git operation lease is unsafe.", false);
  }
  const raw = await fsApi.readFile(leasePath, "utf8");
  const value = JSON.parse(raw);
  if (
    value?.version !== LEASE_VERSION
    || typeof value.owner_token !== "string"
    || !Number.isInteger(value.pid)
  ) return null;
  return value;
}

async function ensureSafeLeaseDirectory(directory, fsApi) {
  await fsApi.mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await fsApi.lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw createPublishError("JOURNAL_IO_FAILED", "Cloud Git operation lease directory is unsafe.", false);
  }
  await fsApi.chmod(directory, 0o700).catch(() => undefined);
}

function defaultIsProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function syncDirectoryBestEffort(directory, fsApi) {
  let handle = null;
  try {
    handle = await fsApi.open(directory, "r");
    await handle.sync();
  } catch {
    // Directory fsync is best effort across platforms.
  } finally {
    if (handle) await handle.close().catch(() => undefined);
  }
}
