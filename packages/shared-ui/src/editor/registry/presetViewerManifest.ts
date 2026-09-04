import manifestJson from "./presetViewerManifest.json";
import {
  PRESET_VIEWER_CAPABILITIES,
  PRESET_VIEWER_COMPUTE_ISOLATIONS,
  PRESET_VIEWER_CONTENT_SANDBOXES,
  PRESET_VIEWER_CONTRACT_VERSION,
  PRESET_VIEWER_MEMORY_CLASSES,
  PRESET_VIEWER_RUNTIMES,
  PRESET_VIEWER_SOURCES,
  PRESET_VIEWER_SURFACE_ISOLATIONS,
  VIEWER_SURFACE_PREPARATIONS,
  VIEWER_SURFACE_READINESS_SIGNALS,
  VIEWER_SURFACE_FAMILIES,
  VIEWER_SURFACE_TRAITS,
  type CoreViewerCapability,
  type PresetViewerComputeIsolation,
  type PresetViewerContentSandbox,
  type PresetViewerContractVersion,
  type PresetViewerRecoveryPolicy,
  type PresetViewerResourcePolicy,
  type PresetViewerRuntime,
  type PresetViewerSource,
  type PresetViewerSurfaceIsolation,
  type ViewerSurfacePreparation,
  type ViewerSurfaceReadinessSignal,
  type ViewerSurfaceFamily,
  type ViewerSurfaceTrait,
} from "./viewerContract";

export type PresetViewerDefinition = Readonly<{
  contractVersion: PresetViewerContractVersion;
  id: string;
  formatViewerIds: readonly string[];
  capability: CoreViewerCapability;
  source: PresetViewerSource;
  runtime: PresetViewerRuntime;
  surfaceIsolation: PresetViewerSurfaceIsolation;
  computeIsolation: PresetViewerComputeIsolation;
  contentSandbox: PresetViewerContentSandbox;
  resourcePolicy: PresetViewerResourcePolicy;
  recoveryPolicy: PresetViewerRecoveryPolicy;
  surfacePreparation: ViewerSurfacePreparation;
  readinessSignal: ViewerSurfaceReadinessSignal;
  surfaceFamily: ViewerSurfaceFamily;
  surfaceTraits: readonly ViewerSurfaceTrait[];
}>;

export type PresetViewerManifest = Readonly<{
  contractVersion: PresetViewerContractVersion;
  fallbackViewerId: string;
  viewers: readonly PresetViewerDefinition[];
}>;

const VIEWER_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const MANIFEST_KEYS = new Set(["contractVersion", "fallbackViewerId", "viewers"]);
const DEFINITION_KEYS = new Set([
  "id",
  "formatViewerIds",
  "capability",
  "source",
  "runtime",
  "surfaceIsolation",
  "computeIsolation",
  "contentSandbox",
  "resourcePolicy",
  "recoveryPolicy",
  "surfacePreparation",
  "readinessSignal",
  "surfaceFamily",
  "surfaceTraits",
]);

export const PRESET_VIEWER_MANIFEST = parsePresetViewerManifest(manifestJson);

const definitionsById = new Map(
  PRESET_VIEWER_MANIFEST.viewers.map((definition) => [definition.id, definition]),
);
const definitionsByViewerId = new Map<string, PresetViewerDefinition>();

for (const definition of PRESET_VIEWER_MANIFEST.viewers) {
  definitionsByViewerId.set(definition.id, definition);
  for (const viewerId of definition.formatViewerIds) {
    definitionsByViewerId.set(viewerId, definition);
  }
}

export function getPresetViewerDefinition(id: string): PresetViewerDefinition {
  const definition = definitionsById.get(id);
  if (!definition) {
    throw new TypeError(`Preset viewer ${id || "<empty>"} is not declared in the canonical manifest.`);
  }
  return definition;
}

/**
 * Resolves both canonical contribution ids and file-format `defaultViewer`
 * ids through the same serializable manifest consumed by Electron main.
 */
export function getPresetViewerDefinitionForViewerId(
  viewerId: string,
): PresetViewerDefinition {
  const definition = definitionsByViewerId.get(viewerId);
  if (!definition) {
    throw new TypeError(`Core viewer ${viewerId || "<empty>"} is not declared in the canonical manifest.`);
  }
  return definition;
}

