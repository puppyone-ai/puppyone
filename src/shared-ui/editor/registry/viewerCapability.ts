import type {
  CoreViewerCapability,
  ViewerContribution,
  ViewerPackSnapshot,
  ViewerRouteResult,
} from "./viewerPackTypes";
import type { DocumentSourceKind } from "../documentSource";
import { coreViewerCapability } from "./presetViewerManifest";

export { coreViewerCapability } from "./presetViewerManifest";

/**
 * Derive core viewer capability at the registry boundary.
 * Call sites must not scatter checks for the literal `binary-placeholder` ID.
 */
export function isPluginEligibleCoreCapability(capability: CoreViewerCapability): boolean {
  return capability === "placeholder";
}

function normalizeExtension(value: string): string {
  const lower = value.trim().toLowerCase();
  if (!lower) return "";
  return lower.startsWith(".") ? lower : `.${lower}`;
}

/**
 * Find every enabled contribution that declares a matching extension or MIME
 * type. Pure and Electron-free; the main process is the sole activation
 * authority and re-runs equivalent rules against its own registry snapshot.
 */
export function findPackCandidates(input: {
  extensions: readonly string[];
  mimeTypes: readonly string[];
  snapshot: ViewerPackSnapshot | null;
}): ViewerContribution[] {
  const contributions = input.snapshot?.contributions ?? [];
  const wantedExtensions = new Set(
    input.extensions.map(normalizeExtension).filter(Boolean),
  );
  const wantedMimeTypes = new Set(
    input.mimeTypes
      .map((item) => item.toLowerCase().split(";")[0].trim())
      .filter(Boolean),
  );

  const scored = contributions.map((contribution) => {
    if (!contribution.enabled) return false;
    let score = 0;
    for (const format of contribution.formats) {
      const extensionHit = format.extensions.some((ext) =>
        wantedExtensions.has(normalizeExtension(ext)),
      );
      const mimeHit = format.mimeTypes.some((mime) =>
        wantedMimeTypes.has(mime.toLowerCase().split(";")[0].trim()),
      );
      if (extensionHit) {
        const longest = format.extensions
          .map(normalizeExtension)
          .filter((extension) => wantedExtensions.has(extension))
          .reduce((length, extension) => Math.max(length, extension.length), 0);
        score = Math.max(score, 1_000 + longest);
      } else if (mimeHit) {
        score = Math.max(score, 100);
      }
    }
    return { contribution, score };
  }).filter((item): item is { contribution: ViewerContribution; score: number } => Boolean(item));
  const bestScore = scored.reduce((best, item) => Math.max(best, item.score), 0);
  return scored
    .filter((item) => item.score > 0 && item.score === bestScore)
    .map((item) => item.contribution)
    .sort((left, right) => left.pluginId.localeCompare(right.pluginId));
}

export type ResolveViewerRouteInput = {
  coreViewerId: string;
  coreViewerCapability?: CoreViewerCapability;
  extensions: readonly string[];
  mimeTypes: readonly string[];
  snapshot: ViewerPackSnapshot | null;
  sourceKind: DocumentSourceKind;
  preferredPluginId?: string | null;
};

/**
 * Deterministic Viewer Pack route (doc §5.1). Pure and Electron-free.
 * Main process may re-run the same rules against its registry snapshot.
 */
export function resolveViewerRoute(input: ResolveViewerRouteInput): ViewerRouteResult {
  const capability = input.coreViewerCapability ?? coreViewerCapability(input.coreViewerId);
  if (!isPluginEligibleCoreCapability(capability)) {
    return {
      kind: "core",
      viewerId: input.coreViewerId,
      capability,
    };
  }

  // Cloud/unknown sources fail closed before any plugin activation.
  if (input.sourceKind !== "local") {
    return { kind: "unsupported", reason: "cloud-source" };
  }

  const matches = findPackCandidates({
    extensions: input.extensions,
    mimeTypes: input.mimeTypes,
    snapshot: input.snapshot,
  });

  if (matches.length === 0) {
    return { kind: "unsupported", reason: "no-match" };
  }

  if (input.preferredPluginId) {
    const preferred = matches.find((item) => item.pluginId === input.preferredPluginId);
    if (preferred) return toPluginRoute(preferred);
  }

  if (matches.length === 1) {
    return toPluginRoute(matches[0]);
  }

  return { kind: "chooser", candidates: matches };
}

function toPluginRoute(contribution: ViewerContribution): ViewerRouteResult {
  return {
    kind: "plugin",
    pluginId: contribution.pluginId,
    version: contribution.version,
    contentHash: contribution.contentHash,
    entry: contribution.viewer.entry,
    contribution,
  };
}
