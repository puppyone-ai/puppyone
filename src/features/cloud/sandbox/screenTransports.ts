import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { CloudScreenSession } from "../files/contracts";

/** What a viewer reports; the screen view owns retries and copy. */
export type CloudScreenViewerStatus = "connecting" | "connected" | "disconnected";

export type CloudScreenViewerProps = {
  session: CloudScreenSession;
  interactive?: boolean;
  onStatus: (status: CloudScreenViewerStatus) => void;
};

/**
 * Viewers by wire format. The backend's screen Feature names its transport;
 * adding one (for example WebRTC) is one entry here, never a change to the
 * screen view. Viewers load only when a screen is opened.
 */
const TRANSPORTS: Readonly<Record<string, LazyExoticComponent<ComponentType<CloudScreenViewerProps>>>> = {
  vnc: lazy(() => import("./VncScreenViewer").then(module => ({ default: module.VncScreenViewer }))),
};

export function cloudScreenViewer(transport: string | null | undefined) {
  return transport ? TRANSPORTS[transport] ?? null : null;
}
