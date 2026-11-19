/**
 * Serializable Viewer Pack contribution types.
 * Shared-ui only — no Electron imports. Main process validates and publishes
 * immutable snapshots; renderers never scan the pack store.
 */

import type { DocumentSourceKind } from "../documentSource";
import type { CoreViewerCapability } from "./viewerContract";

export type { CoreViewerCapability } from "./viewerContract";

export const VIEWER_PACK_API_VERSION = 1 as const;
export const VIEWER_PACK_SCHEMA_VERSION = 1 as const;

export type ViewerDocumentSourceKind = DocumentSourceKind;
export type { DocumentSourceKind } from "../documentSource";

export type ViewerPackPermissionCurrentDocument = "metadata" | "readRange";

export type ViewerPackManifestPermissions = {
  currentDocument: readonly ViewerPackPermissionCurrentDocument[];
  relatedFiles: "none";
  network: readonly string[];
};

export type ViewerPackFormatContribution = {
  id: string;
  label: string;
  extensions: readonly string[];
  mimeTypes: readonly string[];
  category: string;
  defaultViewer: string;
  editable: false;
};

export type ViewerPackViewerContribution = {
  entry: string;
  source: "range-resource" | "resource" | "none";
  sources: readonly ("local")[];
  runtime: readonly ("worker" | "webgl" | "webgpu" | "wasm")[];
};

export type ViewerPackManifest = {
  schemaVersion: typeof VIEWER_PACK_SCHEMA_VERSION;
  id: string;
  publisher: string;
  version: string;
  engines: {
    puppyone: string;
    viewerApi: string;
  };
  activationEvents: readonly string[];
  viewer: ViewerPackViewerContribution;
  formats: readonly ViewerPackFormatContribution[];
  permissions: ViewerPackManifestPermissions;
};

/**
 * One enabled pack contribution published in a registry snapshot. `label` is a
 * user-facing display string derived by the main-process registry so the
 * renderer never has to inspect raw manifest bytes.
 */
export type ViewerPackContribution = {
  pluginId: string;
  publisher: string;
  version: string;
  label: string;
  enabled: boolean;
  contentHash: string;
  viewer: ViewerPackViewerContribution;
  formats: readonly ViewerPackFormatContribution[];
  permissions: ViewerPackManifestPermissions;
  installedAt: string;
};

/** Public alias used across the editor/router surface. */
export type ViewerContribution = ViewerPackContribution;

/** Immutable snapshot published by the main-process registry. */
export type ViewerPackContributionSnapshot = {
  sequence: number;
  generatedAt: string;
  contributions: readonly ViewerPackContribution[];
};

/** Public alias used across the editor/router surface. */
export type ViewerPackSnapshot = ViewerPackContributionSnapshot;

/** The canonical empty snapshot — used before the host publishes anything. */
export const EMPTY_VIEWER_PACK_SNAPSHOT: ViewerPackSnapshot = Object.freeze({
  sequence: 0,
  generatedAt: "1970-01-01T00:00:00.000Z",
  contributions: Object.freeze([]) as readonly ViewerPackContribution[],
});

/** Lightweight identity for an installed pack (management surfaces). */
export type ViewerPackDescriptor = {
  pluginId: string;
  publisher: string;
  version: string;
  label: string;
  contentHash: string;
};

/** Reasons a placeholder-grade document cannot resolve to a rendering surface. */
export type ViewerRoutePlaceholderReason =
  | "cloud-source"
  | "no-match"
  | "disabled"
  | "incompatible"
  | "revoked";

export type ViewerPackCatalogRecommendation = {
  id: string;
  publisher: string;
  version: string;
  label: string;
  sizeBytes: number;
  permissionsSummary: {
    network: boolean;
    relatedFiles: "none" | "same-directory";
  };
};

export type ViewerRouteResult =
  | {
      kind: "core";
      viewerId: string;
      capability: CoreViewerCapability;
    }
  | {
      kind: "plugin";
      pluginId: string;
      version: string;
      contentHash: string;
      entry: string;
      contribution: ViewerContribution;
    }
  | {
      kind: "chooser";
      candidates: readonly ViewerContribution[];
    }
  | {
      kind: "install-cta";
      recommendations: readonly ViewerPackCatalogRecommendation[];
    }
  | {
      kind: "unsupported";
      reason: ViewerRoutePlaceholderReason;
    };

export type ViewerPackSessionDescriptor = {
  sessionId: string;
  pluginId: string;
  version: string;
  contentHash: string;
  documentPath: string;
  ownerWebContentsId: number;
  instanceId: string;
};

export type ViewerPackHostSurfaceProps = {
  session: ViewerPackSessionDescriptor | null;
  documentPath: string;
  documentName: string;
  onBoundsChange?: (bounds: { x: number; y: number; width: number; height: number }) => void;
};
