/** The two public entry points retain their existing validation error wording. */
export type PresetManifestDiagnostics = "main" | "renderer";

export type PresetViewerDefinition = Readonly<{
  contractVersion: 8;
  id: string;
  formatViewerIds: readonly string[];
  capability: "edit" | "preview" | "placeholder";
  source: "content" | "resource" | "resource-session" | "content-and-resource" | "none";
  runtime: "eager" | "lazy";
  surfaceIsolation: "inline" | "isolated-webcontents";
  computeIsolation: "main-thread" | "worker" | "browser-engine" | "native-process";
  contentSandbox: "none" | "sandboxed-frame";
  resourcePolicy: Readonly<{
    memoryClass: "small" | "medium" | "large";
    maxSourceBytes: number;
    maxCanvasPixels: number;
    maxActiveCanvases: number;
    maxWorkers: number;
  }>;
  recoveryPolicy: Readonly<{ maxAutomaticRetries: number; supportsSafeMode: boolean }>;
  surfacePreparation: "hidden-safe" | "requires-visible";
  readinessSignal: "dom-stable" | "decoded-resource" | "frame-paint" | "first-rendered-frame" | "media-metadata";
  surfaceFamily: "document" | "code" | "grid" | "canvas" | "media" | "embedded" | "fallback";
  surfaceTraits: readonly ("rich-text" | "monospace" | "tabular" | "scrollable" | "zoomable" | "paginated" | "sandboxed")[];
}>;

export type PresetViewerManifest = Readonly<{
  contractVersion: 8;
  fallbackViewerId: string;
  viewers: readonly PresetViewerDefinition[];
}>;

export function parsePresetViewerManifest(input: unknown, diagnostics?: PresetManifestDiagnostics): PresetViewerManifest;
export function parseDefinition(input: unknown, index: number, diagnostics?: PresetManifestDiagnostics): PresetViewerDefinition;
