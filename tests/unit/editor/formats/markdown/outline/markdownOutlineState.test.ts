import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { buildOutlineSnapshot } from "../../../../../../src/shared-ui/editor/markdown/core/interaction/markdownOutlineState";

describe("buildOutlineSnapshot", () => {
  it("reports headings and the active index for a given scroll position", () => {
    // The second heading sits below the 24px activation marker, so a reader at
    // the top of the document is still inside the first section.
    const state = EditorState.create({ doc: `# A\n\n${"x".repeat(40)}\n\n## B\n` });
    const snapshot = buildOutlineSnapshot(state, 0, (from) => from);
    expect(snapshot.headings.map((h) => h.title)).toEqual(["A", "B"]);
    expect(snapshot.activeIndex).toBe(0);
    const scrolled = buildOutlineSnapshot(state, 60, (from) => from);
    expect(scrolled.activeIndex).toBe(1);
  });

  it("is stable for identical inputs so React does not re-render", () => {
    const state = EditorState.create({ doc: "# A\n" });
    const first = buildOutlineSnapshot(state, 0, (from) => from);
    const second = buildOutlineSnapshot(state, 0, (from) => from);
    expect(first.headings).toBe(second.headings);
  });
});
