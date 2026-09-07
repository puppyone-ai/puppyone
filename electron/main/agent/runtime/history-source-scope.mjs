import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";

/** Runtime-specific callers supply only storage/profile selectors, never credentials. */
export function localHistorySourceScope(namespace, selectors, defaults) {
  const normalize = (values) => Object.keys(values).sort().map((key) => [key, String(values[key] ?? "")]);
  const values = normalize(selectors);
  if (JSON.stringify(values) === JSON.stringify(normalize(defaults))) return "default";
  return `local:${createHash("sha256").update(JSON.stringify([namespace, values])).digest("hex")}`;
}

export function historyStoragePath(value, fallback, home = os.homedir()) {
  const input = value || fallback;
  return path.resolve(input.startsWith("~/") ? path.join(home, input.slice(2)) : input);
}

export function assertHistorySourceScope(actual, expected) {
  if (actual !== expected) throw Object.assign(new Error("The Agent history source changed. Restore the original profile or refresh History."), {
    code: "HISTORY_SOURCE_CHANGED", retryable: false,
  });
}
