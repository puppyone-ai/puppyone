export type WordPreviewZoom = "fit" | number;

export const WORD_PREVIEW_ZOOM_LEVELS = Object.freeze([
  0.5,
  0.67,
  0.75,
  0.8,
  0.9,
  1,
  1.1,
  1.25,
  1.5,
  1.75,
  2,
]);

const MIN_WORD_PREVIEW_SCALE = WORD_PREVIEW_ZOOM_LEVELS[0];
const MAX_WORD_PREVIEW_SCALE = WORD_PREVIEW_ZOOM_LEVELS.at(-1) ?? 2;
const MIN_WORD_PREVIEW_FIT_SCALE = 0.25;

export function resolveWordPreviewScale({
  availableWidth,
  pageWidth,
  zoom,
}: {
  availableWidth: number;
  pageWidth: number;
  zoom: WordPreviewZoom;
}): number {
  if (typeof zoom === "number") return clampWordPreviewScale(zoom);
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return 1;
  if (!Number.isFinite(pageWidth) || pageWidth <= 0) return 1;
  return Math.min(1, Math.max(MIN_WORD_PREVIEW_FIT_SCALE, availableWidth / pageWidth));
}

export function stepWordPreviewScale(
  currentScale: number,
  direction: -1 | 1,
): number {
  const current = Number.isFinite(currentScale) ? currentScale : 1;
  if (direction < 0) {
    return [...WORD_PREVIEW_ZOOM_LEVELS].reverse().find((level) => level < current - 0.005)
      ?? MIN_WORD_PREVIEW_SCALE;
  }
  return WORD_PREVIEW_ZOOM_LEVELS.find((level) => level > current + 0.005)
    ?? MAX_WORD_PREVIEW_SCALE;
}

export function clampWordPreviewScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_WORD_PREVIEW_SCALE, Math.max(MIN_WORD_PREVIEW_SCALE, scale));
}
