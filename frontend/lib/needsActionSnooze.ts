/**
 * Client-side snooze for Needs Action items.
 *
 * Per PUP-5 §6 D4: snooze is intentionally local-only for v1. The key
 * shape ``puppyone:needs-action:snooze:{project_id}:{kind}:{id}`` →
 * expiry timestamp lets us:
 *   - Cleanly key off whatever the backend's item id is.
 *   - Drop the project / kind dimensions later if we add server-side
 *     snooze without affecting consumers.
 *   - Sweep expired entries lazily on every read (no GC needed).
 *
 * Localstorage access is wrapped because:
 *   - SSR (Next.js build / prerender) lacks ``window``.
 *   - Some embedded WebViews and incognito Safari throw on writes.
 * Either makes a hard crash on a sidebar component genuinely
 * disproportionate.
 */

const KEY_PREFIX = 'puppyone:needs-action:snooze:';
const DEFAULT_SNOOZE_MS = 24 * 60 * 60 * 1000;

export interface SnoozeKey {
  projectId: string;
  kind: string;
  id: string;
}

function storageKey({ projectId, kind, id }: SnoozeKey): string {
  return `${KEY_PREFIX}${projectId}:${kind}:${id}`;
}

function safeLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Snooze an item until ``now + durationMs`` (default 24h). */
export function snoozeUntil(key: SnoozeKey, durationMs: number = DEFAULT_SNOOZE_MS): void {
  const store = safeLocalStorage();
  if (!store) return;
  try {
    store.setItem(storageKey(key), String(Date.now() + durationMs));
  } catch {
    // Quota exceeded / corrupted store — silently ignore. The cost
    // of a missed snooze is "the user sees the row again", not data
    // loss.
  }
}

/** Remove a snooze (e.g. when the user explicitly un-snoozes). */
export function unsnooze(key: SnoozeKey): void {
  const store = safeLocalStorage();
  if (!store) return;
  try {
    store.removeItem(storageKey(key));
  } catch {
    /* ignore */
  }
}

/** True iff ``now < expiry``. Sweeps the entry when expired so we
 *  don't accumulate stale keys in storage. */
export function isSnoozed(key: SnoozeKey): boolean {
  const store = safeLocalStorage();
  if (!store) return false;
  let raw: string | null;
  try {
    raw = store.getItem(storageKey(key));
  } catch {
    return false;
  }
  if (!raw) return false;
  const expiry = Number(raw);
  if (!Number.isFinite(expiry)) return false;
  if (Date.now() >= expiry) {
    // Lazy GC — the read costs one delete; no separate sweeper.
    try {
      store.removeItem(storageKey(key));
    } catch {
      /* ignore */
    }
    return false;
  }
  return true;
}

/** Bulk filter: drop entries whose ``id`` is currently snoozed. The
 *  ``getId`` adapter lets callers point at any record shape without
 *  forcing a wrapper type. */
export function filterSnoozed<T>(
  items: T[],
  ctx: { projectId: string; kind: string },
  getId: (item: T) => string,
): T[] {
  return items.filter(
    (item) => !isSnoozed({ projectId: ctx.projectId, kind: ctx.kind, id: getId(item) }),
  );
}
