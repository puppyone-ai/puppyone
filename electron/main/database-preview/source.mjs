import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { normalizeRelativePath } from "../../../local-api/files/path-policy.mjs";
import { DATABASE_BUDGET, databaseError, detectDatabase } from "../../../shared/database-preview/contract.mjs";

function stamp(stat) { return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(":"); }

/** Reject symlinks at every segment, not only at the leaf. */
async function resolveSource(rootPath, relativePath) {
  if (typeof rootPath !== "string" || typeof relativePath !== "string" || rootPath.length > 4096 || relativePath.length > 4096) throw databaseError("invalid-request");
  const root = await fs.realpath(rootPath);
  let relative;
  try { relative = normalizeRelativePath(relativePath); } catch { throw databaseError("permission-denied"); }
  if (!relative) throw databaseError("invalid-request");
  let candidate = root;
  for (const part of relative.split("/")) {
    candidate = path.join(candidate, part);
    if ((await fs.lstat(candidate)).isSymbolicLink()) throw databaseError("permission-denied");
  }
  if (!(await fs.lstat(candidate)).isFile()) throw databaseError("invalid-request");
  if (await fs.realpath(candidate) !== candidate) throw databaseError("stale-input");
  return candidate;
}

export async function inspectDatabaseSource(rootPath, relativePath) {
  const filename = await resolveSource(rootPath, relativePath);
  const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile()) throw databaseError("invalid-request");
    if (stat.size > BigInt(DATABASE_BUDGET.maxSourceBytes)) throw databaseError("budget-exceeded");
    const header = Buffer.alloc(100);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const format = detectDatabase(header.subarray(0, bytesRead));
    // v1 deliberately refuses recovery/live-WAL inputs. Opening them read-only
    // can still write sidecars; do not silently show an incomplete main file.
    if (format.journalMode === "wal") throw databaseError("recovery-required");
    const source = { rootPath, relativePath, filename, stamp: stamp(stat), format, size: Number(stat.size) };
    await verifyDatabaseSource(source);
    return source;
  } finally { await handle.close(); }
}

export async function verifyDatabaseSource(source) {
  const current = await resolveSource(source.rootPath, source.relativePath);
  if (current !== source.filename || stamp(await fs.stat(current, { bigint: true })) !== source.stamp) {
    throw databaseError("stale-input");
  }
  const suffixes = source.format.engine === "sqlite" ? ["-journal", "-wal", "-shm"] : [".wal"];
  for (const suffix of suffixes) {
    try {
      await fs.lstat(`${current}${suffix}`);
      throw databaseError("recovery-required");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}
