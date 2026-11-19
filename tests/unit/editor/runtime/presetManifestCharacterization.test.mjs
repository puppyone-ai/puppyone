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
  vi.doMock("../../../../shared/presetViewerManifest.json", () => ({ default: input }));
  try {
    const module = runtime === "main"
      ? await import("../../../../electron/main/viewer-packs/preset-viewer-manifest.mjs")
      : await import("../../../../src/shared-ui/editor/registry/presetViewerManifest");
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

describe("preset manifest characterization", () => {
  it.each(manifestCases)("Main and the renderer read %s alike", async (_name, input) => {
    const main = await loadManifest("main", input);
    const renderer = await loadManifest("renderer", input);
    // Both accept and refuse the same manifests. An accepted manifest is its own
    // input, frozen, as loadManifest checks; only a refusal has words to keep,
    // and where the two word it differently, both are kept.
    expect("error" in renderer).toBe("error" in main);
    if (!("error" in main)) {
      expect(renderer).toEqual(main);
      expect("accepted").toMatchSnapshot();
    } else {
      expect(renderer.error).toBe(main.error);
      expect(renderer.message === main.message ? main : { main, renderer }).toMatchSnapshot();
    }
  });
});
