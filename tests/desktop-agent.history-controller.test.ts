import { describe, expect, it, vi } from "vitest";
import { ConversationHistoryController } from "../src/features/desktop-agent/application/ConversationHistoryController";

describe("ConversationHistoryController", () => {
  it("makes an earlier workspace generation inert after deactivation", async () => {
    const firstCatalog = deferred<ReturnType<typeof catalog>>();
    const listAgentSessions = vi.fn()
      .mockReturnValueOnce(firstCatalog.promise)
      .mockResolvedValueOnce(catalog([savedSession("new-generation")]));
    const client = historyClient({ listAgentSessions });
    const controller = new ConversationHistoryController("/workspace", () => client as never);

    controller.activate();
    controller.deactivate();
    controller.activate();
    await vi.waitFor(() => expect(controller.getSnapshot().sessions.map((entry) => entry.id))
      .toEqual(["new-generation"]));

    firstCatalog.resolve(catalog([savedSession("stale-generation")]));
    await Promise.resolve();
    expect(controller.getSnapshot().sessions.map((entry) => entry.id)).toEqual(["new-generation"]);
    expect(client.createAgentSession).not.toHaveBeenCalled();
    expect(client.resumeAgentSession).not.toHaveBeenCalled();
    expect(client.openAgentSession).not.toHaveBeenCalled();
    expect(client.onAgentEvent).not.toHaveBeenCalled();
  });

  it("keeps concurrent workspace catalogs isolated", async () => {
    const listAgentSessions = vi.fn(async ({ rootPath }: { rootPath: string }) => (
      catalog([savedSession(rootPath === "/workspace/a" ? "workspace-a" : "workspace-b")])
    ));
    const client = historyClient({ listAgentSessions });
    const first = new ConversationHistoryController("/workspace/a", () => client as never);
    const second = new ConversationHistoryController("/workspace/b", () => client as never);

    first.activate();
    second.activate();
    await vi.waitFor(() => {
      expect(first.getSnapshot().sessions.map((entry) => entry.id)).toEqual(["workspace-a"]);
      expect(second.getSnapshot().sessions.map((entry) => entry.id)).toEqual(["workspace-b"]);
    });
    expect(listAgentSessions).toHaveBeenCalledWith(expect.objectContaining({ rootPath: "/workspace/a" }));
    expect(listAgentSessions).toHaveBeenCalledWith(expect.objectContaining({ rootPath: "/workspace/b" }));
  });

  it("coalesces same-tick refreshes into one native scan", async () => {
    const nativePage = deferred<ReturnType<typeof catalog>>();
    const listAgentSessions = vi.fn((request: { discoverNative?: boolean }) => (
      request.discoverNative ? nativePage.promise : Promise.resolve(catalog())
    ));
    const client = historyClient({ listAgentSessions, runtimes: [runtime("codex")] });
    const controller = new ConversationHistoryController("/workspace", () => client as never);

    controller.activate();
    await vi.waitFor(() => expect(listAgentSessions.mock.calls
      .filter(([request]) => request.discoverNative)).toHaveLength(1));
    const first = controller.refresh();
    const second = controller.refresh();
    expect(first).toBe(second);
    expect(listAgentSessions.mock.calls.filter(([request]) => request.discoverNative)).toHaveLength(1);

    nativePage.resolve(catalog([], {
      runtimeId: "codex",
      status: "complete",
      nextCursor: null,
      scanId: null,
      indexed: 0,
      warnings: [],
    }));
    await first;
    expect(controller.getSnapshot().refreshing).toBe(false);
  });

  it("marks an empty history loaded only after the initial native scan completes", async () => {
    const nativePage = deferred<ReturnType<typeof catalog>>();
    const listAgentSessions = vi.fn((request: { discoverNative?: boolean }) => (
      request.discoverNative ? nativePage.promise : Promise.resolve(catalog())
    ));
    const client = historyClient({ listAgentSessions, runtimes: [runtime("codex")] });
    const controller = new ConversationHistoryController("/workspace", () => client as never);

    controller.activate();
    await vi.waitFor(() => expect(listAgentSessions.mock.calls
      .filter(([request]) => request.discoverNative)).toHaveLength(1));
    expect(controller.getSnapshot()).toMatchObject({
      sessions: [],
      loading: true,
      loaded: false,
      refreshing: true,
    });

    nativePage.resolve(catalog([], {
      runtimeId: "codex",
      status: "complete",
      nextCursor: null,
      scanId: null,
      indexed: 0,
      warnings: [],
    }));
    await vi.waitFor(() => expect(controller.getSnapshot()).toMatchObject({
      sessions: [],
      loading: false,
      loaded: true,
      refreshing: false,
    }));
  });

  it("keeps a failed continuation retryable instead of dropping its scan cursor", async () => {
    let nativeCalls = 0;
    const listAgentSessions = vi.fn(async (request: { discoverNative?: boolean; cursor?: string }) => {
      if (!request.discoverNative) return catalog();
      nativeCalls += 1;
      if (!request.cursor) {
        return catalog([], {
          runtimeId: "cursor",
          status: "partial",
          nextCursor: "page-2",
          scanId: "scan-a",
          indexed: 1,
          warnings: [],
        });
      }
      if (nativeCalls === 2) throw new Error("provider page failed");
      return catalog([], {
        runtimeId: "cursor",
        status: "complete",
        nextCursor: null,
        scanId: null,
        indexed: 1,
        warnings: [],
      });
    });
    const client = historyClient({ listAgentSessions, runtimes: [runtime("cursor")] });
    const controller = new ConversationHistoryController("/workspace", () => client as never);

    controller.activate();
    await vi.waitFor(() => expect(controller.getSnapshot().nextCursors.cursor)
      .toEqual({ cursor: "page-2", scanId: "scan-a" }));
    await controller.loadMore();
    expect(controller.getSnapshot().nextCursors.cursor).toEqual({ cursor: "page-2", scanId: "scan-a" });
    expect(controller.getSnapshot().error).toMatch(/provider page failed/i);

    await controller.loadMore();
    expect(controller.getSnapshot().nextCursors).toEqual({});
    expect(listAgentSessions.mock.calls.map(([request]) => request)).toContainEqual(expect.objectContaining({
      runtimeId: "cursor",
      cursor: "page-2",
      scanId: "scan-a",
    }));
  });
  it("publishes a healthy source while another native source is still waiting", async () => {
    const slow = deferred<ReturnType<typeof catalog>>();
    const listAgentSessions = vi.fn((request: { discoverNative?: boolean; runtimeId?: string }) => {
      if (!request.discoverNative) return Promise.resolve(catalog());
      if (request.runtimeId === "cursor") return slow.promise;
      return Promise.resolve(catalog([savedSession("ready-now")], {
        runtimeId: "codex", status: "complete", indexed: 1, nextCursor: null, scanId: null, warnings: [],
      }));
    });
    const client = historyClient({ listAgentSessions, runtimes: [runtime("codex"), runtime("cursor")] });
    const controller = new ConversationHistoryController("/workspace", () => client as never);
    controller.activate();
    await vi.waitFor(() => expect(controller.getSnapshot().sessions.map((entry) => entry.id)).toEqual(["ready-now"]));
    expect(controller.getSnapshot().refreshing).toBe(true);
    expect(controller.getSnapshot().sources.codex.status).toBe("complete");
    slow.resolve(catalog([], { runtimeId: "cursor", status: "failed", indexed: 0,
      nextCursor: null, scanId: null, warnings: ["source failed"] }));
    await controller.refresh();
    expect(controller.getSnapshot().sessions.map((entry) => entry.id)).toEqual(["ready-now"]);
    expect(controller.getSnapshot().error).toContain("cursor");
    expect(client.openAgentSession).not.toHaveBeenCalled();
    controller.deactivate();
  });

  it("preserves rows and retry position for a resolved failed page, and clears expired positions", async () => {
    let call = 0;
    const listAgentSessions = vi.fn(async (request: { discoverNative?: boolean; cursor?: string }) => {
      if (!request.discoverNative) return catalog([savedSession("kept")]);
      call += 1;
      if (call === 1) return catalog([savedSession("kept")], {
        runtimeId: "codex", status: "partial", indexed: 1, nextCursor: "page-2", scanId: "scan-a", warnings: [],
      });
      return { ...catalog([], { runtimeId: "codex", status: "failed", indexed: 0,
        nextCursor: null, scanId: null, warnings: ["page failed"] }),
        discovery: { runtimeId: "codex", status: "failed", indexed: 0, nextCursor: null,
          scanId: null, warnings: ["page failed"], retryable: call === 2 } };
    });
    const client = historyClient({ listAgentSessions, runtimes: [runtime("codex")] });
    const controller = new ConversationHistoryController("/workspace", () => client as never);
    controller.activate();
    await vi.waitFor(() => expect(controller.getSnapshot().nextCursors.codex).toBeDefined());
    await controller.loadMore();
    expect(controller.getSnapshot().nextCursors.codex).toEqual({ cursor: "page-2", scanId: "scan-a" });
    expect(controller.getSnapshot().sessions.map((entry) => entry.id)).toEqual(["kept"]);
    await controller.loadMore();
    expect(controller.getSnapshot().nextCursors).toEqual({});
    expect(controller.getSnapshot().sessions.map((entry) => entry.id)).toEqual(["kept"]);
    controller.deactivate();
  });

});

