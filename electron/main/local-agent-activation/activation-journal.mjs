import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ACTIVATION_STATUSES, ACTIVATION_ERRORS, assertActivationSnapshot, exactObject } from "../../../shared/local-agent-activation/schema.mjs";

// The original journal had no version and included account/protocol work. Only
// storage accepts that legacy contract; IPC must never accept its login action
// or obsolete states. Migration changes receipts, never runs installation/auth.
function readJournal(value) {
  if (value && Object.hasOwn(value, "schemaVersion")) {
    exactObject(value, ["schemaVersion", "snapshot"]);
    if (value.schemaVersion !== 2) throw new Error("Unsupported activation journal.");
    return assertActivationSnapshot(value.snapshot);
  }
  exactObject(value, ["epoch", "revision", "operations"]);
  if (!Array.isArray(value.operations) || value.operations.length > 16) throw new Error("Invalid activation journal.");
  const statuses = [...ACTIVATION_STATUSES, "authentication-required", "authenticating", "detected"];
  const errors = [...ACTIVATION_ERRORS, "authentication", "verification"];
  const steps = ["prepare", "install", "login", "verify"];
  return assertActivationSnapshot({ ...value, operations: value.operations.map(entry => {
    exactObject(entry, ["operationId", "setupId", "displayName", "status", "steps", "installed", "errorCode", "updatedAt"]);
    if (!statuses.includes(entry.status) || !(entry.errorCode === null || errors.includes(entry.errorCode))
      || !Array.isArray(entry.steps) || entry.steps.length !== steps.length) throw new Error("Invalid legacy activation operation.");
    entry.steps.forEach((step, index) => {
      exactObject(step, ["id", "status"]);
      if (step.id !== steps[index] || !["pending", "running", "complete", "skipped", "failed"].includes(step.status)) throw new Error("Invalid legacy activation step.");
    });
    const obsolete = ["authentication-required", "authenticating", "verifying", "detected"].includes(entry.status)
      || ["authentication", "verification"].includes(entry.errorCode);
    const status = obsolete ? entry.installed === true ? "ready" : "interrupted" : entry.status;
    return { ...entry, status,
      errorCode: obsolete ? status === "ready" ? null : "interrupted" : entry.errorCode,
      steps: entry.steps.filter(step => step.id !== "login").map(step => status === "ready" && !["complete", "skipped"].includes(step.status)
        ? { ...step, status: "complete" } : obsolete && step.status === "running" ? { ...step, status: "failed" } : step),
    };
  }) });
}

export function createActivationJournal(filePath) {
  let queue = Promise.resolve();
  return {
    async read() {
      try {
        const stat = await fs.lstat(filePath);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) throw new Error("Invalid activation journal.");
        return readJournal(JSON.parse(await fs.readFile(filePath, "utf8"))).operations;
      } catch (error) { if (error.code === "ENOENT") return []; throw error; }
    },
    write(snapshot) {
      const data = JSON.stringify({ schemaVersion: 2, snapshot: assertActivationSnapshot(snapshot) });
      const next = queue.catch(() => {}).then(async () => {
        await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
        const temporary = `${filePath}.${randomUUID()}.tmp`;
        try {
          await fs.writeFile(temporary, data, { mode: 0o600, flag: "wx" });
          await fs.rename(temporary, filePath);
        } finally { await fs.rm(temporary, { force: true }); }
      });
      queue = next;
      return next;
    },
  };
}
