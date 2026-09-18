import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const manifestJson = require("../../../packages/shared-ui/src/editor/registry/presetViewerManifest.json");

const CONTRACT_VERSION = 8;
const CAPABILITIES = new Set(["edit", "preview", "placeholder"]);
const SOURCES = new Set(["content", "resource", "resource-session", "content-and-resource", "none"]);
const RUNTIMES = new Set(["eager", "lazy"]);
const SURFACE_ISOLATIONS = new Set(["inline", "isolated-webcontents"]);
const COMPUTE_ISOLATIONS = new Set(["main-thread", "worker", "browser-engine", "native-process"]);
const CONTENT_SANDBOXES = new Set(["none", "sandboxed-frame"]);
const MEMORY_CLASSES = new Set(["small", "medium", "large"]);
const SURFACE_PREPARATIONS = new Set(["hidden-safe", "requires-visible"]);
const READINESS_SIGNALS = new Set([
  "dom-stable",
  "decoded-resource",
  "frame-paint",
  "first-rendered-frame",
  "media-metadata",
]);
const SURFACE_FAMILIES = new Set([
  "document",
  "code",
  "grid",
  "canvas",
  "media",
  "embedded",
  "fallback",
]);
const SURFACE_TRAITS = new Set([
  "rich-text",
  "monospace",
  "tabular",
  "scrollable",
  "zoomable",
  "paginated",
  "sandboxed",
]);
const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
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

export const PRESET_VIEWER_MANIFEST = parseManifest(manifestJson);

const definitionsByViewerId = new Map();
for (const definition of PRESET_VIEWER_MANIFEST.viewers) {
  definitionsByViewerId.set(definition.id, definition);
  for (const viewerId of definition.formatViewerIds) {
    definitionsByViewerId.set(viewerId, definition);
  }
}

export function getPresetViewerDefinitionForViewerId(viewerId) {
  const definition = definitionsByViewerId.get(viewerId);
  if (!definition) {
    throw new TypeError(`Core viewer ${viewerId || "<empty>"} is not declared in the canonical manifest.`);
  }
  return definition;
}

export function capabilityForCoreViewer(viewerId) {
  return getPresetViewerDefinitionForViewerId(viewerId).capability;
}

function parseManifest(input) {
  const record = assertRecord(input, "Preset viewer manifest");
  assertExactKeys(record, MANIFEST_KEYS, "Preset viewer manifest");
  if (record.contractVersion !== CONTRACT_VERSION) {
    throw new TypeError("Preset viewer manifest uses an unsupported contract version.");
  }
  if (typeof record.fallbackViewerId !== "string" || !ID_PATTERN.test(record.fallbackViewerId)) {
    throw new TypeError("Preset viewer manifest has an invalid fallback viewer id.");
  }
  if (!Array.isArray(record.viewers) || record.viewers.length === 0) {
    throw new TypeError("Preset viewer manifest must declare at least one viewer.");
  }

  const canonicalIds = new Set();
  const allViewerIds = new Set();
  const viewers = record.viewers.map((raw, index) => {
    const definition = parseDefinition(raw, index);
    if (canonicalIds.has(definition.id)) {
      throw new TypeError(`Preset viewer manifest declares ${definition.id} more than once.`);
    }
    canonicalIds.add(definition.id);
    for (const viewerId of [definition.id, ...definition.formatViewerIds]) {
      if (allViewerIds.has(viewerId)) {
        throw new TypeError(`Core viewer id ${viewerId} maps to more than one preset viewer.`);
      }
      allViewerIds.add(viewerId);
    }
    return definition;
  });

  const fallback = viewers.find(({ id }) => id === record.fallbackViewerId);
  if (!fallback || fallback.capability !== "placeholder" || fallback.source !== "none") {
    throw new TypeError("Preset viewer fallback must be a declared placeholder with source 'none'.");
  }
  if (viewers.filter(({ capability }) => capability === "placeholder").length !== 1) {
    throw new TypeError("Preset viewer manifest must declare exactly one placeholder fallback.");
  }

  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    fallbackViewerId: record.fallbackViewerId,
    viewers: Object.freeze(viewers),
  });
}

