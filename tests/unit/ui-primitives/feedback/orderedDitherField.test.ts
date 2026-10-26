import { describe, expect, it } from "vitest";
import {
  ORDERED_DITHER_LIGHT,
  buildOrderedDitherMask,
  createOrderedDitherLightField,
  orderedDitherThreshold,
  paintOrderedDitherFrame,
  type OrderedDitherLight,
} from "../../../../packages/shared-ui/src/primitives/orderedDitherField";

const INK = [40, 40, 40, 200] as const;

function paint(cols: number, rows: number, mask: Uint8Array, light: OrderedDitherLight, lightAt: ((x: number, y: number) => number) | null) {
  const pixels = new Uint8ClampedArray(cols * rows * 4);
  paintOrderedDitherFrame(pixels, { cols, rows, mask, ink: INK, light, lightAt });
  return pixels;
}

function inkedCells(pixels: Uint8ClampedArray) {
  let count = 0;
  for (let index = 3; index < pixels.length; index += 4) if (pixels[index] > 0) count += 1;
  return count;
}

describe("ordered dither lattice", () => {
  it("uses each 8x8 Bayer threshold exactly once", () => {
    const thresholds = new Set<number>();
    for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) thresholds.add(orderedDitherThreshold(x, y));
    expect(thresholds.size).toBe(64);
    expect(Math.min(...thresholds)).toBeGreaterThan(0);
    expect(Math.max(...thresholds)).toBeLessThan(1);
    expect(orderedDitherThreshold(8, 16)).toBe(orderedDitherThreshold(0, 0));
  });

  it("carves rounded corners as whole cells and keeps square shapes whole", () => {
    const square = buildOrderedDitherMask(6, 6, [{ x: 0, y: 0, width: 6, height: 6, radius: 0 }]);
    expect([...square].every((cell) => cell === 1)).toBe(true);

    const pill = buildOrderedDitherMask(10, 5, [{ x: 0, y: 0, width: 10, height: 5, radius: 2.5 }]);
    expect(pill[0]).toBe(0);
    expect(pill[9]).toBe(0);
    expect(pill[1]).toBe(1);
    expect(pill[2 * 10]).toBe(1);
    expect(pill[4 * 10]).toBe(0);
  });

  it("clips shapes to the lattice", () => {
    const mask = buildOrderedDitherMask(4, 4, [{ x: 2, y: 2, width: 5, height: 5, radius: 0 }]);
    expect([...mask].filter(Boolean)).toHaveLength(4);
  });
});

describe("ordered dither frame", () => {
  const cols = 64;
  const rows = 64;
  const full = buildOrderedDitherMask(cols, rows, [{ x: 0, y: 0, width: cols, height: rows, radius: 0 }]);

  it("renders the rest state at the light's base density", () => {
    const cells = inkedCells(paint(cols, rows, full, ORDERED_DITHER_LIGHT, null));
    expect(cells / (cols * rows)).toBeCloseTo(ORDERED_DITHER_LIGHT.base, 2);
  });

  it("only adds cells where the light passes, so the dots never move", () => {
    const rest = paint(cols, rows, full, ORDERED_DITHER_LIGHT, null);
    const lit = paint(cols, rows, full, ORDERED_DITHER_LIGHT, () => 1);
    for (let index = 3; index < rest.length; index += 4) {
      if (rest[index] > 0) expect(lit[index]).toBe(rest[index]);
    }
    expect(inkedCells(lit)).toBeGreaterThan(inkedCells(rest));
  });

  it("keeps the spill outside shapes fainter than the shapes, and off when halo is 0", () => {
    const empty = new Uint8Array(cols * rows);
    const glow = paint(cols, rows, empty, ORDERED_DITHER_LIGHT, () => 1);
    const alphas = new Set<number>();
    for (let index = 3; index < glow.length; index += 4) if (glow[index] > 0) alphas.add(glow[index]);
    expect([...alphas]).toEqual([Math.round(INK[3] * ORDERED_DITHER_LIGHT.haloInk)]);

    const contained = paint(cols, rows, empty, { ...ORDERED_DITHER_LIGHT, halo: 0 }, () => 1);
    expect(inkedCells(contained)).toBe(0);
  });

  it("moves the light across the surface and rests between passes", () => {
    const field = createOrderedDitherLightField(cols, rows, ORDERED_DITHER_LIGHT);
    const period = ORDERED_DITHER_LIGHT.period;
    const at = (time: number) => field(time)(cols / 2, rows / 2);
    expect(at(0)).toBeLessThan(0.05);
    expect(Math.max(...[0.3, 0.4, 0.5, 0.6, 0.7].map((share) => at(period * share)))).toBeGreaterThan(0.9);
    expect(at(period)).toBeCloseTo(at(0), 6);
  });
});