export function coreViewerCapability(viewerId: string): CoreViewerCapability {
  return getPresetViewerDefinitionForViewerId(viewerId).capability;
}

function parsePresetViewerManifest(input: unknown): PresetViewerManifest {
  const record = assertRecord(input, "Preset viewer manifest");
  assertExactKeys(record, MANIFEST_KEYS, "Preset viewer manifest");
  if (record.contractVersion !== PRESET_VIEWER_CONTRACT_VERSION) {
    throw new TypeError("Preset viewer manifest uses an unsupported contract version.");
  }
  if (typeof record.fallbackViewerId !== "string" || !VIEWER_ID_PATTERN.test(record.fallbackViewerId)) {
    throw new TypeError("Preset viewer manifest has an invalid fallback viewer id.");
  }
  if (!Array.isArray(record.viewers) || record.viewers.length === 0) {
    throw new TypeError("Preset viewer manifest must declare at least one viewer.");
  }

  const ids = new Set<string>();
  const allViewerIds = new Set<string>();
  const viewers = record.viewers.map((rawDefinition, index) => {
    const definition = parseDefinition(rawDefinition, index);
    if (ids.has(definition.id)) {
      throw new TypeError(`Preset viewer manifest declares ${definition.id} more than once.`);
    }
    ids.add(definition.id);
    for (const viewerId of [definition.id, ...definition.formatViewerIds]) {
      if (allViewerIds.has(viewerId)) {
        throw new TypeError(`Core viewer id ${viewerId} maps to more than one preset viewer.`);
      }
      allViewerIds.add(viewerId);
    }
    return definition;
  });

  const fallback = viewers.find((definition) => definition.id === record.fallbackViewerId);
  if (!fallback || fallback.capability !== "placeholder" || fallback.source !== "none") {
    throw new TypeError("Preset viewer fallback must be a declared placeholder with source 'none'.");
  }
  if (viewers.filter((definition) => definition.capability === "placeholder").length !== 1) {
    throw new TypeError("Preset viewer manifest must declare exactly one placeholder fallback.");
  }

  return Object.freeze({
    contractVersion: PRESET_VIEWER_CONTRACT_VERSION,
    fallbackViewerId: record.fallbackViewerId,
    viewers: Object.freeze(viewers),
  });
}

