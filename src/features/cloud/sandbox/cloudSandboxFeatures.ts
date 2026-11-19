import type { CloudSandbox, CloudSandboxFeature, CloudSandboxSettings } from "../files/contracts";

/**
 * Client entry points for sandbox Features. The backend catalog
 * (puppyone-cloud backend/src/platform/sandbox/catalog.py) decides which
 * Features a workspace has and whether policy allows them; this registry only
 * decides where an allowed Feature appears. Unknown Features are ignored, and a
 * registered Feature the server does not report stays hidden.
 */
export type CloudSandboxSlot = "sidebar-footer" | "editor-surface";

export type CloudSandboxContribution = {
  feature: string;
  slots: readonly CloudSandboxSlot[];
};

const CONTRIBUTIONS = [
  { feature: "screen_stream", slots: ["sidebar-footer", "editor-surface"] },
] as const satisfies readonly CloudSandboxContribution[];

const EMPTY: CloudSandbox = { profile: null, next_profile: null, settings: {}, features: [] };

/** Tolerates servers before Profiles and malformed rows: no Features, no entry points. */
export function readCloudSandbox(value: unknown): CloudSandbox {
  if (!value || typeof value !== "object") return EMPTY;
  const { profile, next_profile: next, settings, features } = value as Record<string, unknown>;
  return {
    profile: typeof profile === "string" ? profile : null,
    next_profile: typeof next === "string" ? next : null,
    settings: readSettings(settings),
    features: Array.isArray(features) ? features.filter(isFeature) : [],
  };
}

function readSettings(value: unknown): CloudSandboxSettings {
  if (!value || typeof value !== "object") return {};
  const { desktop, screen_stream: stream } = value as Record<string, unknown>;
  return {
    ...(typeof desktop === "boolean" ? { desktop } : {}),
    ...(typeof stream === "boolean" ? { screen_stream: stream } : {}),
  };
}

/** The resolved screen Feature, or null when this server does not know it. */
export function cloudScreenFeature(sandbox: CloudSandbox): CloudSandboxFeature | null {
  return sandbox.features.find(feature => feature.id === "screen_stream") ?? null;
}

function isFeature(value: unknown): value is CloudSandboxFeature {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && typeof item.enabled === "boolean";
}

export function cloudSandboxContributions(sandbox: CloudSandbox, slot?: CloudSandboxSlot): readonly CloudSandboxContribution[] {
  const enabled = new Set(sandbox.features.filter(feature => feature.enabled).map(feature => feature.id));
  return CONTRIBUTIONS.filter(item => enabled.has(item.feature)
    && (slot === undefined || (item.slots as readonly CloudSandboxSlot[]).includes(slot)));
}
