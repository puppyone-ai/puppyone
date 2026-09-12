import { describe, expect, it } from "vitest";
import {
  activateEditorPane,
  assignEditorToActivePane,
  closeEditorPane,
  createEditorPaneLayout,
  getActiveEditorPane,
  getEditorPanes,
  moveEditorPane,
  parseEditorPaneLayoutState,
  rebaseEditorPaneResources,
  removeEditorFromPanes,
  splitEditorPane,
  updateEditorSplitRatio,
} from "../../../../packages/shared-ui/src/editor/workbench/editorPaneLayoutModel";

describe("EditorPaneLayoutModel", () => {
  it("builds recursive right/down splits and focuses the new pane", () => {
    let layout = createEditorPaneLayout("a.md");
    layout = splitEditorPane(layout, layout.activePaneId, "horizontal");
    const secondPane = getActiveEditorPane(layout);
    layout = assignEditorToActivePane(layout, "b.md");
    layout = splitEditorPane(layout, secondPane.id, "vertical");

    expect(layout.root).toMatchObject({
      kind: "split",
      direction: "horizontal",
      second: { kind: "split", direction: "vertical" },
    });
    expect(getEditorPanes(layout).map(({ editorId }) => editorId)).toEqual([
      "a.md",
      "b.md",
      "b.md",
    ]);
    expect(getActiveEditorPane(layout).id).toBe("editor-pane-3");
  });

  it("collapses the parent split when a pane closes and preserves surviving focus", () => {
    let layout = splitEditorPane(createEditorPaneLayout("a.md"), "editor-pane-1", "horizontal");
    layout = assignEditorToActivePane(layout, "b.md");
    layout = activateEditorPane(layout, "editor-pane-1");
    layout = closeEditorPane(layout, "editor-pane-2");

    expect(layout.root).toMatchObject({ kind: "pane", id: "editor-pane-1", editorId: "a.md" });
    expect(layout.activePaneId).toBe("editor-pane-1");
  });

  it("places a dragged editor on the requested side of the target pane", () => {
    const layout = splitEditorPane(
      createEditorPaneLayout("target.md"),
      "editor-pane-1",
      "horizontal",
      { editorId: "dragged.md", placement: "first" },
    );

    expect(layout.root).toMatchObject({
      kind: "split",
      direction: "horizontal",
      first: { kind: "pane", editorId: "dragged.md" },
      second: { kind: "pane", editorId: "target.md" },
    });
    expect(getActiveEditorPane(layout).editorId).toBe("dragged.md");
  });

  it("moves an existing pane without duplicating its editor assignment", () => {
    let layout = splitEditorPane(createEditorPaneLayout("a.md"), "editor-pane-1", "horizontal");
    layout = assignEditorToActivePane(layout, "b.md");
    const originalSplitId = layout.root.id;
    layout = moveEditorPane(layout, "editor-pane-1", "editor-pane-2", "vertical", "second");

    expect(layout.root).toMatchObject({
      kind: "split",
      id: originalSplitId,
      direction: "vertical",
      first: { kind: "pane", id: "editor-pane-2", editorId: "b.md" },
      second: { kind: "pane", id: "editor-pane-1", editorId: "a.md" },
    });
    expect(getEditorPanes(layout).map(({ editorId }) => editorId)).toEqual(["b.md", "a.md"]);
    expect(layout.activePaneId).toBe("editor-pane-1");
  });

  it("reorders sibling panes without replacing their split identity", () => {
    let layout = splitEditorPane(createEditorPaneLayout("a.md"), "editor-pane-1", "horizontal");
    layout = assignEditorToActivePane(layout, "b.md");
    const originalRootId = layout.root.id;
    const originalPanes = new Map(getEditorPanes(layout).map((pane) => [pane.id, pane]));

    const reordered = moveEditorPane(
      layout,
      "editor-pane-2",
      "editor-pane-1",
      "horizontal",
      "first",
    );

    expect(reordered.root).toMatchObject({
      kind: "split",
      id: originalRootId,
      first: { id: "editor-pane-2", editorId: "b.md" },
      second: { id: "editor-pane-1", editorId: "a.md" },
    });
    expect(getEditorPanes(reordered).every((pane) => originalPanes.get(pane.id) === pane)).toBe(true);
  });

  it("returns the same layout when a sibling pane is dropped back into its current slot", () => {
    let layout = splitEditorPane(createEditorPaneLayout("a.md"), "editor-pane-1", "horizontal");
    layout = assignEditorToActivePane(layout, "b.md");

    expect(moveEditorPane(
      layout,
      "editor-pane-2",
      "editor-pane-1",
      "horizontal",
      "second",
    )).toBe(layout);
  });

  it("rebases resources, removes closed editors, and clamps persisted ratios", () => {
    let layout = splitEditorPane(createEditorPaneLayout("docs/a.md"), "editor-pane-1", "horizontal");
    layout = assignEditorToActivePane(layout, "docs/b.md");
    layout = rebaseEditorPaneResources(layout, "docs", "notes");
    layout = removeEditorFromPanes(layout, "notes/b.md", "notes/a.md");
    layout = updateEditorSplitRatio(layout, "editor-split-1", 0.99);

    expect(getEditorPanes(layout).map(({ editorId }) => editorId)).toEqual(["notes/a.md", "notes/a.md"]);
    expect(layout.root).toMatchObject({ kind: "split", ratio: 0.85 });

    const parsed = parseEditorPaneLayoutState(
      { ...layout, root: { ...layout.root, ratio: -5 } },
      new Set(["notes/a.md"]),
    );
    expect(parsed.root).toMatchObject({ kind: "split", ratio: 0.15 });
  });

  it("keeps pane references aligned when resource addresses use equivalent separators", () => {
    const layout = rebaseEditorPaneResources(
      createEditorPaneLayout("docs/nested/a.md"),
      ".\\docs\\",
      "./notes//",
    );

    expect(getActiveEditorPane(layout).editorId).toBe("notes/nested/a.md");
  });
});
