import { describe, expect, it, vi } from "vitest";
import { createNativeConversationIndexer } from "../../../../electron/main/agent/application/history/native-conversation-indexer.mjs";
import { createAgentProcessSupervisor } from "../../../../electron/main/agent/application/processes/agent-process-supervisor.mjs";

const request = { workspaceRoot: "/workspace/a", runtimeId: "cursor", limit: 1 };
const proof = { scopeComplete: true, snapshotId: "snapshot-a" };

describe("native Agent conversation indexing", () => {
  it("times out discovery, releases process admission and never invalidates live readiness", async () => {
    const h = harness({ discoveryTimeoutMs: 10 });
    h.discover.mockReturnValueOnce(new Promise(() => {}));
    await expect(h.indexer.refresh(request)).resolves.toMatchObject({ status: "failed", indexed: 0,
      warnings: [expect.stringMatching(/timed out/i)] });
    expect(h.resolution.recordOperationFailure).not.toHaveBeenCalled();
    expect(h.dispose).toHaveBeenCalledOnce();
    expect(h.processSupervisor.snapshot()).toMatchObject({ inUse: 0, queued: 0 });
  });

  it("also bounds runtime resolution and does not create an adapter after its deadline", async () => {
    const ready = deferred();
    const h = harness({ discoveryTimeoutMs: 10 });
    h.resolution.resolveForOperation.mockReturnValueOnce(ready.promise);
    await expect(h.indexer.refresh(request)).resolves.toMatchObject({ status: "failed" });
    ready.resolve(selection());
    await Promise.resolve();
    expect(h.createAdapter).not.toHaveBeenCalled();
    expect(h.catalog.applyNativePage).not.toHaveBeenCalled();
  });

  it("reconciles only after all pages prove the same complete source snapshot", async () => {
    const h = harness();
    h.discover.mockResolvedValueOnce(page("a", "page-2", proof)).mockResolvedValueOnce(page("b", null, proof));
    const first = await h.indexer.refresh(request);
    expect(first).toMatchObject({ status: "partial", coverage: "unknown" });
    expect(h.catalog.applyNativePage.mock.calls[0][0].reconcileMissing).toBe(false);
    const second = await h.indexer.refresh({ ...request, cursor: first.nextCursor, scanId: first.scanId });
    expect(second).toMatchObject({ status: "complete", coverage: "complete", scanId: null });
    expect(h.catalog.applyNativePage.mock.calls[1][0]).toMatchObject({ reconcileMissing: true,
      scope: { providerSessionIds: ["a", "b"], startedRevision: 3, sourceScopeId: "default" } });
  });

  it.each([undefined, { scopeComplete: false, snapshotId: null }, { ...proof, snapshotId: "changed" }])(
    "never hides missing rows when source coverage is unproven or changes (%j)", async (coverage) => {
      const h = harness();
      h.discover.mockResolvedValueOnce(page("a", "page-2", proof)).mockResolvedValueOnce(page("b", null, coverage));
      const first = await h.indexer.refresh(request);
      await expect(h.indexer.refresh({ ...request, cursor: first.nextCursor, scanId: first.scanId }))
        .resolves.toMatchObject({ status: "complete", coverage: "unknown" });
      expect(h.catalog.applyNativePage.mock.calls.every(([value]) => !value.reconcileMissing)).toBe(true);
    });

  it("retains the exact failed page for retry without committing or reconciling it", async () => {
    const h = harness();
    h.discover.mockResolvedValueOnce(page("a", "page-2")).mockRejectedValueOnce(new Error("page failed"))
      .mockResolvedValueOnce(page("b"));
    const first = await h.indexer.refresh(request);
    const next = { ...request, cursor: first.nextCursor, scanId: first.scanId };
    await expect(h.indexer.refresh(next)).resolves.toMatchObject({ status: "failed", retryable: true,
      nextCursor: "page-2", scanId: first.scanId });
    expect(h.catalog.applyNativePage).toHaveBeenCalledOnce();
    await expect(h.indexer.refresh(next)).resolves.toMatchObject({ status: "complete", indexed: 1 });
  });

  it("rejects detached scope, changed page size and out-of-order continuation", async () => {
    const h = harness();
    h.discover.mockResolvedValueOnce(page("a", "page-2"));
    const first = await h.indexer.refresh(request);
    for (const mismatch of [{ workspaceRoot: "/workspace/b" }, { runtimeId: "codex" }, { limit: 2 }, { cursor: "page-3" }]) {
      await expect(h.indexer.refresh({ ...request, cursor: first.nextCursor, scanId: first.scanId, ...mismatch }))
        .resolves.toMatchObject({ status: "failed", retryable: false });
    }
    expect(h.discover).toHaveBeenCalledOnce();
  });

  it.each([
    { supported: true, sessions: [locator("valid"), { title: "no id" }], nextCursor: null },
    { supported: true, sessions: null, nextCursor: null },
    { ...page("a"), nextCursor: {} },
    { ...page("a"), nextCursor: "x".repeat(1025) },
  ])("rejects the entire malformed page before a catalog write (%j)", async (result) => {
    const h = harness();
    h.discover.mockResolvedValueOnce(result);
    await expect(h.indexer.refresh({ ...request, limit: 2 })).resolves.toMatchObject({ status: "failed", indexed: 0 });
    expect(h.catalog.applyNativePage).not.toHaveBeenCalled();
  });

  it("stops repeated cursors instead of retrying an endless source", async () => {
    const h = harness();
    h.discover.mockResolvedValueOnce(page("a", "page-2")).mockResolvedValueOnce(page("b", "page-2"));
    const first = await h.indexer.refresh(request);
    await expect(h.indexer.refresh({ ...request, cursor: first.nextCursor, scanId: first.scanId }))
      .resolves.toMatchObject({ status: "failed", retryable: false });
    expect(h.catalog.applyNativePage).toHaveBeenCalledOnce();
  });

  it("makes a superseded scan inert even when its native response arrives late", async () => {
    const oldPage = deferred();
    const h = harness();
    h.discover.mockReturnValueOnce(oldPage.promise).mockResolvedValueOnce(page("new", null, proof));
    const oldScan = h.indexer.refresh(request);
    await vi.waitFor(() => expect(h.discover).toHaveBeenCalledOnce());
    const newScan = h.indexer.refresh(request);
    await expect(newScan).resolves.toMatchObject({ status: "complete" });
    oldPage.resolve(page("old", null, proof));
    await expect(oldScan).resolves.toMatchObject({ status: "failed", retryable: false });
    expect(h.catalog.applyNativePage).toHaveBeenCalledOnce();
    expect(h.catalog.applyNativePage.mock.calls[0][0].entries[0].providerSessionId).toBe("new");
  });

  it("coalesces duplicate continuation requests into one native call and transaction", async () => {
    const wait = deferred();
    const h = harness();
    h.discover.mockResolvedValueOnce(page("a", "page-2")).mockReturnValueOnce(wait.promise);
    const first = await h.indexer.refresh(request);
    const next = { ...request, cursor: first.nextCursor, scanId: first.scanId };
    const one = h.indexer.refresh(next);
    const two = h.indexer.refresh(next);
    expect(one).toBe(two);
    wait.resolve(page("b"));
    await one;
    expect(h.discover).toHaveBeenCalledTimes(2);
  });

  it("does not reopen a source whose query resource failed disposal", async () => {
    const h = harness({ discoveryTimeoutMs: 15 });
    h.dispose.mockRejectedValue(new Error("dispose failed"));
    await h.indexer.refresh(request);
    await expect(h.indexer.refresh(request)).resolves.toMatchObject({ status: "failed" });
    expect(h.createAdapter).toHaveBeenCalledOnce();
  });

  it("reports an unsettled catalog commit honestly and requires refresh", async () => {
    const write = deferred();
    const h = harness({ discoveryTimeoutMs: 10 });
    h.catalog.applyNativePage.mockReturnValueOnce(write.promise);
    await expect(h.indexer.refresh(request)).resolves.toMatchObject({ status: "failed", retryable: false,
      catalogCommit: "pending", indexed: 0 });
    write.resolve({ indexed: 1 });
    await Promise.resolve();
  });

  it("bounds total pages and preserves source capacity feedback", async () => {
    const h = harness({ maxPages: 1 });
    h.catalog.applyNativePage.mockResolvedValue({ indexed: 1, truncated: true });
    h.discover.mockResolvedValueOnce(page("a", "page-2")).mockResolvedValueOnce(page("b"));
    const first = await h.indexer.refresh(request);
    expect(first.warnings).toEqual([expect.stringMatching(/capacity/)]);
    await expect(h.indexer.refresh({ ...request, cursor: first.nextCursor, scanId: first.scanId }))
      .resolves.toMatchObject({ status: "failed", retryable: false });
    expect(h.catalog.applyNativePage).toHaveBeenCalledOnce();
  });
});

