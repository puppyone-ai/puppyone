import manifestJson from "./presetViewerManifest.json";
import { parsePresetViewerManifest, type PresetViewerDefinition } from "../../../../../shared/presetViewerManifest.js";
import type { CoreViewerCapability } from "./viewerContract";

export type { PresetViewerDefinition, PresetViewerManifest } from "../../../../../shared/presetViewerManifest.js";

export const PRESET_VIEWER_MANIFEST = parsePresetViewerManifest(manifestJson, "renderer");

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