function parseDefinition(input: unknown, index: number): PresetViewerDefinition {
  const label = `Preset viewer definition at index ${index}`;
  const record = assertRecord(input, label);
  assertExactKeys(record, DEFINITION_KEYS, label);
  if (typeof record.id !== "string" || !VIEWER_ID_PATTERN.test(record.id)) {
    throw new TypeError(`${label} has an invalid id.`);
  }
  if (!Array.isArray(record.formatViewerIds) || record.formatViewerIds.some(
    (viewerId) => typeof viewerId !== "string" || !VIEWER_ID_PATTERN.test(viewerId),
  )) {
    throw new TypeError(`Preset viewer ${record.id} has invalid format viewer ids.`);
  }
  if (new Set(record.formatViewerIds).size !== record.formatViewerIds.length) {
    throw new TypeError(`Preset viewer ${record.id} repeats a format viewer id.`);
  }
  if (!PRESET_VIEWER_CAPABILITIES.includes(record.capability as never)) {
    throw new TypeError(`Preset viewer ${record.id} has an unsupported capability.`);
  }
  if (!PRESET_VIEWER_SOURCES.includes(record.source as never)) {
    throw new TypeError(`Preset viewer ${record.id} has an unsupported source requirement.`);
  }
  if (!PRESET_VIEWER_RUNTIMES.includes(record.runtime as never)) {
    throw new TypeError(`Preset viewer ${record.id} has an unsupported runtime boundary.`);
  }
  if (!PRESET_VIEWER_SURFACE_ISOLATIONS.includes(record.surfaceIsolation as never)) {
    throw new TypeError(`Preset viewer ${record.id} has an unsupported surface isolation boundary.`);
  }
  if (!PRESET_VIEWER_COMPUTE_ISOLATIONS.includes(record.computeIsolation as never)) {
    throw new TypeError(`Preset viewer ${record.id} has an unsupported compute isolation boundary.`);
  }
  if (!PRESET_VIEWER_CONTENT_SANDBOXES.includes(record.contentSandbox as never)) {
    throw new TypeError(`Preset viewer ${record.id} has an unsupported content sandbox boundary.`);
  }
  const resourcePolicy = parseResourcePolicy(record.resourcePolicy, record.id);
  const recoveryPolicy = parseRecoveryPolicy(record.recoveryPolicy, record.id);
  if (!VIEWER_SURFACE_PREPARATIONS.includes(record.surfacePreparation as never)) {
    throw new TypeError(`Preset viewer ${record.id} has an unsupported surface preparation policy.`);
  }
  if (!VIEWER_SURFACE_READINESS_SIGNALS.includes(record.readinessSignal as never)) {
    throw new TypeError(`Preset viewer ${record.id} has an unsupported readiness signal.`);
  }
  if (!VIEWER_SURFACE_FAMILIES.includes(record.surfaceFamily as never)) {
    throw new TypeError(`Preset viewer ${record.id} has an unsupported surface family.`);
  }
  if (!Array.isArray(record.surfaceTraits) || record.surfaceTraits.some(
    (trait) => !VIEWER_SURFACE_TRAITS.includes(trait as never),
  )) {
    throw new TypeError(`Preset viewer ${record.id} has unsupported surface traits.`);
  }
  if (new Set(record.surfaceTraits).size !== record.surfaceTraits.length) {
    throw new TypeError(`Preset viewer ${record.id} repeats a surface trait.`);
  }

  const capability = record.capability as CoreViewerCapability;
  const source = record.source as PresetViewerSource;
  if (capability === "edit" && source === "none") {
    throw new TypeError(`Editable preset viewer ${record.id} must receive content or a resource.`);
  }
  if (capability === "preview" && source === "none") {
    throw new TypeError(`Preview preset viewer ${record.id} must declare a content or resource source.`);
  }
  if (capability === "placeholder" && source !== "none") {
    throw new TypeError(`Placeholder preset viewer ${record.id} must use source 'none'.`);
  }
  if (source === "none" && resourcePolicy.maxSourceBytes !== 0) {
    throw new TypeError(`Metadata-only preset viewer ${record.id} cannot declare a source byte budget.`);
  }
  if (source !== "none" && resourcePolicy.maxSourceBytes === 0) {
    throw new TypeError(`Preset viewer ${record.id} must declare a positive source byte budget.`);
  }
  if (record.computeIsolation === "worker" && resourcePolicy.maxWorkers === 0) {
    throw new TypeError(`Worker-compute preset viewer ${record.id} must declare at least one worker.`);
  }
  if (record.computeIsolation === "main-thread" && resourcePolicy.maxWorkers !== 0) {
    throw new TypeError(`Main-thread preset viewer ${record.id} cannot declare worker capacity.`);
  }
  if (record.computeIsolation === "browser-engine") {
    if (record.surfaceIsolation !== "isolated-webcontents") {
      throw new TypeError(`Browser-engine preset viewer ${record.id} must use an isolated surface.`);
    }
    if (record.source !== "resource" || record.runtime !== "eager") {
      throw new TypeError(`Browser-engine preset viewer ${record.id} must eagerly navigate to a resource.`);
    }
    if (
      resourcePolicy.maxWorkers !== 0
      || resourcePolicy.maxCanvasPixels !== 0
      || resourcePolicy.maxActiveCanvases !== 0
    ) {
      throw new TypeError(`Browser-engine preset viewer ${record.id} cannot declare app-owned worker or Canvas budgets.`);
    }
  }
  if (record.computeIsolation === "worker" && record.runtime !== "lazy") {
    throw new TypeError(`Worker-compute preset viewer ${record.id} must keep its runtime lazy.`);
  }
  if (
    record.contentSandbox === "sandboxed-frame"
    && !(record.surfaceTraits as unknown[]).includes("sandboxed")
  ) {
    throw new TypeError(`Sandboxed-frame preset viewer ${record.id} must declare the sandboxed trait.`);
  }
  if (
    record.contentSandbox === "none"
    && (record.surfaceTraits as unknown[]).includes("sandboxed")
  ) {
    throw new TypeError(`Preset viewer ${record.id} cannot claim a sandboxed trait without a sandbox boundary.`);
  }
  if (recoveryPolicy.supportsSafeMode && record.surfaceIsolation !== "isolated-webcontents") {
    throw new TypeError(`Safe-mode preset viewer ${record.id} must use an isolated surface.`);
  }
  if (
    record.computeIsolation !== "browser-engine"
    && (record.surfaceFamily === "canvas" || (record.surfaceTraits as unknown[]).includes("paginated"))
    && (resourcePolicy.maxCanvasPixels === 0 || resourcePolicy.maxActiveCanvases === 0)
  ) {
    throw new TypeError(`Canvas or paginated preset viewer ${record.id} must declare positive Canvas limits.`);
  }

  return Object.freeze({
    contractVersion: PRESET_VIEWER_CONTRACT_VERSION,
    id: record.id,
    formatViewerIds: Object.freeze([...record.formatViewerIds]) as readonly string[],
    capability,
    source,
    runtime: record.runtime as PresetViewerRuntime,
    surfaceIsolation: record.surfaceIsolation as PresetViewerSurfaceIsolation,
    computeIsolation: record.computeIsolation as PresetViewerComputeIsolation,
    contentSandbox: record.contentSandbox as PresetViewerContentSandbox,
    resourcePolicy,
    recoveryPolicy,
    surfacePreparation: record.surfacePreparation as ViewerSurfacePreparation,
    readinessSignal: record.readinessSignal as ViewerSurfaceReadinessSignal,
    surfaceFamily: record.surfaceFamily as ViewerSurfaceFamily,
    surfaceTraits: Object.freeze([...record.surfaceTraits]) as readonly ViewerSurfaceTrait[],
  });
}

