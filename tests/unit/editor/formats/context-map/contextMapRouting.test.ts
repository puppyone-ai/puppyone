import { describe, expect, it } from "vitest";
import {
  routeLayeredHierarchyRelationships,
  routeLayeredReferenceRelationship,
  routeRadialHierarchyRelationships,
  routeRadialReferenceRelationship,
  routeStraightRelationships,
} from "../../../../../packages/shared-ui/src/editor/viewers/context-map/contextMapRouting";

describe("folder relationship straight-line routing", () => {
  it("connects the facing glyph edges without a gap", () => {
    const [route] = routeStraightRelationships([{
      id: "left:right",
      source: { left: 10, top: 20, width: 20, height: 20 },
      sourceId: "left",
      target: { left: 110, top: 20, width: 20, height: 20 },
      targetId: "right",
    }]);

    expect(route.path).toBe("M 30 30 L 110 30");
  });

  it("uses a single direct segment for diagonal relationships", () => {
    const [route] = routeStraightRelationships([{
      id: "a:b",
      source: { left: 0, top: 0, width: 20, height: 20 },
      sourceId: "a",
      target: { left: 100, top: 80, width: 20, height: 20 },
      targetId: "b",
    }]);

    expect(route.path.match(/ L /g)).toHaveLength(1);
    expect(route.path).not.toContain(" H ");
    expect(route.path).not.toContain(" V ");
  });
});

describe("folder relationship radial hierarchy routing", () => {
  it("routes parent-child edges as radial, concentric arc, radial", () => {
    const [route] = routeRadialHierarchyRelationships([{
      center: { x: 200, y: 200 },
      id: "parent:child",
      source: { angle: 0, radius: 100 },
      target: { angle: Math.PI / 2, radius: 200 },
    }]);

    expect(route.path).toBe(
      "M 318 200 L 350 200 A 150 150 0 0 1 200 350 L 200 382",
    );
    expect(route.path.match(/ L /g)).toHaveLength(2);
    expect(route.path.match(/ A /g)).toHaveLength(1);
  });

  it("keeps center-to-first-ring edges radial", () => {
    const [route] = routeRadialHierarchyRelationships([{
      center: { x: 200, y: 200 },
      id: "root:child",
      source: { angle: 0, radius: 0 },
      target: { angle: -Math.PI / 2, radius: 150 },
    }]);

    expect(route.path).toBe("M 200 162 L 200 68");
    expect(route.path).not.toContain(" A ");
  });
});

describe("folder relationship layered hierarchy routing", () => {
  it("routes parent-child edges down, across, and down", () => {
    const [route] = routeLayeredHierarchyRelationships([{
      id: "parent:child",
      source: { inset: 18, x: 100, y: 80 },
      target: { inset: 18, x: 260, y: 232 },
    }]);

    expect(route.path).toBe("M 100 98 L 100 156 L 260 156 L 260 214");
    expect(route.path.match(/ L /g)).toHaveLength(3);
  });

  it("keeps vertically aligned parent-child edges straight", () => {
    const [route] = routeLayeredHierarchyRelationships([{
      id: "parent:child",
      source: { inset: 38, x: 180, y: 96 },
      target: { inset: 18, x: 180, y: 248 },
    }]);

    expect(route.path).toBe("M 180 134 L 180 230");
  });
});

describe("folder relationship reference routing", () => {
  it("leaves room for radial reference arrowheads outside the endpoint glyphs", () => {
    expect(routeRadialReferenceRelationship(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 50 },
    )).toBe("M 19.26 5.39 Q 50 14 80.74 5.39");
  });

  it("leaves room for layered reference arrowheads outside the endpoint glyphs", () => {
    expect(routeLayeredReferenceRelationship(
      { x: 100, y: 80 },
      { x: 260, y: 232 },
    )).toBe("M 100 100 C 100 156 260 156 260 212");
  });
});
