import { describe, expect, it } from "vitest";
import {
  arrangeDesktop,
  clampToDesktop,
  desktopHeight,
  DESKTOP_TILE,
  DESKTOP_WIDTH,
  settleOnDesktop,
} from "../../../../src/components/onboarding/projectDesktop";

const ids = (count: number) => Array.from({ length: count }, (_, index) => `p${index}`);

describe("the Homepage Grid desktop", () => {
  it("starts in reading order, seven across", () => {
    const points = arrangeDesktop(ids(9), {});
    expect(points.get("p0")).toEqual({ x: 1, y: 0 });
    expect(points.get("p6")?.y).toBe(0);
    expect(points.get("p7")).toEqual({ x: 1, y: 98 });
  });

  it("fits seven projects inside its width", () => {
    const points = arrangeDesktop(ids(7), {});
    expect(points.get("p6")!.x + DESKTOP_TILE.width).toBeLessThanOrEqual(DESKTOP_WIDTH);
  });

  it("keeps what was placed and gives a new project the first free slot", () => {
    const saved = { p0: { x: 1, y: 0 }, p1: { x: 300, y: 300 } };
    const points = arrangeDesktop(["p0", "p1", "new"], saved);
    expect(points.get("p1")).toEqual({ x: 300, y: 300 });
    expect(points.get("new")).toEqual({ x: 110, y: 0 });
  });

  it("never puts a new project under a placed one", () => {
    const points = arrangeDesktop(["moved", "new"], { moved: { x: 40, y: 20 } });
    const [moved, added] = [points.get("moved")!, points.get("new")!];
    expect(Math.abs(moved.x - added.x) >= DESKTOP_TILE.width || Math.abs(moved.y - added.y) >= DESKTOP_TILE.height).toBe(true);
  });

  it("has a fixed height until the projects need more", () => {
    expect(desktopHeight(arrangeDesktop(ids(1), {}))).toBe(desktopHeight(arrangeDesktop(ids(37), {})));
    expect(desktopHeight(arrangeDesktop(ids(100), {}))).toBeGreaterThan(desktopHeight(arrangeDesktop(ids(37), {})));
  });

  it("grows to keep a project that sits below it", () => {
    const points = arrangeDesktop(["low"], { low: { x: 0, y: 2000 } });
    expect(desktopHeight(points)).toBe(2000 + DESKTOP_TILE.height);
  });

  it("clamps to the area", () => {
    expect(clampToDesktop({ x: -10, y: 9000 }, 600)).toEqual({ x: 0, y: 600 - DESKTOP_TILE.height });
  });

  it("lands exactly where it was dropped when the spot is free", () => {
    expect(settleOnDesktop({ x: 123, y: 45 }, [{ x: 400, y: 400 }], 600)).toEqual({ x: 123, y: 45 });
  });

  it("slides to the nearest free spot when it is not", () => {
    const other = { x: 300, y: 200 };
    const settled = settleOnDesktop({ x: 310, y: 210 }, [other], 600);
    expect(Math.abs(settled.x - other.x) >= DESKTOP_TILE.width || Math.abs(settled.y - other.y) >= DESKTOP_TILE.height).toBe(true);
    expect(Math.hypot(settled.x - 310, settled.y - 210)).toBeLessThan(120);
  });
});
