import type { NativeSurfaceBounds } from "./nativeSurfaceGeometry";

const chrome = new Map<number, { bounds: NativeSurfaceBounds; element?: HTMLElement }>();
const listeners = new Set<() => void>();

/** Fixed Shell paint footprints, distinct from the wider pointer routing lane. */
export function setNativeSurfacePaneChrome(id: number, bounds: NativeSurfaceBounds | null, element?: HTMLElement): void {
  if (!bounds) element = undefined;
  const previous = chrome.get(id);
  if (JSON.stringify(previous?.bounds ?? null) === JSON.stringify(bounds) && previous?.element === element) return;
  if (bounds) chrome.set(id, { bounds, element });
  else chrome.delete(id);
  for (const listener of listeners) listener();
}

export function subscribeNativeSurfacePaneChrome(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Only trim a complete outer edge. An interior overlay needs the separate
 * occlusion contract; it cannot be represented by a rectangular View bound. */
export function excludeNativeSurfacePaneChrome(bounds: NativeSurfaceBounds): NativeSurfaceBounds {
  let { x, y, width, height } = bounds;
  let right = x + width;
  let bottom = y + height;
  for (const entry of chrome.values()) {
    // Read in the slot's measurement phase. Subscriber insertion order must
    // never expose a previous frame's chrome while the native slot has moved.
    const edge = entry.element ? measureNativeSurfacePaneChrome(entry.element) : entry.bounds;
    if (!edge) continue;
    const edgeRight = edge.x + edge.width;
    const edgeBottom = edge.y + edge.height;
    if (edge.y <= y && edgeBottom >= bottom) {
      if (edge.x <= x && edgeRight > x) x = Math.min(right, edgeRight);
      else if (edge.x < right && edgeRight >= right) right = Math.max(x, edge.x);
    }
    if (edge.x <= x && edgeRight >= right) {
      if (edge.y <= y && edgeBottom > y) y = Math.min(bottom, edgeBottom);
      else if (edge.y < bottom && edgeBottom >= bottom) bottom = Math.max(y, edge.y);
    }
  }
  width = right - x;
  height = bottom - y;
  return Object.freeze({ x, y, width, height });
}

export function measureNativeSurfacePaneChrome(element: HTMLElement): NativeSurfaceBounds | null {
  if (!element.isConnected) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { x: Math.floor(rect.left), y: Math.floor(rect.top),
    width: Math.ceil(rect.right) - Math.floor(rect.left),
    height: Math.ceil(rect.bottom) - Math.floor(rect.top) };
}
