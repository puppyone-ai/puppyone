import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { preloadPresetViewer } from "../packages/shared-ui/src/editor/host/PresetViewerRenderer";
import { getPresetViewerDefinition } from "../packages/shared-ui/src/editor/registry/presetViewerManifest";
import type { LazyPresetViewerContribution } from "../packages/shared-ui/src/editor/registry/viewerTypes";

describe("preset viewer preload cache", () => {
  it("starts route acquisition from the selected document rather than the retained preview", () => {
    const workspaceSource = readFileSync(
      new URL("../packages/shared-ui/src/data/DataWorkspace.tsx", import.meta.url),
      "utf8",
    );
    const selectionPreload = workspaceSource.indexOf("preloadPresetViewer(selectedFileViewer)");
    const contentRead = workspaceSource.indexOf("readDocumentStorageSnapshot(dataPort, selectedFile.path");

    expect(selectionPreload).toBeGreaterThan(-1);
    expect(contentRead).toBeGreaterThan(selectionPreload);
  });

  it("deduplicates prefetch and React.lazy module acquisition", async () => {
    const load = vi.fn(async () => ({ default: () => null }));
    const viewer = createLazyViewer(load);

    await Promise.all([
      preloadPresetViewer(viewer),
      preloadPresetViewer(viewer),
    ]);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("evicts a failed prefetch so a later mount can retry", async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error("transient chunk failure"))
      .mockResolvedValueOnce({ default: () => null });
    const viewer = createLazyViewer(load);

    await expect(preloadPresetViewer(viewer)).rejects.toThrow("transient chunk failure");
    await expect(preloadPresetViewer(viewer)).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("never evaluates an isolated Viewer implementation in the shell renderer", async () => {
    const load = vi.fn(async () => ({ default: () => null }));
    const viewer: LazyPresetViewerContribution = {
      ...getPresetViewerDefinition("pdf-preview"),
      match: () => true,
      load,
    };

    await expect(preloadPresetViewer(viewer)).resolves.toBeUndefined();
    expect(load).not.toHaveBeenCalled();
  });
});

function createLazyViewer(
  load: LazyPresetViewerContribution["load"],
): LazyPresetViewerContribution {
  return {
    ...getPresetViewerDefinition("markdown"),
    match: () => true,
    load,
  };
}
