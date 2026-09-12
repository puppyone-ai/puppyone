import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitRevisionPair } from "../src/types/electron";
import { WeightedTtlLruCache } from "../../../../../src/features/source-control/diff/core/WeightedTtlLruCache";
import { clearFormatAwareDiffCaches } from "../../../../../src/features/source-control/diff/core/cacheControl";
import {
  clearDocxRedlineCache,
  createDocxRedlineCacheKey,
  getDocxRedlineCacheUsageForTests,
  writeDocxRedlineCache,
} from "../../../../../src/features/source-control/diff/contributions/docx-redline/cache";
import { loadDocxRedline } from "../../../../../src/features/source-control/diff/contributions/docx-redline/provider";
import type { DocxRedlinePresentation } from "../../../../../src/features/source-control/diff/contributions/docx-redline/model";

afterEach(() => {
  vi.useRealTimers();
  clearDocxRedlineCache();
});

describe("DOCX redline cache", () => {
  it("evicts by aggregate model weight and still promotes recently read entries", () => {
    const cache = new WeightedTtlLruCache<number>({
      maxEntries: 3,
      maxWeight: 5,
      ttlMs: 60_000,
      weightOf: (value) => value,
    });
    cache.set("a", 2);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(2);
    cache.set("c", 2);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(2);
    expect(cache.get("c")).toBe(2);
    expect(cache.totalWeight).toBe(4);
    cache.clear();
  });

  it("actively expires entries without requiring a later read", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const cache = new WeightedTtlLruCache<number>({
      maxEntries: 2,
      maxWeight: 10,
      ttlMs: 50,
      weightOf: (value) => value,
    });
    cache.set("short-lived", 1);
    expect(cache.size).toBe(1);
    vi.advanceTimersByTime(50);
    expect(cache.size).toBe(0);
    expect(cache.totalWeight).toBe(0);
  });

  it("invalidates keys when either identity or renderer version changes", () => {
    const pair = revisionPair();
    expect(createDocxRedlineCacheKey(pair, "1")).not.toBe(createDocxRedlineCacheKey({
      ...pair,
      after: { ...pair.after, identity: "after:2" },
    }, "1"));
    expect(createDocxRedlineCacheKey(pair, "1")).not.toBe(createDocxRedlineCacheKey(pair, "2"));
  });

  it("clears loaded format caches when the workspace boundary changes", () => {
    expect(writeDocxRedlineCache("workspace-a", presentation())).toBe(true);
    expect(getDocxRedlineCacheUsageForTests().entries).toBe(1);
    clearFormatAwareDiffCaches();
    expect(getDocxRedlineCacheUsageForTests()).toEqual({ entries: 0, weightBytes: 0 });
  });

  it("reuses successful models, releases successful sessions, and never caches failures", async () => {
    const pair = revisionPair();
    const memory = new Map<string, DocxRedlinePresentation>();
    const readResource = vi.fn(async () => new ArrayBuffer(4));
    const releaseResources = vi.fn(async () => undefined);
    const model = presentation();
    const build = vi.fn(async () => model);
    const dependencies = {
      readResource,
      releaseResources,
      build,
      readCache: (key: string) => memory.get(key),
      writeCache: (key: string, value: DocxRedlinePresentation) => {
        memory.set(key, value);
        return true;
      },
    };

    await loadDocxRedline(pair, new AbortController().signal, dependencies);
    await loadDocxRedline(pair, new AbortController().signal, dependencies);
    expect(build).toHaveBeenCalledOnce();
    expect(readResource).toHaveBeenCalledTimes(2);
    expect(releaseResources).toHaveBeenCalledTimes(2);
    expect(releaseResources).toHaveBeenLastCalledWith(pair.sessionId);

    memory.clear();
    build.mockRejectedValueOnce(new Error("bad package"));
    await expect(loadDocxRedline(pair, new AbortController().signal, dependencies)).rejects.toThrow("bad package");
    expect(memory.size).toBe(0);
    expect(releaseResources).toHaveBeenCalledTimes(2);
  });
});

function revisionPair(): GitRevisionPair {
  return {
    repositoryIdentity: "repo:1",
    selectionIdentity: "selection:1",
    sessionId: "git-diff-session:test",
    scope: "unstaged",
    path: "report.docx",
    oldPath: null,
    status: "modified",
    before: { kind: "resource", identity: "before:1", size: 4, mimeType: "application/docx", handle: "b" },
    after: { kind: "resource", identity: "after:1", size: 4, mimeType: "application/docx", handle: "a" },
  };
}

function presentation(): DocxRedlinePresentation {
  return {
    kind: "docx-redline",
    rendererVersion: "3",
    state: "empty",
    stats: {
      blocksAdded: 0,
      blocksDeleted: 0,
      blocksModified: 0,
      blocksChanged: 0,
      wordsAdded: 0,
      wordsDeleted: 0,
    },
    changes: [],
    truncated: false,
    fidelity: "body-text-v1",
  };
}
