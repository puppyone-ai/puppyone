/** Process-neutral, versioned limits; never supplied by database contents. */
export const DATABASE_PREVIEW_VERSION = 1;
export const DATABASE_BUDGET = Object.freeze({
  maxSourceBytes: 8 * 1024 ** 3,
  maxSessions: 8,
  maxSessionsPerOwner: 4,
  maxObjects: 512,
  maxColumns: 128,
  pageRows: 50,
  pageColumns: 24,
  cellCharacters: 256,
  maxMessageBytes: 1024 * 1024,
  maxHostRssBytes: 512 * 1024 ** 2,
  queryMs: 10_000,
  openMs: 15_000,
  idleMs: 60_000,
  sessionMs: 5 * 60_000,
  exitMs: 4_000,
});

export class DatabasePreviewError extends Error {
  constructor(code, message = code) { super(message); this.name = "DatabasePreviewError"; this.code = code; }
}
export function databaseError(code) { return new DatabasePreviewError(code); }

/** Only bounded header bytes are needed. A signature is not integrity proof. */
export function detectDatabase(bytes) {
  if (bytes.length >= 100 && Buffer.from(bytes.subarray(0, 16)).equals(Buffer.from("SQLite format 3\0"))) {
    return { engine: "sqlite", journalMode: bytes[18] === 2 || bytes[19] === 2 ? "wal" : "rollback" };
  }
  if (bytes.length >= 20 && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "DUCK") {
    return { engine: "duckdb", storageVersion: Buffer.from(bytes).readBigUInt64LE(12).toString() };
  }
  throw databaseError("unrecognized-format");
}

export function boundedInteger(value, max, fallback = 0) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw databaseError("invalid-request");
  return value;
}

export function quoteIdentifier(value) { return `"${String(value).replaceAll('"', '""')}"`; }

export function publicDatabaseFailure(error) {
  const known = new Set(["unrecognized-format", "unsupported-version", "missing-member", "permission-denied",
    "busy", "recovery-required", "corrupt", "capability-unavailable", "budget-exceeded", "timeout",
    "cancelled", "session-expired", "stale-input", "host-failed", "exit-unconfirmed", "invalid-request", "unsupported-object"]);
  if (known.has(error?.code)) return { code: error.code };
  if (["EACCES", "EPERM", "ELOOP"].includes(error?.code)) return { code: "permission-denied" };
  if (error?.code === "ENOENT") return { code: "missing-member" };
  const message = String(error?.message ?? "");
  const code = /locked|lock on file|SQLITE_BUSY/i.test(message) ? "busy"
    : /version|serialization|storage format/i.test(message) ? "unsupported-version"
      : /malformed|corrupt|file is not a database/i.test(message) ? "corrupt"
        : /permission|not authorized|access denied/i.test(message) ? "permission-denied"
          : /memory|too big|too large|heap limit/i.test(message) ? "budget-exceeded" : "host-failed";
  // Never send native paths, SQL or database values across the error boundary.
  return { code };
}
