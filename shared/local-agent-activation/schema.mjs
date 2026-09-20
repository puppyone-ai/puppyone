export const ACTIVATION_STATUSES = Object.freeze(["preparing", "installing", "setup-required", "authentication-required", "authenticating", "verifying", "ready", "detected", "cancelling", "cancelled", "failed", "interrupted"]);
export const ACTIVATION_STEPS = Object.freeze(["prepare", "install", "login", "verify"]);
export const ACTIVATION_ERRORS = Object.freeze(["installation-check", "download", "integrity", "archive", "installation-busy", "installation", "authentication", "verification", "interrupted", "storage", "timeout", "process", "unsupported"]);
export const isActivationActive = (status) => ACTIVATION_STATUSES.includes(status) && !["ready", "detected", "cancelled", "failed", "interrupted"].includes(status);

export function exactObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !(key in value))) throw new Error("Invalid activation request.");
  return value;
}
export function activationId(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9:-]{1,100}$/u.test(value)) throw new Error("Invalid activation ID.");
  return value;
}
export function assertActivationSnapshot(value) {
  exactObject(value, ["epoch", "revision", "operations"]);
  activationId(value.epoch);
  if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.operations) || value.operations.length > 16) throw new Error("Invalid activation snapshot.");
  const ids = new Set();
  for (const entry of value.operations) {
    exactObject(entry, ["operationId", "setupId", "displayName", "status", "steps", "installed", "errorCode", "updatedAt"]);
    activationId(entry.operationId); activationId(entry.setupId);
    if (ids.has(entry.setupId) || typeof entry.displayName !== "string" || entry.displayName.length > 100
      || !ACTIVATION_STATUSES.includes(entry.status) || typeof entry.installed !== "boolean"
      || !(entry.errorCode === null || ACTIVATION_ERRORS.includes(entry.errorCode))
      || !Number.isSafeInteger(entry.updatedAt) || !Array.isArray(entry.steps) || entry.steps.length !== 4) throw new Error("Invalid activation operation.");
    ids.add(entry.setupId);
    entry.steps.forEach((step, index) => {
      exactObject(step, ["id", "status"]);
      if (step.id !== ACTIVATION_STEPS[index] || !["pending", "running", "complete", "skipped", "failed"].includes(step.status)) throw new Error("Invalid activation step.");
    });
  }
  return value;
}
