import { describe, expect, it, vi } from "vitest";
import { manifestCases } from "../../../support/editor/preset-manifest-cases.mjs";

const fixture = vi.hoisted(() => ({ current: null }));
vi.mock("node:module", async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    createRequire: (url) => String(url).endsWith("/preset-viewer-manifest.mjs")
      ? () => fixture.current
      : original.createRequire(url),
  };
});

async function loadManifest(runtime, input) {
  vi.resetModules();
  fixture.current = input;
  vi.doMock("../../../../packages/shared-ui/src/editor/registry/presetViewerManifest.json", () => ({ default: input }));
  try {
    const module = runtime === "main"
      ? await import("../../../../electron/main/viewer-packs/preset-viewer-manifest.mjs")
      : await import("../../../../packages/shared-ui/src/editor/registry/presetViewerManifest");
    const manifest = module.PRESET_VIEWER_MANIFEST;
    // Fail if the fixture mock ever returns a cached manifest from another case.
    expect(manifest).toEqual({ ...input, viewers: input.viewers.map((viewer) => ({ contractVersion: 8, ...viewer })) });
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.viewers)).toBe(true);
    for (const viewer of manifest.viewers) {
      for (const value of [viewer, viewer.formatViewerIds, viewer.surfaceTraits, viewer.resourcePolicy, viewer.recoveryPolicy]) {
        expect(Object.isFrozen(value)).toBe(true);
      }
      for (const id of [viewer.id, ...viewer.formatViewerIds]) {
        expect(module.getPresetViewerDefinitionForViewerId(id)).toBe(viewer);
      }
    }
    return manifest;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return { error: error.name, message: error.message };
  }
}

for (const runtime of ["main", "renderer"]) {
  describe(`${runtime} manifest characterization`, () => {
    it.each(manifestCases)("preserves %s", async (_name, input) => {
      expect(await loadManifest(runtime, input)).toMatchSnapshot();
    });
  });
}
