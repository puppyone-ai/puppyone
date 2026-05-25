export const FLOATING_VIEWPORT_PADDING = 8;

export type FloatingPoint = {
  left: number;
  top: number;
};

export type FloatingSize = {
  width: number;
  height: number;
};

export type FloatingViewport = {
  width: number;
  height: number;
};

export type HorizontalSide = 'left' | 'right';

export function clampFloatingPoint(
  point: FloatingPoint,
  size: FloatingSize,
  viewport: FloatingViewport,
  padding = FLOATING_VIEWPORT_PADDING,
): FloatingPoint {
  return {
    left: Math.min(
      Math.max(point.left, padding),
      Math.max(padding, viewport.width - size.width - padding),
    ),
    top: Math.min(
      Math.max(point.top, padding),
      Math.max(padding, viewport.height - size.height - padding),
    ),
  };
}

export function chooseSubmenuSide(
  parentRect: DOMRect,
  submenuWidth: number,
  viewportWidth: number,
  gap = 4,
  padding = FLOATING_VIEWPORT_PADDING,
): HorizontalSide {
  const hasRoomRight = parentRect.right + gap + submenuWidth <= viewportWidth - padding;
  const hasRoomLeft = parentRect.left - gap - submenuWidth >= padding;

  if (!hasRoomRight && hasRoomLeft) return 'left';
  return 'right';
}
