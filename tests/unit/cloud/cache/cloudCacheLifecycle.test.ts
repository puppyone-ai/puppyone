import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopCloudSession } from "../../../../src/lib/cloudApi";
import {
  cloudCache,
  createCloudCache,
  invalidateCloudCacheForMutation,
} from "../../../../src/features/cloud/cache/cloudCache";

describe("account/revision-aware Cloud cache", () => {
  beforeEach(() => {
    cloudCache.clear();
    cloudCache.activateSession(null);
  });

  it("coalesces requests and keys results by immutable account generation and revision", async () => {
    const cache = createCloudCache();
    const session = createSession("generation-1");
    const context = {
      session,
      projectId: "project-1",
      revision: "head-a",
      resource: "tree",
      path: "docs",
    };
    const loader = vi.fn(async () => ["a", "b"]);

    const [left, right] = await Promise.all([
      cache.load(context, loader, { ttlMs: 30_000 }),
      cache.load(context, loader, { ttlMs: 30_000 }),
    ]);

    expect(left).toEqual(["a", "b"]);
    expect(right).toEqual(["a", "b"]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cache.read(context)).toEqual(["a", "b"]);
    expect(cache.read({ ...context, revision: "head-b" })).toBeUndefined();
  });

  it("drops a late old-generation response after account/session rotation", async () => {
    const cache = createCloudCache();
    let resolveOld: (value: string[]) => void = () => {};
    const oldSession = createSession("generation-old");
    const newSession = createSession("generation-new");
    const oldContext = createContext(oldSession);
    const oldRequest = cache.load(
      oldContext,
      () => new Promise<string[]>((resolve) => { resolveOld = resolve; }),
      { ttlMs: 30_000 },
    );

    cache.activateSession(newSession);
    resolveOld(["stale"]);
    await expect(oldRequest).resolves.toEqual(["stale"]);

    expect(cache.snapshot().entries).toBe(0);
    expect(cache.read({ ...oldContext, session: newSession })).toBeUndefined();
  });

  it("expires mutable data and enforces both entry and byte bounds", async () => {
    let currentTime = 100;
    const cache = createCloudCache({ maxEntries: 2, maxBytes: 30, now: () => currentTime });
    const session = createSession("generation-1");
    const first = createContext(session, "one");
    await cache.load(first, async () => "1234567890", { ttlMs: 10 });
    currentTime = 111;
    expect(cache.read(first)).toBeUndefined();

    await cache.load(createContext(session, "two"), async () => "1234567890", { ttlMs: 100 });
    await cache.load(createContext(session, "three"), async () => "1234567890", { ttlMs: 100 });
    await cache.load(createContext(session, "four"), async () => "1234567890", { ttlMs: 100 });
    expect(cache.snapshot().entries).toBeLessThanOrEqual(2);
    expect(cache.snapshot().bytes).toBeLessThanOrEqual(30);
    expect(cache.snapshot().evictions).toBeGreaterThan(0);
  });

  it("invalidates a project namespace after a successful mutation and clears on logout", async () => {
    const session = createSession("generation-1");
    const context = createContext(session);
    cloudCache.activateSession(session);
    await cloudCache.load(context, async () => ["cached"], { ttlMs: 30_000 });
    expect(cloudCache.read(context)).toEqual(["cached"]);

    invalidateCloudCacheForMutation({
      session,
      apiPath: "/content/project-1/write",
    });
    expect(cloudCache.read(context)).toBeUndefined();

    await cloudCache.load(context, async () => ["cached-again"], { ttlMs: 30_000 });
    cloudCache.activateSession(null);
    expect(cloudCache.snapshot().entries).toBe(0);
  });

  it("does not join or cache a stale read that resolves after mutation invalidation", async () => {
    const cache = createCloudCache();
    const context = createContext(createSession("generation-1"));
    let resolveStale: (value: string[]) => void = () => {};
    const staleRequest = cache.load(
      context,
      () => new Promise<string[]>((resolve) => { resolveStale = resolve; }),
      { ttlMs: 30_000 },
    );

    cache.invalidate({ projectId: context.projectId });
    const freshLoader = vi.fn(async () => ["fresh"]);
    await expect(cache.load(context, freshLoader, { ttlMs: 30_000 })).resolves.toEqual(["fresh"]);
    resolveStale(["stale"]);
    await expect(staleRequest).resolves.toEqual(["stale"]);

    expect(freshLoader).toHaveBeenCalledTimes(1);
    expect(cache.read(context)).toEqual(["fresh"]);
  });
});

function createSession(generation: string): DesktopCloudSession {
  return {
    expires_in: 3600,
    expires_at: Date.now() + 3_600_000,
    user_id: "user-1",
    user_email: "user@example.com",
    api_base_url: "https://api.puppyone.ai/api/v1",
    session_generation: generation,
    status: "authenticated",
  };
}

function createContext(session: DesktopCloudSession, resource = "tree") {
  return {
    session,
    projectId: "project-1",
    revision: "head-a",
    resource,
    path: "docs",
  };
}
