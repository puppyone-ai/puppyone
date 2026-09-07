import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectWorkbenchStore } from "../src/features/app-shell/auxiliary-workbench/ProjectWorkbenchStore";
import { ProjectSessionManager } from "../src/features/app-shell/project-sessions/ProjectSessionManager";
import type { AuxiliaryWorkbenchContribution } from "../src/features/app-shell/auxiliary-workbench/types";
import type { ProjectSessionSnapshot } from "../shared/project-session-contract/types";

const deferred = <T = void>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
const record = (id: string, generation = id) => ({ projectId: id, rootPath: `/projects/${id}`, generation, state: "open" as const, failures: [] });
function contribution(prepare: AuxiliaryWorkbenchContribution["prepare"] = async () => {}) : AuxiliaryWorkbenchContribution {
  return { kind: "chat", label: "Chat", createLabel: "New chat", minimumSize: { width: 280, height: 260 }, maximumItems: 8,
    initialSnapshot: { title: "Chat", accessibleLabel: "Chat", detail: null, iconKey: null, status: "idle", running: false, resourceId: null },
    prepare, discardPreparedItem: vi.fn(), renderItem: () => null, close: { decide: () => ({ kind: "close" }), commit: () => true } };
}
afterEach(() => vi.useRealTimers());

describe("project-owned workbench state", () => {
  it("commits a delayed preparation to A after another project is displayed", async () => {
    const wait = deferred(); const feature = contribution(() => wait.promise);
    const a = new ProjectWorkbenchStore(record("a")), b = new ProjectWorkbenchStore(record("b"));
    a.configure([feature]); b.configure([feature]);
    const prepared = a.create("chat", null);
    const aLayout = a.getSnapshot();
    expect(aLayout.preparingKinds.has("chat")).toBe(true);
    b.createLauncher(null, "B launcher");
    wait.resolve(); const id = await prepared;
    expect(a.getSnapshot().topology.items[0]).toMatchObject({ id, rootId: "/projects/a", contextId: "a" });
    expect(b.getSnapshot().topology.items).toHaveLength(1);
    expect(b.getSnapshot().topology.items[0].kind).toBe("launcher");
    expect(feature.discardPreparedItem).not.toHaveBeenCalled();
    a.dispose(); b.dispose();
  });

  it("rolls back a late preparation after closing and never recreates its topology", async () => {
    const wait = deferred(); const feature = contribution(() => wait.promise);
    const store = new ProjectWorkbenchStore(record("a")); store.configure([feature]);
    const resource = store.getResource("chat", () => ({ dispose: vi.fn() }));
    const preparing = store.create("chat", null);
    store.setClosing(true);
    expect(store.canCreate("chat")).toBe(false);
    store.dispose(); wait.resolve();
    expect(await preparing).toBeNull();
    expect(feature.discardPreparedItem).toHaveBeenCalledOnce();
    expect(store.getSnapshot().topology.items).toEqual([]);
    expect(resource.dispose).toHaveBeenCalledOnce();
  });

  it("preserves topology and resources through connection cleanup and rejects an old snapshot", async () => {
    vi.useFakeTimers();
    const manager = new ProjectSessionManager();
    const first = deferred<ProjectSessionSnapshot>();
    let notify!: (snapshot: ProjectSessionSnapshot) => void;
    const client = { read: vi.fn(() => first.promise), subscribe: vi.fn((listener) => { notify = listener; return vi.fn(); }) };
    const disconnect = manager.connect(client);
    notify({ streamId: "main", revision: 2, projects: [record("a"), record("b")] });
    const a = manager.getProject("/projects/a")!;
    const resource = a.getResource("test", () => ({ draft: "unfinished", scrollTop: 450, dispose: vi.fn() }));
    const id = a.createLauncher(null, "New");
    first.resolve({ streamId: "main", revision: 1, projects: [record("b")] });
    await first.promise;
    expect(manager.getProject("/projects/a")).toBe(a);
    disconnect();
    expect(resource.dispose).not.toHaveBeenCalled();
    manager.connect({ ...client, read: async () => ({ streamId: "main", revision: 2, projects: [record("a"), record("b")] }) });
    disconnect(); // A late cleanup of the old subscription must not disconnect this one.
    expect(manager.getProject("/projects/a")!.getSnapshot().topology.items[0].id).toBe(id);
    expect(a.getResource("test", () => resource)).toMatchObject({ draft: "unfinished", scrollTop: 450 });
    notify({ streamId: "main", revision: 3, projects: [record("b")] });
    expect(resource.dispose).toHaveBeenCalledOnce();
    expect(manager.getProject("/projects/a")).toBeNull();
    notify({ streamId: "main", revision: 4, projects: [record("a", "new"), record("b")] });
    expect(manager.getProject("/projects/a")).not.toBe(a);
    expect(manager.getProject("/projects/a")!.getSnapshot().topology.items).toEqual([]);
    manager.dispose();
  });

  it("keeps a failed creation and its retry confined to the original project", async () => {
    const prepare = vi.fn().mockRejectedValueOnce(Object.assign(new Error("temporary"), { retryable: true })).mockResolvedValue(undefined);
    const a = new ProjectWorkbenchStore(record("a")), b = new ProjectWorkbenchStore(record("b"));
    a.configure([contribution(prepare)]); b.configure([contribution()]);
    expect(await a.create("chat", null)).toBeNull();
    expect(a.getSnapshot().creationFailure?.retryable).toBe(true);
    expect(b.getSnapshot().creationFailure).toBeNull();
    await a.retryCreation();
    expect(a.getSnapshot().topology.items).toHaveLength(1);
    expect(b.getSnapshot().topology.items).toEqual([]);
    a.dispose(); b.dispose();
  });
});
