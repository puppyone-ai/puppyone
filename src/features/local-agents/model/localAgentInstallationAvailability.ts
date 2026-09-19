import {
  LOCAL_AGENT_INSTALLATION_IDS,
  type LocalAgentInstallationId,
  type LocalAgentInstallationProgressEvent,
  type LocalAgentInstallationResult,
  type LocalAgentInstallationSnapshot,
} from "../../../../shared/local-agent-installation/types";

export type LocalAgentInstallationDiscoveryPhase = "idle" | "loading" | "ready" | "error";

const installationIdSet = new Set<string>(LOCAL_AGENT_INSTALLATION_IDS);

export function normalizeLocalAgentInstallationSnapshot(value: unknown): LocalAgentInstallationSnapshot {
  const candidate = requireRecord(value, "snapshot");
  if (candidate.schemaVersion !== 1
    || !Number.isSafeInteger(candidate.generation) || (candidate.generation as number) < 1
    || !safeId(candidate.scanId)
    || !validTimestamp(candidate.requestedAt)
    || !validTimestamp(candidate.completedAt)
    || (candidate.source !== "scan" && candidate.source !== "memory-cache")) {
    throw new Error("Invalid Local Agent installation snapshot.");
  }
  const results = normalizeResults(candidate.results);
  const availableAgentIds = normalizeAvailableLocalAgentIds(candidate.availableAgentIds);
  const found = results.filter(({ status }) => status === "found").map(({ agentId }) => agentId);
  if (availableAgentIds.join("\0") !== found.join("\0")) {
    throw new Error("Invalid Local Agent installation availability.");
  }
  return {
    schemaVersion: 1,
    generation: candidate.generation as number,
    scanId: candidate.scanId as string,
    requestedAt: candidate.requestedAt as string,
    completedAt: candidate.completedAt as string,
    source: candidate.source,
    availableAgentIds,
    results,
  };
}

export function normalizeLocalAgentInstallationProgress(value: unknown): LocalAgentInstallationProgressEvent {
  const candidate = requireRecord(value, "progress");
  if (!safeId(candidate.requestId) || !safeId(candidate.scanId)
    || !Number.isSafeInteger(candidate.generation) || (candidate.generation as number) < 1
    || !Number.isSafeInteger(candidate.completedAgentCount) || (candidate.completedAgentCount as number) < 0
    || !Number.isSafeInteger(candidate.totalAgentCount) || (candidate.totalAgentCount as number) < 1
    || (candidate.totalAgentCount as number) > LOCAL_AGENT_INSTALLATION_IDS.length
    || (candidate.completedAgentCount as number) > (candidate.totalAgentCount as number)) {
    throw new Error("Invalid Local Agent installation progress.");
  }
  const results = normalizeResults(candidate.results);
  const availableAgentIds = normalizeAvailableLocalAgentIds(candidate.availableAgentIds);
  const found = results.filter(({ status }) => status === "found").map(({ agentId }) => agentId);
  if (candidate.completedAgentCount !== results.length || availableAgentIds.join("\0") !== found.join("\0")) {
    throw new Error("Inconsistent Local Agent installation progress.");
  }
  return {
    requestId: candidate.requestId as string,
    scanId: candidate.scanId as string,
    generation: candidate.generation as number,
    completedAgentCount: candidate.completedAgentCount as number,
    totalAgentCount: candidate.totalAgentCount as number,
    availableAgentIds,
    results,
  };
}

export function normalizeAvailableLocalAgentIds(values: unknown): LocalAgentInstallationId[] {
  if (!Array.isArray(values) || values.some((id) => typeof id !== "string" || !installationIdSet.has(id))) {
    throw new Error("Invalid Local Agent installation ids.");
  }
  const available = new Set(values as LocalAgentInstallationId[]);
  return LOCAL_AGENT_INSTALLATION_IDS.filter((id) => available.has(id));
}

function normalizeResults(value: unknown): LocalAgentInstallationResult[] {
  if (!Array.isArray(value) || value.length > LOCAL_AGENT_INSTALLATION_IDS.length) {
    throw new Error("Invalid Local Agent installation results.");
  }
  const seen = new Set<string>();
  const byId = new Map<LocalAgentInstallationId, LocalAgentInstallationResult>();
  for (const raw of value) {
    const entry = requireRecord(raw, "result");
    if (typeof entry.agentId !== "string" || !installationIdSet.has(entry.agentId) || seen.has(entry.agentId)
      || typeof entry.displayName !== "string" || !entry.displayName.trim() || entry.displayName.length > 80
      || (entry.status !== "found" && entry.status !== "not-found" && entry.status !== "failed")) {
      throw new Error("Invalid Local Agent installation result.");
    }
    seen.add(entry.agentId);
    const agentId = entry.agentId as LocalAgentInstallationId;
    byId.set(agentId, {
      agentId,
      displayName: entry.displayName,
      status: entry.status,
      ...(safeToken(entry.reasonCode) ? { reasonCode: entry.reasonCode as string } : {}),
      ...(safeToken(entry.source) ? { source: entry.source as string } : {}),
    });
  }
  return LOCAL_AGENT_INSTALLATION_IDS.flatMap((id) => {
    const entry = byId.get(id);
    return entry ? [entry] : [];
  });
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid Local Agent installation ${label}.`);
  }
  return value as Record<string, unknown>;
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9:_-]{1,96}$/u.test(value);
}

function safeToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:/-]{1,80}$/u.test(value);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
