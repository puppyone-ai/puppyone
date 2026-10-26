import { parsePresetViewerManifest } from "../../../shared/presetViewerManifest.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const manifestJson = require("../../../packages/shared-ui/src/editor/registry/presetViewerManifest.json");

export const PRESET_VIEWER_MANIFEST = parsePresetViewerManifest(manifestJson, "main");

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
