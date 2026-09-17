import { BUILT_IN_AGENT_DISPLAY_NAME } from "../runtimes/puppyone-agent/puppyone-agent-public-identity.mjs";

const LEGACY_RUNTIME_ID = "codex";
const RUNTIME_ID_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;
const RUNTIME_ID_ALIASES = Object.freeze({
  // Before ADR-005, `opencode` meant PuppyOne's managed product runtime.
  // User-owned OpenCode sessions have the distinct `opencode-native` id and
  // must never pass through this alias.
  opencode: "puppyone-agent",
});

/**
 * Session journal v1 predated runtime selection and therefore omitted a
 * runtime id. Keep that historical default at the persistence edge instead of
 * leaking a concrete runtime into the application service or domain model.
 */
export function resolvePersistedRuntimeId(record, requestedRuntimeId = null) {
  for (const value of [record?.runtimeId, record?.provider, requestedRuntimeId]) {
    if (typeof value === "string" && RUNTIME_ID_PATTERN.test(value)) return canonicalRuntimeId(value);
  }
  return LEGACY_RUNTIME_ID;
}

export function migratedRuntimeDescriptor(record, runtimeId) {
  const previous = record?.runtime && typeof record.runtime === "object" ? record.runtime : {};
  if (runtimeId === "puppyone-agent") {
    return { ...previous, id: runtimeId, displayName: BUILT_IN_AGENT_DISPLAY_NAME, kind: "managed-harness" };
  }
  if (runtimeId === LEGACY_RUNTIME_ID) {
    return { ...previous, id: runtimeId, displayName: previous.displayName || "Codex", kind: previous.kind || "native-cli" };
  }
  return {
    ...previous,
    id: runtimeId,
    displayName: previous.displayName || humanizeRuntimeId(runtimeId),
    kind: previous.kind || "native-cli",
  };
}

export function canonicalRuntimeId(value) {
  return RUNTIME_ID_ALIASES[value] ?? value;
}

function humanizeRuntimeId(value) {
  return String(value).replace(/[-_.]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