function parseResourcePolicy(input: unknown, viewerId: unknown): PresetViewerResourcePolicy {
  const label = `Preset viewer ${String(viewerId)} resource policy`;
  const record = assertRecord(input, label);
  assertExactKeys(
    record,
    new Set(["memoryClass", "maxSourceBytes", "maxCanvasPixels", "maxActiveCanvases", "maxWorkers"]),
    label,
  );
  if (!PRESET_VIEWER_MEMORY_CLASSES.includes(record.memoryClass as never)) {
    throw new TypeError(`${label} has an unsupported memory class.`);
  }
  for (const key of ["maxSourceBytes", "maxCanvasPixels", "maxActiveCanvases", "maxWorkers"] as const) {
    if (!Number.isSafeInteger(record[key]) || (record[key] as number) < 0) {
      throw new TypeError(`${label} ${key} must be a non-negative safe integer.`);
    }
  }
  return Object.freeze({
    memoryClass: record.memoryClass as PresetViewerResourcePolicy["memoryClass"],
    maxSourceBytes: record.maxSourceBytes as number,
    maxCanvasPixels: record.maxCanvasPixels as number,
    maxActiveCanvases: record.maxActiveCanvases as number,
    maxWorkers: record.maxWorkers as number,
  });
}

function parseRecoveryPolicy(input: unknown, viewerId: unknown): PresetViewerRecoveryPolicy {
  const label = `Preset viewer ${String(viewerId)} recovery policy`;
  const record = assertRecord(input, label);
  assertExactKeys(record, new Set(["maxAutomaticRetries", "supportsSafeMode"]), label);
  if (
    !Number.isSafeInteger(record.maxAutomaticRetries)
    || (record.maxAutomaticRetries as number) < 0
    || (record.maxAutomaticRetries as number) > 1
  ) {
    throw new TypeError(`${label} maxAutomaticRetries must be zero or one.`);
  }
  if (typeof record.supportsSafeMode !== "boolean") {
    throw new TypeError(`${label} supportsSafeMode must be a boolean.`);
  }
  return Object.freeze({
    maxAutomaticRetries: record.maxAutomaticRetries as number,
    supportsSafeMode: record.supportsSafeMode,
  });
}

function assertRecord(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return input as Record<string, unknown>;
}

function assertExactKeys(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
) {
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new TypeError(`${label} has unknown field(s): ${unknown.join(", ")}.`);
  }
}
