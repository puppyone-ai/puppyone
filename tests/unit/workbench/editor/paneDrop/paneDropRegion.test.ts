import { describe, expect, it } from "vitest";
import { paneDropEdgeBand, resolvePaneDropRegion } from "../../../../../src/features/editor-workbench/drag-and-drop/paneDropRegion";

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

  it("keeps a real reading area in a short pane", () => {
    const short = { left: 0, top: 0, right: 800, bottom: 360, width: 800, height: 360 };
    // The old 30% band classified the whole text block of a short document as edge.
    expect(resolvePaneDropRegion(short, 400, 180)).toBe("center");
    expect(resolvePaneDropRegion(short, 400, 120)).toBe("center");
    expect(resolvePaneDropRegion(short, 400, 20)).toBe("center");
    expect(resolvePaneDropRegion(short, 400, 10)).toBe("edge");
  });

  it("keeps a usable center in a narrow pane", () => {
    const narrow = { left: 0, top: 0, right: 240, bottom: 800, width: 240, height: 800 };
    expect(resolvePaneDropRegion(narrow, 120, 400)).toBe("center");
    expect(resolvePaneDropRegion(narrow, 10, 400)).toBe("edge");
  });
  it("keeps the first reading lines outside the split zone", () => {
    expect(resolvePaneDropRegion(rect, 500, 40)).toBe("center");
    expect(resolvePaneDropRegion(rect, 40, 400)).toBe("center");
    expect(resolvePaneDropRegion(rect, 960, 400)).toBe("center");
    expect(resolvePaneDropRegion(rect, 500, 760)).toBe("center");
  });
  it("limits normal split zones to a narrow strip next to each edge", () => {
    expect(paneDropEdgeBand(rect)).toBe(24);
    expect(resolvePaneDropRegion(rect, 23, 400)).toBe("edge");
    expect(resolvePaneDropRegion(rect, 24, 400)).toBe("center");
    expect(paneDropEdgeBand({ width: 240, height: 600 })).toBe(16);
  });
  it("preserves the center even in a very narrow split pane", () => {
    const narrow = { left: 0, top: 0, right: 60, bottom: 600, width: 60, height: 600 };
    expect(resolvePaneDropRegion(narrow, 30, 300)).toBe("center");
    expect(paneDropEdgeBand(narrow)).toBeLessThanOrEqual(15);
  });
});
