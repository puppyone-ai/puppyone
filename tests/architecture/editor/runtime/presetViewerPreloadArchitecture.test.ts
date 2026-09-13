import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("preset viewer preload cache", () => {
  it("starts route acquisition from the selected document rather than the retained preview", () => {
    const workspaceSource = readFileSync(
      new URL("../../../../packages/shared-ui/src/data/DataWorkspace.tsx", import.meta.url),
      "utf8",
    );
    const selectionPreload = workspaceSource.indexOf("preloadPresetViewer(selectedFileViewer)");
    const contentRead = workspaceSource.indexOf("useDocumentInput(loadActiveFileSource ? selectedFile : null");

    expect(selectionPreload).toBeGreaterThan(-1);
    expect(contentRead).toBeGreaterThan(selectionPreload);
  });
});
