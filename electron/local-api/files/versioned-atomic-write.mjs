import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const workspaceWriteTails = new Map();

export function getWorkspaceFileVersion(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

export function normalizeExpectedWorkspaceVersion(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    throw new Error("Expected file version is invalid.");
  }
  return value;
}

/** Serializes every PuppyOne write to a canonical file, regardless of editor kind. */
export async function serializeWorkspaceWrite(filePath, operation) {
  const previous = workspaceWriteTails.get(filePath) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const tail = result.then(() => undefined, () => undefined);
  workspaceWriteTails.set(filePath, tail);
  try {
    return await result;
  } finally {
    if (workspaceWriteTails.get(filePath) === tail) workspaceWriteTails.delete(filePath);
  }
}

export async function assertWorkspaceFileVersion(filePath, expectedVersion) {
  const currentBytes = await fs.readFile(filePath).catch((error) => {
    throw new Error(`Unable to verify file version: ${error.message}`);
  });
  if (getWorkspaceFileVersion(currentBytes) !== expectedVersion) {
    const conflict = new Error("File changed outside PuppyOne; resolve the conflict before saving your edits.");
    conflict.code = "WORKSPACE_VERSION_CONFLICT";
    throw conflict;
  }
}

/**
 * Durable, mode-preserving replacement with an optimistic recheck immediately
 * before rename. The directory fsync makes the rename durable after a crash.
 */
export async function writeWorkspaceFileAtomic(filePath, contentBytes, sourceMode, expectedVersion) {
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.puppyone-${process.pid}-${crypto.randomUUID()}.tmp`,
  );
  let handle = null;
  try {
    handle = await fs.open(temporaryPath, "wx", sourceMode & 0o777);
    await handle.chmod(sourceMode & 0o777);
    await handle.writeFile(contentBytes);
    await handle.sync();
    await handle.close();
    handle = null;

    if (expectedVersion !== null) {
      await assertWorkspaceFileVersion(filePath, expectedVersion);
    }
    await fs.rename(temporaryPath, filePath);

    const directoryHandle = await fs.open(directory, "r").catch(() => null);
    if (directoryHandle) {
      try {
        await directoryHandle.sync().catch(() => undefined);
      } finally {
        await directoryHandle.close();
      }
    }
  } finally {
    await handle?.close().catch(() => undefined);
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
