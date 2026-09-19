import type { LocalAgentInstallationId } from "./types";

export type LocalAgentSetupPreferences = {
  enabled: boolean;
  dismissedSetupIds: string[];
  snoozedUntil: Record<string, number>;
};
export type LocalAgentSetupRequest = {
  clientId: string;
  surface: "chat" | "terminal";
  eligibleInstallationIds: readonly string[];
  hiddenAgentIds: readonly string[];
  preferences: LocalAgentSetupPreferences;
  refreshPresence: boolean;
};
export type LocalAgentSetupEntry = {
  setupId: string;
  installationId: LocalAgentInstallationId;
  displayName: string;
  strategy: "external-cli" | "app-bundled-runtime" | "companion-managed-runtime";
  status: "found" | "not-found" | "unknown";
  companionPresent: boolean;
  recommended: boolean;
};
export type LocalAgentSetupSnapshot = {
  revision: string;
  installationGeneration: number;
  entries: LocalAgentSetupEntry[];
};
export type LocalAgentSetupAction = {
  clientId: string;
  revision: string;
  setupId: string;
  actionId: "open-guide";
  mode: "manual" | "recommendation";
};
export type LocalAgentSetupActionResult = { status: "guide-opened" | "detected" | "stale" | "failed" };
