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

const activeLayoutLeases = new Map<number, string>();
const listeners = new Set<() => void>();
let nextLeaseId = 1;

/**
 * Marks a shell-owned layout mutation that cannot be applied atomically to a
 * native child view. Geometry subscribers keep publishing current bounds but
 * suspend the child until the final, stable revision is committed.
 */
export function acquireNativeSurfaceLayoutLease(owner: string): NativeSurfaceLayoutLease {
  const id = nextLeaseId++;
  let released = false;
  activeLayoutLeases.set(id, owner);
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

export function measureNativeSurfaceBounds(element: HTMLElement): NativeSurfaceBounds {
  const rect = element.getBoundingClientRect();
  const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
  const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
  const left = clamp(Math.floor(rect.left), 0, viewportWidth - 1);
  const top = clamp(Math.floor(rect.top), 0, viewportHeight - 1);
  const right = clamp(Math.ceil(rect.right), left + 1, viewportWidth);
  const bottom = clamp(Math.ceil(rect.bottom), top + 1, viewportHeight);
  return Object.freeze({ x: left, y: top, width: right - left, height: bottom - top });
}

export function isNativeSurfaceElementVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || document.visibilityState === "hidden") return false;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= viewportWidth || rect.top >= viewportHeight) {
    return false;
  }
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function notify() {
  for (const listener of [...listeners]) listener();
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
