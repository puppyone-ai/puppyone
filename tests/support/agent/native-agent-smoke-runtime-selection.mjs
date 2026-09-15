export const NATIVE_AGENT_RUNTIME_IDS = Object.freeze([
  "codex",
  "claude",
  "cursor",
  "opencode-native",
  "pi",
]);

export function requestedNativeAgentRuntimeIds(argv = [], environmentValue = "") {
  const argument = argv.find((entry) => entry.startsWith("--runtimes="));
  const value = argument?.slice("--runtimes=".length) || environmentValue || "";
  if (!value) return { valid: true, explicit: false, runtimeIds: null };
  const runtimeIds = value === "all"
    ? [...NATIVE_AGENT_RUNTIME_IDS]
    : value.split(",").map((entry) => entry.trim()).filter(Boolean);
  const unknown = runtimeIds.filter((runtimeId) => !NATIVE_AGENT_RUNTIME_IDS.includes(runtimeId));
  if (runtimeIds.length === 0 || unknown.length > 0) {
    return { valid: false, explicit: true, runtimeIds: [] };
  }
  return { valid: true, explicit: true, runtimeIds: [...new Set(runtimeIds)] };
}

export function nativeAgentSmokeTimeout(value, fallbackMs = 120_000) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1_000
    ? Math.min(Math.floor(parsed), 10 * 60_000)
    : fallbackMs;
}

export function safeNativeAgentReadinessStatus(value) {
  return [
    "not-installed",
    "unsupported-version",
    "authentication-required",
    "protocol-unavailable",
    "setup-required",
    "error",
  ].includes(value) ? value : "unavailable";
}
