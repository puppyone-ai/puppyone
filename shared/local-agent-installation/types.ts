export const LOCAL_AGENT_INSTALLATION_IDS = [
  "codex",
  "claude",
  "cursor",
  "opencode",
  "pi",
  "hermes",
] as const;

export type LocalAgentInstallationId = typeof LOCAL_AGENT_INSTALLATION_IDS[number];
export type LocalAgentInstallationStatus = "found" | "not-found" | "failed";

export type LocalAgentInstallationResult = {
  agentId: LocalAgentInstallationId;
  displayName: string;
  status: LocalAgentInstallationStatus;
  reasonCode?: string;
  source?: string;
};

export type LocalAgentInstallationSnapshot = {
  schemaVersion: 1;
  generation: number;
  scanId: string;
  requestedAt: string;
  completedAt: string;
  source: "scan" | "memory-cache";
  availableAgentIds: LocalAgentInstallationId[];
  results: LocalAgentInstallationResult[];
};

export type LocalAgentInstallationProgressEvent = {
  requestId: string;
  scanId: string;
  generation: number;
  completedAgentCount: number;
  totalAgentCount: number;
  availableAgentIds: LocalAgentInstallationId[];
  results: LocalAgentInstallationResult[];
};