function parseDefinition(input, index) {
  const label = `Preset viewer definition at index ${index}`;
  const record = assertRecord(input, label);
  assertExactKeys(record, DEFINITION_KEYS, label);
  if (typeof record.id !== "string" || !ID_PATTERN.test(record.id)) {
    throw new TypeError(`${label} has an invalid id.`);
  }
  if (
    !Array.isArray(record.formatViewerIds) ||
    record.formatViewerIds.some((id) => typeof id !== "string" || !ID_PATTERN.test(id)) ||
    new Set(record.formatViewerIds).size !== record.formatViewerIds.length
  ) {
    throw new TypeError(`Preset viewer ${record.id} has invalid or repeated format viewer ids.`);
  }
  if (!CAPABILITIES.has(record.capability)) {
    throw new TypeError(`Preset viewer ${record.id} has an unsupported capability.`);
  }
  if (!SOURCES.has(record.source)) {
    throw new TypeError(`Preset viewer ${record.id} has an unsupported source requirement.`);
  }
  if (!RUNTIMES.has(record.runtime)) {
    throw new TypeError(`Preset viewer ${record.id} has an unsupported runtime boundary.`);
  }
  if (!SURFACE_ISOLATIONS.has(record.surfaceIsolation)) {
    throw new TypeError(`Preset viewer ${record.id} has an unsupported surface isolation boundary.`);
  }
  if (!COMPUTE_ISOLATIONS.has(record.computeIsolation)) {
    throw new TypeError(`Preset viewer ${record.id} has an unsupported compute isolation boundary.`);
  }
  if (!CONTENT_SANDBOXES.has(record.contentSandbox)) {
    throw new TypeError(`Preset viewer ${record.id} has an unsupported content sandbox boundary.`);
  }
  const resourcePolicy = parseResourcePolicy(record.resourcePolicy, record.id);
  const recoveryPolicy = parseRecoveryPolicy(record.recoveryPolicy, record.id);
  if (!SURFACE_PREPARATIONS.has(record.surfacePreparation)) {
    throw new TypeError(`Preset viewer ${record.id} has an unsupported surface preparation policy.`);
  }
  if (!READINESS_SIGNALS.has(record.readinessSignal)) {
    throw new TypeError(`Preset viewer ${record.id} has an unsupported readiness signal.`);
  }
  if (!SURFACE_FAMILIES.has(record.surfaceFamily)) {
    throw new TypeError(`Preset viewer ${record.id} has an unsupported surface family.`);
  }
  if (
    !Array.isArray(record.surfaceTraits)
    || record.surfaceTraits.some((trait) => !SURFACE_TRAITS.has(trait))
    || new Set(record.surfaceTraits).size !== record.surfaceTraits.length
  ) {
    throw new TypeError(`Preset viewer ${record.id} has unsupported or repeated surface traits.`);
  }
  if (record.capability === "edit" && record.source === "none") {
    throw new TypeError(`Editable preset viewer ${record.id} must receive content or a resource.`);
  }
  if (record.capability === "preview" && record.source === "none") {
    throw new TypeError(`Preview preset viewer ${record.id} must declare a content or resource source.`);
  }
  if (record.capability === "placeholder" && record.source !== "none") {
    throw new TypeError(`Placeholder preset viewer ${record.id} must use source 'none'.`);
  }
  if (record.source === "none" && resourcePolicy.maxSourceBytes !== 0) {
    throw new TypeError(`Metadata-only preset viewer ${record.id} cannot declare a source byte budget.`);
  }
  if (record.source !== "none" && resourcePolicy.maxSourceBytes === 0) {
    throw new TypeError(`Preset viewer ${record.id} must declare a positive source byte budget.`);
  }
  if (record.computeIsolation === "worker" && resourcePolicy.maxWorkers === 0) {
    throw new TypeError(`Worker-compute preset viewer ${record.id} must declare at least one worker.`);
  }
  if (record.computeIsolation === "main-thread" && resourcePolicy.maxWorkers !== 0) {
    throw new TypeError(`Main-thread preset viewer ${record.id} cannot declare worker capacity.`);
  }
  if (record.computeIsolation === "browser-engine") {
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
  if (record.source === "resource-session" || record.computeIsolation === "native-process") {
    if (record.source !== "resource-session" || record.computeIsolation !== "native-process"
      || record.capability !== "preview" || record.runtime !== "lazy" || record.surfaceIsolation !== "inline"
      || resourcePolicy.maxWorkers !== 0 || resourcePolicy.maxCanvasPixels !== 0 || resourcePolicy.maxActiveCanvases !== 0) {
      throw new TypeError(`Native-session preset viewer ${record.id} must be a lazy, inline, read-only DOM surface.`);
    }
  }
  if (record.contentSandbox === "sandboxed-frame" && !record.surfaceTraits.includes("sandboxed")) {
    throw new TypeError(`Sandboxed-frame preset viewer ${record.id} must declare the sandboxed trait.`);
  }
  if (record.contentSandbox === "none" && record.surfaceTraits.includes("sandboxed")) {
    throw new TypeError(`Preset viewer ${record.id} cannot claim a sandboxed trait without a sandbox boundary.`);
  }
  if (recoveryPolicy.supportsSafeMode && record.surfaceIsolation !== "isolated-webcontents") {
    throw new TypeError(`Safe-mode preset viewer ${record.id} must use an isolated surface.`);
  }
  if (
    record.computeIsolation !== "browser-engine"
    && (record.surfaceFamily === "canvas" || (record.surfaceFamily !== "grid" && record.surfaceTraits.includes("paginated")))
    && (resourcePolicy.maxCanvasPixels === 0 || resourcePolicy.maxActiveCanvases === 0)
  ) {
    throw new TypeError(`Canvas or paginated preset viewer ${record.id} must declare positive Canvas limits.`);
  }

  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    id: record.id,
    formatViewerIds: Object.freeze([...record.formatViewerIds]),
    capability: record.capability,
    source: record.source,
    runtime: record.runtime,
    surfaceIsolation: record.surfaceIsolation,
    computeIsolation: record.computeIsolation,
    contentSandbox: record.contentSandbox,
    resourcePolicy,
    recoveryPolicy,
    surfacePreparation: record.surfacePreparation,
    readinessSignal: record.readinessSignal,
    surfaceFamily: record.surfaceFamily,
    surfaceTraits: Object.freeze([...record.surfaceTraits]),
  });
}

