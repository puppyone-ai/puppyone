/**
 * Versioned Viewer Host API v1 — types + channel constants only.
 * Runtime validation lives in the main-process plugin bridge. Shared-ui never
 * imports Electron; the plugin preload (electron/plugin-preload.cjs) is the
 * only surface that wires these channels to `window.puppyoneViewer`.
 */

export type ViewerHostApiVersion = 1;

/**
 * Plugin-frame bridge channels. These are served by RAW `ipcMain` handlers
 * (never `trustedIpcMain`, which rejects non-app frame URLs) with a
 * sender → session validation step in the main process.
 */
export const VIEWER_HOST_IPC_CHANNELS = Object.freeze({
  documentGetMeta: "viewer-pack:document-get-meta",
  resourceOpen: "viewer-pack:resource-open",
  resourceReadRange: "viewer-pack:resource-read-range",
  resourceCreateRangeUrl: "viewer-pack:resource-create-range-url",
  resourceClose: "viewer-pack:resource-close",
  uiSetState: "viewer-pack:ui-set-state",
  uiGetTheme: "viewer-pack:ui-get-theme",
} as const);

export type ViewerHostIpcChannel =
  (typeof VIEWER_HOST_IPC_CHANNELS)[keyof typeof VIEWER_HOST_IPC_CHANNELS];

export type ViewerDocumentMeta = {
  id: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number;
  revision: string | null;
};

export type ViewerResourceHandleMeta = {
  handle: string;
  sizeBytes: number;
  supportsRange: true;
};

export type ViewerResourceRangeRequest = {
  handle: string;
  offset: number;
  length: number;
};

/** A bounded slice of the resource, transferred as raw bytes. */
export type ViewerResourceChunk = Uint8Array;

export type ViewerResourceApiV1 = {
  open(): Promise<ViewerResourceHandleMeta>;
  readRange(request: ViewerResourceRangeRequest): Promise<ViewerResourceChunk>;
  createRangeUrl(handle: string): Promise<string>;
  close(handle: string): Promise<void>;
};

export type ViewerStatus = "loading" | "ready" | "error";

export type ViewerThemeMode = "light" | "dark";

export type ViewerThemeSnapshot = {
  mode: ViewerThemeMode;
  tokens: Record<string, string>;
};

export type ViewerHostUiState = {
  status: ViewerStatus;
  message?: string;
  progress?: number;
};

export type ViewerHostApiV1 = {
  version: ViewerHostApiVersion;
  document: {
    getMeta(): Promise<ViewerDocumentMeta>;
  };
  resource: ViewerResourceApiV1;
  ui: {
    setState(state: ViewerHostUiState): void;
    getTheme(): Promise<ViewerThemeSnapshot>;
  };
};

declare global {
  interface Window {
    puppyoneViewer?: ViewerHostApiV1;
  }
}

export {};
