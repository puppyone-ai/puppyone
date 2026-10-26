/**
 * One line weight for every file glyph: the weight of the label text beside
 * it. At explorer size (18px) and below the line holds one CSS pixel, so a
 * 14px menu glyph is as fine as an 18px tree glyph; above it the line grows
 * with the glyph so large previews keep their proportions.
 */
export const FILE_GLYPH_LINE_PX = 1;
const EXPLORER_GLYPH_SIZE = 18;

/** Stroke width in a glyph's own viewBox units for the shared line weight. */
export function glyphLine(size: number, viewBox = 18, weight = 1): number {
  const px = FILE_GLYPH_LINE_PX * Math.max(1, size / EXPLORER_GLYPH_SIZE) * weight;
  return Number(((px * viewBox) / Math.max(1, size)).toFixed(3));
}
