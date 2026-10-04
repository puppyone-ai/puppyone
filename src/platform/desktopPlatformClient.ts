import type { DesktopPlatformCapabilities } from "../types/electron";

let capabilityPromise: Promise<DesktopPlatformCapabilities | null> | null = null;
let capabilitySnapshot: DesktopPlatformCapabilities | null = null;

/** Reuse resolved host identity when a menu mounts after application startup. */
export function getDesktopPlatformCapabilitiesSnapshot(): DesktopPlatformCapabilities | null {
  return capabilitySnapshot;
}

export function readDesktopPlatformCapabilities(): Promise<DesktopPlatformCapabilities | null> {
  if (capabilityPromise) return capabilityPromise;
  const bridge = window.puppyoneDesktop;
  const request = bridge?.getPlatformCapabilities
    ? bridge.getPlatformCapabilities().catch((error) => {
        console.warn("Unable to read PuppyOne Desktop platform capabilities:", error);
        return null;
      })
    : Promise.resolve(null);
  const pending = request.then(value => {
    if (capabilityPromise === pending) capabilitySnapshot = value;
    return value;
  });
  capabilityPromise = pending;
  return capabilityPromise;
}

export function resetDesktopPlatformCapabilitiesForTests() {
  capabilityPromise = null;
  capabilitySnapshot = null;
}