function parseResourcePolicy(input, viewerId) {
  const label = `Preset viewer ${viewerId} resource policy`;
  const record = assertRecord(input, label);
  assertExactKeys(
    record,
    new Set(["memoryClass", "maxSourceBytes", "maxCanvasPixels", "maxActiveCanvases", "maxWorkers"]),
    label,
  );
  if (!MEMORY_CLASSES.has(record.memoryClass)) {
    throw new TypeError(`${label} has an unsupported memory class.`);
  }
  for (const key of ["maxSourceBytes", "maxCanvasPixels", "maxActiveCanvases", "maxWorkers"]) {
    if (!Number.isSafeInteger(record[key]) || record[key] < 0) {
      throw new TypeError(`${label} ${key} must be a non-negative safe integer.`);
    }
  }
  return Object.freeze({
    memoryClass: record.memoryClass,
    maxSourceBytes: record.maxSourceBytes,
    maxCanvasPixels: record.maxCanvasPixels,
    maxActiveCanvases: record.maxActiveCanvases,
    maxWorkers: record.maxWorkers,
  });
}

function parseRecoveryPolicy(input, viewerId) {
  const label = `Preset viewer ${viewerId} recovery policy`;
  const record = assertRecord(input, label);
  assertExactKeys(record, new Set(["maxAutomaticRetries", "supportsSafeMode"]), label);
  if (
    !Number.isSafeInteger(record.maxAutomaticRetries)
    || record.maxAutomaticRetries < 0
    || record.maxAutomaticRetries > 1
  ) {
    throw new TypeError(`${label} maxAutomaticRetries must be zero or one.`);
  }
  if (typeof record.supportsSafeMode !== "boolean") {
    throw new TypeError(`${label} supportsSafeMode must be a boolean.`);
  }
  return Object.freeze({
    maxAutomaticRetries: record.maxAutomaticRetries,
    supportsSafeMode: record.supportsSafeMode,
  });
}

function assertRecord(input, label) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return input;
}

function assertExactKeys(record, allowed, label) {
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new TypeError(`${label} has unknown field(s): ${unknown.join(", ")}.`);
  }
}
