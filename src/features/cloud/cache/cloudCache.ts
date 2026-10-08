import type { DesktopCloudSession } from "../../../lib/cloudApi";

const DEFAULT_MAX_ENTRIES = 320;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const CACHE_SCHEMA_VERSION = 1;

export type CloudCacheContext = {
  session: DesktopCloudSession;
  projectId: string;
  revision: string;
  resource: string;
  path?: string;
  schemaVersion?: number;
};

type CacheEntry = {
  value: unknown;
  expiresAt: number;
  bytes: number;
  namespace: string;
  projectId: string;
  path: string;
};

type PendingRead = {
  promise: Promise<unknown>;
  projectId: string;
  path: string;
  valid: boolean;
};

export function createCloudCache({
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxBytes = DEFAULT_MAX_BYTES,
  now = () => Date.now(),
}: {
  maxEntries?: number;
  maxBytes?: number;
  now?: () => number;
} = {}) {
  const entries = new Map<string, CacheEntry>();
  const requests = new Map<string, PendingRead>();
  let activeNamespace: string | null = null;
  let totalBytes = 0;
  let cacheEpoch = 0;
  const stats = { hits: 0, misses: 0, evictions: 0 };

  function activateSession(session: DesktopCloudSession | null) {
    const nextNamespace = session ? sessionNamespace(session) : null;
    if (activeNamespace === nextNamespace) return;
    activeNamespace = nextNamespace;
    clear();
  }

  function read<T>(context: CloudCacheContext, { allowStale = false } = {}): T | undefined {
    const key = cacheKey(context);
    const entry = entries.get(key);
    if (!entry) {
      stats.misses += 1;
      return undefined;
    }
    if (entry.namespace !== activeNamespace || (!allowStale && entry.expiresAt <= now())) {
      // Keep expired snapshots within the same LRU budget so views can paint
      // them while load() coalesces a fresh read in the background.
      stats.misses += 1;
      return undefined;
    }
    // Map insertion order is the LRU order.
    entries.delete(key);
    entries.set(key, entry);
    stats.hits += 1;
    return entry.value as T;
  }

  function load<T>(
    context: CloudCacheContext,
    loader: () => Promise<T>,
    { ttlMs }: { ttlMs: number },
  ): Promise<T> {
    activateSession(context.session);
    const cached = read<T>(context);
    if (cached !== undefined) return Promise.resolve(cached);
    const key = cacheKey(context);
    const existing = requests.get(key);
    if (existing) return existing.promise as Promise<T>;
    const capturedNamespace = sessionNamespace(context.session);
    const capturedEpoch = cacheEpoch;
    const pending: PendingRead = { projectId: context.projectId, path: normalizePath(context.path),
      valid: true, promise: undefined as unknown as Promise<T> };
    const request = loader()
      .then((value) => {
        if (!pending.valid || activeNamespace !== capturedNamespace || cacheEpoch !== capturedEpoch) return value;
        // Some reads need in-flight deduplication, but no reusable snapshot
        // (notably document bodies and their optimistic-write baselines).
        if (ttlMs <= 0) return value;
        const entry: CacheEntry = {
          value,
          expiresAt: now() + Math.max(0, ttlMs),
          bytes: estimateBytes(value),
          namespace: capturedNamespace,
          projectId: context.projectId,
          path: normalizePath(context.path),
        };
        const previous = entries.get(key);
        if (previous) deleteEntry(key, previous);
        entries.set(key, entry);
        totalBytes += entry.bytes;
        trim();
        return value;
      })
      .finally(() => {
        if (requests.get(key) === pending) requests.delete(key);
      });
    pending.promise = request;
    requests.set(key, pending);
    return request;
  }

  function invalidate({
    projectId,
    path: changedPath,
  }: {
    projectId?: string | null;
    path?: string | null;
  } = {}) {
    // A read that began before a successful mutation must never become the
    // source for a read that begins afterwards or refill the cache late.
    const normalizedChangedPath = normalizePath(changedPath);
    const matches = (entry: { projectId: string; path: string }) =>
      (!projectId || entry.projectId === projectId)
      && (!normalizedChangedPath || !entry.path || pathsOverlap(entry.path, normalizedChangedPath));
    for (const [key, pending] of requests) {
      if (!matches(pending)) continue;
      pending.valid = false;
      requests.delete(key);
    }
    for (const [key, entry] of entries) {
      if (!matches(entry)) continue;
      deleteEntry(key, entry);
    }
  }

  function clear() {
    cacheEpoch += 1;
    entries.clear();
    requests.clear();
    totalBytes = 0;
  }

  function trim() {
    while (entries.size > maxEntries || totalBytes > maxBytes) {
      const oldest = entries.entries().next().value as [string, CacheEntry] | undefined;
      if (!oldest) break;
      deleteEntry(oldest[0], oldest[1]);
      stats.evictions += 1;
    }
  }

  function deleteEntry(key: string, entry: CacheEntry) {
    if (!entries.delete(key)) return;
    totalBytes = Math.max(0, totalBytes - entry.bytes);
  }

  return {
    activateSession,
    read,
    load,
    invalidate,
    clear,
    snapshot: () => ({
      activeNamespace,
      entries: entries.size,
      bytes: totalBytes,
      requests: requests.size,
      ...stats,
    }),
  };
}

export const cloudCache = createCloudCache();

export function activateCloudCacheSession(session: DesktopCloudSession | null) {
  cloudCache.activateSession(session);
}

export function readCloudCache<T>(context: CloudCacheContext): T | undefined {
  cloudCache.activateSession(context.session);
  return cloudCache.read<T>(context);
}

export function loadCloudCache<T>(
  context: CloudCacheContext,
  loader: () => Promise<T>,
  options: { ttlMs: number },
): Promise<T> {
  return cloudCache.load(context, loader, options);
}

export function invalidateCloudCacheForMutation({
  session,
  apiPath,
}: {
  session: DesktopCloudSession;
  apiPath: string;
}) {
  cloudCache.activateSession(session);
  const parsed = parseProjectMutationPath(apiPath);
  cloudCache.invalidate(parsed);
}

function cacheKey(context: CloudCacheContext) {
  return [
    context.session.user_id,
    context.session.session_generation,
    context.session.api_base_url,
    context.projectId,
    context.revision,
    context.resource,
    normalizePath(context.path),
    context.schemaVersion ?? CACHE_SCHEMA_VERSION,
  ].join("\n");
}

function sessionNamespace(session: DesktopCloudSession) {
  return [session.user_id, session.session_generation, session.api_base_url].join("\n");
}

function parseProjectMutationPath(apiPath: string) {
  const pathOnly = apiPath.split("?", 1)[0];
  const match = pathOnly.match(/^\/(?:content|projects)\/([^/]+)/);
  return {
    projectId: match?.[1] ? decodeURIComponent(match[1]) : null,
  };
}

function normalizePath(value: string | null | undefined) {
  if (typeof value !== "string") return "";
  return value.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}

function pathsOverlap(left: string, right: string) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function estimateBytes(value: unknown) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return 1024;
  }
}