function harness(options = {}) {
  const discover = vi.fn(async () => page("a"));
  const dispose = vi.fn(async () => {});
  const createAdapter = vi.fn(() => ({ getSessionHistoryPort: () => ({ discover }), dispose }));
  const resolution = { resolveForOperation: vi.fn(async () => selection()), recordOperationFailure: vi.fn() };
  const catalog = { getRevision: vi.fn(async () => 3),
    applyNativePage: vi.fn(async ({ entries, guard }) => { guard(); return { indexed: entries.length, truncated: false }; }) };
  const processSupervisor = createAgentProcessSupervisor({ maxConcurrentStarts: 1 });
  return { discover, dispose, createAdapter, resolution, catalog, processSupervisor,
    indexer: createNativeConversationIndexer({ runtimeRegistry: { createAdapter },
      runtimeResolutionCoordinator: resolution, catalog, processSupervisor, ...options }) };
}
function selection() { return { descriptor: { id: "cursor", displayName: "Cursor", ownership: { session: "runtime" } }, readiness: { status: "ready" } }; }
function locator(providerSessionId) { return { providerSessionId, title: providerSessionId,
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }; }
function page(id, nextCursor = null, coverage) { return { supported: true, sessions: [locator(id)], nextCursor, coverage }; }
function deferred() { let resolve; const promise = new Promise((next) => { resolve = next; }); return { promise, resolve }; }