function historyClient({
  listAgentSessions,
  runtimes = [],
}: {
  listAgentSessions: ReturnType<typeof vi.fn>;
  runtimes?: ReturnType<typeof runtime>[];
}) {
  return {
    discoverAgentRuntimes: vi.fn(async () => ({
      runtimes,
      selectedRuntimeId: null,
      runtime: null,
      readiness: null,
      account: null,
      providers: [],
      models: [],
      modes: [],
      commands: [],
      capabilities: null,
      warnings: [],
    })),
    listAgentSessions,
    createAgentSession: vi.fn(),
    resumeAgentSession: vi.fn(),
    openAgentSession: vi.fn(),
    onAgentEvent: vi.fn(),
    onAgentSessionExit: vi.fn(),
  };
}

function runtime(id: string) {
  return {
    descriptor: { id, displayName: id, ownership: { session: "runtime" } },
    readiness: {
      runtimeId: id,
      provider: id,
      status: "ready",
      code: "READY",
      version: "1.0.0",
      minimumVersion: null,
      message: "Ready",
      selectable: true,
    },
  };
}

function savedSession(id: string) {
  return {
    id,
    runtimeId: "codex",
    runtime: { id: "codex", displayName: "Codex" },
    providerSessionId: `native-${id}`,
    title: id,
    workspaceRoot: "/workspace",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    terminalState: "idle",
    selectedProviderId: null,
    selectedModel: null,
    selectedEffort: null,
    selectedMode: null,
    origin: "native-discovery",
    availability: "available",
    archivedAt: null,
  };
}

function catalog(sessions: ReturnType<typeof savedSession>[] = [], discovery = {
  runtimeId: null,
  status: "not-requested",
  nextCursor: null,
  scanId: null,
  indexed: 0,
  warnings: [],
}) {
  return { sessions, discovery, warnings: [] };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}
