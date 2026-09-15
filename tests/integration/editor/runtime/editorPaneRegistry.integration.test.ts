import { describe, expect, it } from "vitest";
import { PRESET_VIEWER_REGISTRY, resolveEditorViewer } from "../../../../packages/shared-ui/src/editor/registry/viewerRegistry";
import { EDITOR_PANE_CASES } from "../../../fixtures/editor/runtime/editorPaneCases";

describe("Editor pane interaction fixture contract", () => {
  it("requires every registered Viewer, including the fallback, in the Chromium matrix", () => {
    expect([...new Set(EDITOR_PANE_CASES.map(({ viewerId }) => viewerId))].sort()).toEqual([
      ...PRESET_VIEWER_REGISTRY.contributions.map(({ id }) => id), PRESET_VIEWER_REGISTRY.fallback.id,
    ].sort());
    expect(new Set(EDITOR_PANE_CASES.map(({ id }) => id)).size).toBe(EDITOR_PANE_CASES.length);
  });

  it.each(EDITOR_PANE_CASES)("$id selects its declared production Viewer", (testCase) => {
    const { viewer } = resolveEditorViewer({ path: testCase.name, name: testCase.name, type: testCase.type, mimeType: testCase.mimeType ?? null });
    expect(viewer.id).toBe(testCase.viewerId);
  });
});
