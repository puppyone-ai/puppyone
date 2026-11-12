import type { CloudSandbox, CloudSandboxFeature } from "../files/contracts";

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
  { feature: "desktop_screen", slots: ["sidebar-footer", "editor-surface"] },
] as const satisfies readonly CloudSandboxContribution[];

const EMPTY: CloudSandbox = { profile: null, features: [] };

/** Tolerates servers before Profiles and malformed rows: no Features, no entry points. */
export function readCloudSandbox(value: unknown): CloudSandbox {
  if (!value || typeof value !== "object") return EMPTY;
  const { profile, features } = value as { profile?: unknown; features?: unknown };
  return {
    profile: typeof profile === "string" ? profile : null,
    features: Array.isArray(features) ? features.filter(isFeature) : [],
  };
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
