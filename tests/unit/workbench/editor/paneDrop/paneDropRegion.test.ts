import { describe, expect, it } from "vitest";
import { resolvePaneDropRegion } from "../../../../../src/features/editor-workbench/drag-and-drop/paneDropRegion";

const rect = { left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 };

describe("resolvePaneDropRegion", () => {
  it("classifies the four borders as edge", () => {
    expect(resolvePaneDropRegion(rect, 10, 400)).toBe("edge");
    expect(resolvePaneDropRegion(rect, 990, 400)).toBe("edge");
    expect(resolvePaneDropRegion(rect, 500, 5)).toBe("edge");
    expect(resolvePaneDropRegion(rect, 500, 795)).toBe("edge");
  });

  it("classifies the middle as center", () => {
    expect(resolvePaneDropRegion(rect, 500, 400)).toBe("center");
    expect(resolvePaneDropRegion(rect, 200, 200)).toBe("center");
  });

  it("keeps a usable center in a narrow pane", () => {
    const narrow = { left: 0, top: 0, right: 240, bottom: 800, width: 240, height: 800 };
    expect(resolvePaneDropRegion(narrow, 120, 400)).toBe("center");
    expect(resolvePaneDropRegion(narrow, 10, 400)).toBe("edge");
  });
});
