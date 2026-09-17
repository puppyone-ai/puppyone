export const LOCAL_AGENT_INSTALLATION_IDS = Object.freeze([
  "codex",
  "claude",
  "cursor",
  "opencode",
  "pi",
  "workbuddy",
  "hermes",
]);

const INSTALLATION_ID_SET = new Set(LOCAL_AGENT_INSTALLATION_IDS);
const INSTALLATION_STATUSES = new Set(["found", "not-found", "failed"]);

export function isLocalAgentInstallationId(value) {
  return typeof value === "string" && INSTALLATION_ID_SET.has(value);
}

export function assertLocalAgentInstallationSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Local Agent installation snapshot must be an object.");
  }
  if (value.schemaVersion !== 1 || !Number.isSafeInteger(value.generation) || value.generation < 1) {
    throw new TypeError("Local Agent installation snapshot version is invalid.");
  }
  if (!safeIdentifier(value.scanId) || !validTimestamp(value.requestedAt) || !validTimestamp(value.completedAt)) {
    throw new TypeError("Local Agent installation snapshot identity is invalid.");
  }
  if (value.source !== "scan" && value.source !== "memory-cache") {
    throw new TypeError("Local Agent installation snapshot source is invalid.");
  }
  const results = assertResults(value.results);
  const availableAgentIds = assertAvailableIds(value.availableAgentIds);
  const found = results.filter(({ status }) => status === "found").map(({ agentId }) => agentId);
  if (availableAgentIds.join("\0") !== found.join("\0")) {
    throw new TypeError("Local Agent installation availability does not match its results.");
  }
  return deepFreeze({
    schemaVersion: 1,
    generation: value.generation,
    scanId: value.scanId,
    requestedAt: value.requestedAt,
    completedAt: value.completedAt,
    source: value.source,
    availableAgentIds,
    results,
  });
}

export function assertLocalAgentInstallationProgress(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Local Agent installation progress must be an object.");
  }
  if (!safeIdentifier(value.requestId) || !safeIdentifier(value.scanId)) {
    throw new TypeError("Local Agent installation progress identity is invalid.");
  }
  if (!Number.isSafeInteger(value.generation) || value.generation < 1
    || !Number.isSafeInteger(value.completedAgentCount) || value.completedAgentCount < 0
    || !Number.isSafeInteger(value.totalAgentCount) || value.totalAgentCount < 0
    || value.completedAgentCount > value.totalAgentCount) {
    throw new TypeError("Local Agent installation progress counters are invalid.");
  }
  return deepFreeze({
    requestId: value.requestId,
    scanId: value.scanId,
    generation: value.generation,
    completedAgentCount: value.completedAgentCount,
    totalAgentCount: value.totalAgentCount,
    availableAgentIds: assertAvailableIds(value.availableAgentIds),
    results: assertResults(value.results),
  });
}

function assertResults(value) {
  if (!Array.isArray(value) || value.length > LOCAL_AGENT_INSTALLATION_IDS.length) {
    throw new TypeError("Local Agent installation results are invalid.");
  }
  const seen = new Set();
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)
      || !isLocalAgentInstallationId(entry.agentId) || seen.has(entry.agentId)
      || !INSTALLATION_STATUSES.has(entry.status)
      || typeof entry.displayName !== "string" || !entry.displayName.trim()
      || entry.displayName.length > 80) {
      throw new TypeError("Local Agent installation result is invalid.");
    }
    seen.add(entry.agentId);
    const reasonCode = optionalToken(entry.reasonCode, 80);
    const source = optionalToken(entry.source, 80);
    return {
      agentId: entry.agentId,
      displayName: entry.displayName,
      status: entry.status,
      ...(reasonCode ? { reasonCode } : {}),
      ...(source ? { source } : {}),
    };
  });
}

function assertAvailableIds(value) {
  if (!Array.isArray(value) || value.some((entry) => !isLocalAgentInstallationId(entry))) {
    throw new TypeError("Local Agent installation ids are invalid.");
  }
  if (new Set(value).size !== value.length) {
    throw new TypeError("Local Agent installation ids must be unique.");
  }
  return [...value];
}

function optionalToken(value, maxLength) {
  if (value == null) return null;
  return typeof value === "string" && value.length > 0 && value.length <= maxLength
    && /^[A-Za-z0-9._:/-]+$/u.test(value)
    ? value
    : null;
}

function safeIdentifier(value) {
  return typeof value === "string" && /^[A-Za-z0-9:_-]{1,96}$/u.test(value);
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
