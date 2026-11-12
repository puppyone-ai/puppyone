import type { CloudSandbox } from "../files/contracts";
import { cloudScreenFeature } from "./cloudSandboxFeatures";

/** What the screen view shows before any connection, from the resolved sandbox alone. */
export type CloudScreenAvailability =
  | { kind: "stream"; transport: string }
  | { kind: "preview" }
  | { kind: "install"; pending: boolean }
  | { kind: "stream_off" }
  | { kind: "unavailable" };

export function cloudScreenAvailability(sandbox: CloudSandbox): CloudScreenAvailability {
  const feature = cloudScreenFeature(sandbox);
  if (feature?.preview) return { kind: "preview" };
  if (!feature || feature.reason === "not_installed" || (feature.reason === "requires" && !feature.installed)) {
    // The owner may already have chosen a desktop; it arrives with the next computer.
    return { kind: "install", pending: sandbox.next_profile === "desktop" };
  }
  if (feature.reason === "user_disabled") return { kind: "stream_off" };
  if (!feature.enabled || !feature.transport) return { kind: "unavailable" };
  return { kind: "stream", transport: feature.transport };
}

/** Reconnects after a drop before asking the user; each attempt gets a new ticket. */
export const CLOUD_SCREEN_RECONNECTS = 3;
