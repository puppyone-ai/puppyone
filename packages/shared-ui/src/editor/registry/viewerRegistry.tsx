"use client";

import {
  getFileSemanticKind,
  getResolvedFileExtension,
  resolveFileFormat,
} from "../../core/fileFormats";
import type {
  EditorDocument,
  EditorSourceRequirement,
  EditorViewerMatch,
  PresetViewerContribution,
} from "./viewerTypes";
import {
  type CoreViewerCapability,
} from "./viewerContract";
import { PRESET_VIEWER_MANIFEST } from "./presetViewerManifest";
import { normalizePresetViewerContribution } from "./presetViewerContribution";
import {
  BUILTIN_VIEWER_CONTRIBUTIONS,
  fallbackViewerContribution,
} from "./builtinViewerContributions";

export { definePresetViewer } from "./presetViewerContribution";

export type PresetViewerRegistry = Readonly<{
  contributions: readonly PresetViewerContribution[];
  fallback: PresetViewerContribution;
  resolve: (match: EditorViewerMatch) => PresetViewerContribution;
}>;

/** Creates an immutable, order-preserving registry with one honest fallback. */
export function createPresetViewerRegistry(
  contributions: readonly PresetViewerContribution[],
  fallback: PresetViewerContribution,
): PresetViewerRegistry {
  const normalized = contributions.map(normalizePresetViewerContribution);
  const normalizedFallback = normalizePresetViewerContribution(fallback);
  const ids = new Set<string>();
  for (const contribution of [...normalized, normalizedFallback]) {
    if (ids.has(contribution.id)) {
      throw new TypeError(`Preset viewer id ${contribution.id} is registered more than once.`);
    }
    ids.add(contribution.id);
  }
  if (normalizedFallback.id !== PRESET_VIEWER_MANIFEST.fallbackViewerId) {
    throw new TypeError(`The preset viewer fallback must be ${PRESET_VIEWER_MANIFEST.fallbackViewerId}.`);
  }

  const frozenContributions = Object.freeze(normalized);
  return Object.freeze({
    contributions: frozenContributions,
    fallback: normalizedFallback,
    resolve: (match: EditorViewerMatch) => (
      frozenContributions.find((contribution) => contribution.match(match)) ?? normalizedFallback
    ),
  });
}

export const PRESET_VIEWER_REGISTRY = assertCompletePresetViewerRegistry(
  createPresetViewerRegistry(BUILTIN_VIEWER_CONTRIBUTIONS, fallbackViewerContribution),
);
export const PRESET_VIEWERS = PRESET_VIEWER_REGISTRY.contributions;

/** @deprecated Prefer PRESET_VIEWERS; retained for downstream compatibility. */
export const EDITOR_VIEWERS = PRESET_VIEWERS;

function assertCompletePresetViewerRegistry(
  registry: PresetViewerRegistry,
): PresetViewerRegistry {
  const registeredIds = new Set([
    ...registry.contributions.map(({ id }) => id),
    registry.fallback.id,
  ]);
  const missing = PRESET_VIEWER_MANIFEST.viewers
    .map(({ id }) => id)
    .filter((id) => !registeredIds.has(id));
  if (missing.length > 0) {
    throw new TypeError(`Preset viewer manifest has no implementation for: ${missing.join(", ")}.`);
  }
  if (registeredIds.size !== PRESET_VIEWER_MANIFEST.viewers.length) {
    throw new TypeError("Preset viewer registry contains an implementation outside the canonical manifest.");
  }
  return registry;
}

export function resolveEditorViewer(document: EditorDocument): {
  viewer: PresetViewerContribution;
  format: EditorViewerMatch["format"];
  resolvedExtension: string | null;
} {
  const format = resolveFileFormat({ name: document.name, mimeType: document.mimeType });
  const resolvedExtension = getResolvedFileExtension(
    { name: document.name, mimeType: document.mimeType },
    format,
  );
  const match = { document, format, resolvedExtension };
  return {
    viewer: PRESET_VIEWER_REGISTRY.resolve(match),
    format,
    resolvedExtension,
  };
}

export function getEditorSourceRequirement(input: {
  name: string;
  type?: string | null;
  mimeType?: string | null;
}): EditorSourceRequirement {
  const semanticKind = getFileSemanticKind(input.name, input.type);
  if (semanticKind === "folder") return "none";
  const { viewer } = resolveEditorViewer({
    path: input.name,
    name: input.name,
    type: semanticKind,
    mimeType: input.mimeType ?? null,
  });
  return viewer.source;
}

export function shouldReadEditorContent(input: {
  name: string;
  type?: string | null;
  mimeType?: string | null;
}): boolean {
  const requirement = getEditorSourceRequirement(input);
  return requirement === "content" || requirement === "content-and-resource";
}

/**
 * Capability classification (`edit` | `preview` | `placeholder`) for the
 * viewer that would resolve for a document. Placeholder-grade documents are
 * the plugin-eligible surface.
 */
export function classifyEditorViewerCapability(document: EditorDocument): CoreViewerCapability {
  const { viewer } = resolveEditorViewer(document);
  return viewer.capability;
}

/** Pane behavior is declared by the resolved contribution. */
export function getEditorProviderPolicy(document: EditorDocument) {
  return resolveEditorViewer(document).viewer.providerPolicy!;
}
