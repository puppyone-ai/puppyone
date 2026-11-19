import { normalizeEditorProviderPolicy } from "./editorProviderPolicy";
import type {
  PresetViewerContribution,
  PresetViewerImplementation,
} from "./viewerTypes";
import { getPresetViewerDefinition } from "./presetViewerManifest";

const IMPLEMENTATION_KEYS = new Set([
  "id",
  "providerPolicy",
  "match",
  "allowPreviewContent",
  "normalizeContent",
  "isEditable",
  "render",
  "load",
]);
const RESOLVED_KEYS = new Set([
  "contractVersion",
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
  ...IMPLEMENTATION_KEYS,
]);
const OPTIONAL_FUNCTION_KEYS = ["normalizeContent", "isEditable"] as const;

/** Validate one format-owned implementation against process-neutral metadata. */
export function definePresetViewer(
  implementation: PresetViewerImplementation,
): PresetViewerContribution {
  const record = implementation as unknown as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => !IMPLEMENTATION_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new TypeError(`Preset viewer ${String(record.id ?? "<unknown>")} has unknown field(s): ${unknownKeys.join(", ")}.`);
  }
  if (typeof record.id !== "string" || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(record.id)) {
    throw new TypeError("Preset viewer id must be a stable lowercase kebab-case identifier.");
  }
  return normalizePresetViewerContribution({
    ...getPresetViewerDefinition(record.id),
    ...implementation,
  } as PresetViewerContribution);
}

export function normalizePresetViewerContribution(
  contribution: PresetViewerContribution,
): PresetViewerContribution {
  const record = contribution as unknown as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => !RESOLVED_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new TypeError(`Preset viewer ${String(record.id ?? "<unknown>")} has unknown field(s): ${unknownKeys.join(", ")}.`);
  }
  if (typeof record.id !== "string") throw new TypeError("Preset viewer id must be a string.");
  const definition = getPresetViewerDefinition(record.id);
  for (const key of [
    "contractVersion",
    "capability",
    "source",
    "runtime",
    "surfaceIsolation",
    "computeIsolation",
    "contentSandbox",
    "surfacePreparation",
    "readinessSignal",
    "surfaceFamily",
  ] as const) {
    if (record[key] !== definition[key]) {
      throw new TypeError(`Preset viewer ${record.id} does not match canonical ${key} metadata.`);
    }
  }
  if (
    !Array.isArray(record.formatViewerIds)
    || record.formatViewerIds.length !== definition.formatViewerIds.length
    || record.formatViewerIds.some((value, index) => value !== definition.formatViewerIds[index])
  ) {
    throw new TypeError(`Preset viewer ${record.id} does not match canonical format viewer ids.`);
  }
  for (const key of ["resourcePolicy", "recoveryPolicy"] as const) {
    if (record[key] !== definition[key]) {
      throw new TypeError(`Preset viewer ${record.id} does not match canonical ${key} metadata.`);
    }
  }
  if (
    !Array.isArray(record.surfaceTraits)
    || record.surfaceTraits.length !== definition.surfaceTraits.length
    || record.surfaceTraits.some((value, index) => value !== definition.surfaceTraits[index])
  ) {
    throw new TypeError(`Preset viewer ${record.id} does not match canonical surface traits.`);
  }
  if (typeof record.match !== "function") {
    throw new TypeError(`Preset viewer ${record.id} must define a match function.`);
  }
  if (record.allowPreviewContent !== undefined && typeof record.allowPreviewContent !== "boolean") {
    throw new TypeError(`Preset viewer ${record.id} has an invalid allowPreviewContent value.`);
  }
  for (const key of OPTIONAL_FUNCTION_KEYS) {
    if (record[key] !== undefined && typeof record[key] !== "function") {
      throw new TypeError(`Preset viewer ${record.id} has an invalid ${key} function.`);
    }
  }
  if (definition.capability === "edit" && typeof record.isEditable !== "function") {
    throw new TypeError(`Editable preset viewer ${record.id} must define isEditable.`);
  }
  if (definition.capability !== "edit" && record.isEditable !== undefined) {
    throw new TypeError(`Non-editable preset viewer ${record.id} cannot define isEditable.`);
  }
  if (record.allowPreviewContent !== undefined && definition.source !== "content-and-resource") {
    throw new TypeError(`Preset viewer ${record.id} can only configure preview content for a combined source.`);
  }
  if (
    record.normalizeContent !== undefined
    && definition.source !== "content"
    && definition.source !== "content-and-resource"
  ) {
    throw new TypeError(`Preset viewer ${record.id} cannot normalize content it does not receive.`);
  }
  if (definition.surfaceIsolation === "isolated-webcontents") {
    if (record.render !== undefined || record.load !== undefined) {
      throw new TypeError(`Isolated-surface preset viewer ${record.id} cannot ship a renderer implementation.`);
    }
  } else if (definition.runtime === "eager") {
    if (typeof record.render !== "function" || record.load !== undefined) {
      throw new TypeError(`Eager preset viewer ${record.id} must define render and cannot define load.`);
    }
  } else if (typeof record.load !== "function" || record.render !== undefined) {
    throw new TypeError(`Lazy preset viewer ${record.id} must define load and cannot define render.`);
  }
  return Object.freeze({
    ...contribution,
    providerPolicy: normalizeEditorProviderPolicy(contribution),
    formatViewerIds: definition.formatViewerIds,
    resourcePolicy: definition.resourcePolicy,
    recoveryPolicy: definition.recoveryPolicy,
    surfaceTraits: definition.surfaceTraits,
  });
}
