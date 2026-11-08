/** Successful intrinsic dimensions only: no asset handles, URLs or DOM nodes.
 * Each editor owns a separate bounded store; responsive CSS derives its boxes. */
export type MarkdownImageGeometry = Readonly<{ naturalWidth: number; naturalHeight: number }>;
export type ImageGeometrySnapshot = Readonly<{
  revision: number;
  read(documentPath: string, source: string): MarkdownImageGeometry | null;
}>;
const identity = (documentPath: string, source: string) => JSON.stringify([documentPath, source]);
export function estimateMarkdownImageHeight(
  geometry: MarkdownImageGeometry | null,
  availableWidth: number,
  displayMode: "inline" | "block",
  size: Readonly<{ width: number; height: number | null }> | null,
): number {
  if (!geometry || !Number.isFinite(availableWidth) || availableWidth <= 0) return -1;
  const width = Math.min(availableWidth, size?.width ?? geometry.naturalWidth);
  const height = size?.height ?? width * geometry.naturalHeight / geometry.naturalWidth;
  return displayMode === "inline" ? Math.min(320, height) : height;
}
export function createImageGeometryCache() {
  const entries = new Map<string, MarkdownImageGeometry>();
  const listeners = new Set<() => void>();
  let revision = 0;
  const publish = () => { revision++; for (const listener of listeners) listener(); };
  return {
    get size() { return entries.size; },
    get revision() { return revision; },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot(): ImageGeometrySnapshot {
      const copy = new Map(entries);
      return { revision, read: (documentPath, source) => copy.get(identity(documentPath, source)) ?? null };
    },
    read(documentPath: string, source: string): MarkdownImageGeometry | null {
      return entries.get(identity(documentPath, source)) ?? null;
    },
    remember(documentPath: string, source: string, geometry: MarkdownImageGeometry) {
      if (![geometry.naturalWidth, geometry.naturalHeight].every(n => Number.isFinite(n) && n > 0)) return;
      const key = identity(documentPath, source), previous = entries.get(key);
      if (previous?.naturalWidth === geometry.naturalWidth && previous.naturalHeight === geometry.naturalHeight) return;
      entries.delete(key);
      entries.set(key, Object.freeze({ ...geometry }));
      while (entries.size > 500) entries.delete(entries.keys().next().value!);
      publish();
    },
    forget(documentPath: string, source: string) { if (entries.delete(identity(documentPath, source))) publish(); },
    clear() { if (entries.size) { entries.clear(); publish(); } },
  };
}
