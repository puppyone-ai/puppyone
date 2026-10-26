/**
 * Ordered dither field: the loading language of PuppyOne placeholders.
 *
 * Placeholders are built on a fixed cell lattice rather than drawn as smooth
 * shapes under a moving highlight. Shapes are sets of whole cells (rounded
 * corners are cells cut away), and one soft light travels across the surface.
 * Every cell compares the light-plus-rest intensity at its position with its
 * 8x8 Bayer threshold, so the dots never move: only their density does.
 *
 * Inside shapes the ink is the theme's skeleton ink. The light's spill onto
 * the surface between shapes uses the same ink at a fraction of its alpha,
 * so it reads as glow rather than as dust.
 */

export const ORDERED_DITHER_CELL_PX = 2;
export const ORDERED_DITHER_FPS = 30;

/** Cell-space geometry of one placeholder shape. */
export interface OrderedDitherShape {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Corner radius in cells; corners are carved as a pixel arc. */
  radius: number;
}

export interface OrderedDitherLight {
  /** Ink density of a shape at rest. */
  base: number;
  /** Density the light adds at its centre. */
  peak: number;
  /** Peak density of the spill between shapes; 0 keeps the light inside shapes. */
  halo: number;
  /** Alpha of the spill relative to the shape ink. */
  haloInk: number;
  /** Half-width of the light band, in cells. */
  width: number;
  /** Direction of travel in degrees, clockwise from the x axis. */
  angle: number;
  /** Seconds for the light to cross the surface once. */
  period: number;
}

export const ORDERED_DITHER_LIGHT: Readonly<OrderedDitherLight> = Object.freeze({
  base: 0.3,
  peak: 0.46,
  halo: 0.34,
  haloInk: 0.4,
  width: 36,
  angle: 62,
  period: 2.8,
});

const BAYER_8 = [
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
];

/** Threshold of a lattice cell, in (0, 1). */
export function orderedDitherThreshold(x: number, y: number): number {
  return (BAYER_8[((y & 7) << 3) | (x & 7)] + 0.5) / 64;
}

/** Marks the cells covered by any shape (1) on a cols x rows lattice. */
export function buildOrderedDitherMask(
  cols: number,
  rows: number,
  shapes: readonly OrderedDitherShape[],
): Uint8Array {
  const mask = new Uint8Array(cols * rows);
  for (const shape of shapes) {
    const radius = Math.max(0, Math.min(shape.radius, shape.width / 2, shape.height / 2));
    for (let y = 0; y < shape.height; y += 1) {
      const row = shape.y + y;
      if (row < 0 || row >= rows) continue;
      for (let x = 0; x < shape.width; x += 1) {
        const column = shape.x + x;
        if (column < 0 || column >= cols) continue;
        if (!insideRoundedCells(x + 0.5, y + 0.5, shape.width, shape.height, radius)) continue;
        mask[row * cols + column] = 1;
      }
    }
  }
  return mask;
}

function insideRoundedCells(cx: number, cy: number, width: number, height: number, radius: number) {
  const dx = cornerOverhang(cx, width, radius);
  const dy = cornerOverhang(cy, height, radius);
  return dx * dx + dy * dy <= radius * radius;
}

/** How far a cell centre lies inside a corner band along one axis. */
function cornerOverhang(centre: number, size: number, radius: number) {
  if (centre < radius) return radius - centre;
  if (centre > size - radius) return centre - (size - radius);
  return 0;
}

/**
 * Light intensity in [0, 1] at a cell for a given time. The band enters
 * before the surface, crosses it with an eased stroke and leaves before the
 * next cycle, so every surface rests between passes.
 */
export function createOrderedDitherLightField(cols: number, rows: number, light: OrderedDitherLight) {
  const angle = (light.angle * Math.PI) / 180;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const span = cols * Math.abs(ux) + rows * Math.abs(uy);
  return (time: number) => {
    const progress = (((time % light.period) + light.period) % light.period) / light.period;
    const eased = progress * progress * (3 - 2 * progress);
    const centre = -light.width * 2 + eased * (span + light.width * 4);
    return (x: number, y: number) => {
      const distance = (x * ux + y * uy - centre) / light.width;
      return Math.exp(-distance * distance);
    };
  };
}

export interface OrderedDitherFrame {
  cols: number;
  rows: number;
  mask: Uint8Array;
  /** RGBA bytes of the shape ink. */
  ink: readonly [number, number, number, number];
  light: OrderedDitherLight;
  /** Light intensity per cell; null draws the rest state, as for reduced motion. */
  lightAt: ((x: number, y: number) => number) | null;
}

/** Paints one frame into RGBA pixels at lattice resolution (one pixel per cell). */
export function paintOrderedDitherFrame(pixels: Uint8ClampedArray, frame: OrderedDitherFrame): void {
  const { cols, rows, mask, ink, light, lightAt } = frame;
  const [red, green, blue, alpha] = ink;
  const haloAlpha = Math.round(alpha * light.haloInk);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const index = y * cols + x;
      const inside = mask[index] === 1;
      const lit = lightAt ? lightAt(x, y) : 0;
      const density = inside ? light.base + light.peak * lit : light.halo * lit * lit;
      const cellAlpha = inside ? alpha : haloAlpha;
      const offset = index * 4;
      pixels[offset] = red;
      pixels[offset + 1] = green;
      pixels[offset + 2] = blue;
      pixels[offset + 3] = density > orderedDitherThreshold(x, y) ? cellAlpha : 0;
    }
  }
}
