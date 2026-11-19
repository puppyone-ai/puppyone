import type { ReactNode } from "react";
import type { EditorDocument } from "./viewerTypes";
import type { ViewerContribution, ViewerPackSnapshot } from "./viewerPackTypes";

/**
 * Host-owned renderer for an activated external viewer surface. Shared UI only
 * invokes the adapter; Electron session creation remains outside this package.
 */
export type ExternalViewerSurfaceRenderer = (request: {
  document: EditorDocument;
  contribution: ViewerContribution;
}) => ReactNode;

export type ViewerExtensionInstallFallbackRenderer = (request: {
  document: EditorDocument;
}) => ReactNode;

/**
 * One optional composition-boundary port for external viewer extensions.
 * Preset viewers never receive this authority in their render context.
 */
export type ViewerExtensionHostAdapter = Readonly<{
  snapshot: ViewerPackSnapshot;
  renderSurface?: ExternalViewerSurfaceRenderer | null;
  renderInstallFallback?: ViewerExtensionInstallFallbackRenderer | null;
}>;
