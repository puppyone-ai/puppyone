export type NativeSurfaceBounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type NativeSurfaceGeometry = Readonly<{
  bounds: NativeSurfaceBounds;
  revision: number;
  visible: boolean;
}>;

export type NativeSurfaceLayoutLease = Readonly<{
  owner: string;
  release: () => void;
}>;

// Sampling is window-local. Visibility suspension is an explicit, subtree-scoped
// exception for clipped CSS enter/exit transitions, never a resize side effect.
const activeLayoutLeases = new Map<number, { owner: string; suspendWithin?: HTMLElement }>();
const listeners = new Set<() => void>();
let nextLeaseId = 1;
const frameListeners = new Set<() => void>();
let frameId: number | null = null;
let settlingFrames = 0;

/** One shared frame clock for native bounds and input regions during layout. */
export function subscribeNativeSurfaceLayoutFrames(listener: () => void): () => void {
  frameListeners.add(listener);
  scheduleFrame();
  return () => {
    frameListeners.delete(listener);
    if (frameListeners.size === 0 && frameId !== null) {
      window.cancelAnimationFrame(frameId);
      frameId = null;
    }
  };
}

function scheduleFrame() {
  if (frameId !== null || frameListeners.size === 0
    || (activeLayoutLeases.size === 0 && settlingFrames === 0)) return;
  frameId = window.requestAnimationFrame(() => {
    frameId = null;
    settlingFrames = Math.max(0, settlingFrames - 1);
    for (const listener of [...frameListeners]) listener();
    scheduleFrame();
  });
}

/**
 * Samples shell-owned layout mutations until their final committed frame.
 * Native content remains visible during live resize. Only a caller that cannot
 * represent a CSS transition in native bounds may suspend its own subtree.
 */
export function acquireNativeSurfaceLayoutLease(
  owner: string,
  options: { suspendWithin?: HTMLElement } = {},
): NativeSurfaceLayoutLease {
  const id = nextLeaseId++;
  let released = false;
  activeLayoutLeases.set(id, { owner, ...options });
  notify();
  return {
    owner,
    release: () => {
      if (released) return;
      released = true;
      activeLayoutLeases.delete(id);
      notify();
    },
  };
}

export function isNativeSurfaceLayoutStable(): boolean {
  return activeLayoutLeases.size === 0;
}

export function subscribeNativeSurfaceLayoutActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Native views do not inherit DOM overflow. Project the slot into each
 * ancestor's clipping box, excluding its border and classic scrollbar lane.
 * Inward rounding ensures native pixels never paint over shell-owned chrome.
 */
export function measureNativeSurfaceBounds(element: HTMLElement): NativeSurfaceBounds {
  const rect = element.getBoundingClientRect();
  const viewportWidth = Math.max(0, window.innerWidth || document.documentElement.clientWidth);
  const viewportHeight = Math.max(0, window.innerHeight || document.documentElement.clientHeight);
  let left = Math.max(0, rect.left);
  let top = Math.max(0, rect.top);
  let right = Math.min(viewportWidth, rect.right);
  let bottom = Math.min(viewportHeight, rect.bottom);
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    const clipsX = /^(hidden|clip|auto|scroll)$/.test(style.overflowX || style.overflow);
    const clipsY = /^(hidden|clip|auto|scroll)$/.test(style.overflowY || style.overflow);
    if (!clipsX && !clipsY) continue;
    const box = parent.getBoundingClientRect();
    const borderLeft = parseFloat(style.borderLeftWidth) || 0;
    const borderTop = parseFloat(style.borderTopWidth) || 0;
    // clientLeft includes a left-hand classic scrollbar (e.g. RTL).
    const contentLeft = box.left + Math.max(parent.clientLeft, borderLeft);
    const contentTop = box.top + Math.max(parent.clientTop, borderTop);
    const borderRight = box.right - (parseFloat(style.borderRightWidth) || 0);
    const contentRight = parent.clientWidth > 0
      ? Math.min(borderRight, contentLeft + parent.clientWidth) : borderRight;
    const borderBottom = box.bottom - (parseFloat(style.borderBottomWidth) || 0);
    const contentBottom = parent.clientHeight > 0
      ? Math.min(borderBottom, contentTop + parent.clientHeight) : borderBottom;
    if (clipsX) { left = Math.max(left, contentLeft); right = Math.min(right, contentRight); }
    if (clipsY) { top = Math.max(top, contentTop); bottom = Math.min(bottom, contentBottom); }
  }
  left = clamp(Math.ceil(left), 0, viewportWidth);
  top = clamp(Math.ceil(top), 0, viewportHeight);
  return Object.freeze({ x: left, y: top,
    width: Math.max(0, Math.floor(right) - left),
    height: Math.max(0, Math.floor(bottom) - top) });
}

export function isNativeSurfaceElementVisible(
  element: HTMLElement,
  bounds = measureNativeSurfaceBounds(element),
): boolean {
  if (!element.isConnected || bounds.width <= 0 || bounds.height <= 0
    || document.visibilityState === "hidden") return false;
  for (const { suspendWithin } of activeLayoutLeases.values()) {
    if (suspendWithin?.contains(element)) return false;
  }
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (current.hasAttribute("inert") || style.display === "none"
      || style.visibility === "hidden" || style.visibility === "collapse") return false;
  }
  return true;
}

function notify() {
  // Two frames also cover React's final width commit after pointer release.
  settlingFrames = 2;
  scheduleFrame();
  for (const listener of [...listeners]) listener();
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
