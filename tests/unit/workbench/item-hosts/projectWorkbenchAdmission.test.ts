import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectWorkbenchStore } from "../../../../src/features/app-shell/auxiliary-workbench/ProjectWorkbenchStore";
import type {
  AuxiliaryWorkbenchContribution, AuxiliaryWorkbenchCreationRecipe,
  AuxiliaryWorkbenchHistoryTarget, AuxiliaryWorkbenchPreparationContext,
} from "../../../../src/features/app-shell/auxiliary-workbench/types";

const owners: ProjectWorkbenchStore[] = [];
afterEach(() => { owners.splice(0).forEach((owner) => owner.dispose()); });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
const recipe = (id: string): AuxiliaryWorkbenchCreationRecipe => ({ id, label: id, iconKey: id, status: "available" });
const target: AuxiliaryWorkbenchHistoryTarget = { id: "saved", title: "Fix auth", iconKey: "codex", payload: { native: "opaque" } };
function contribution(prepare: AuxiliaryWorkbenchContribution["prepare"]): AuxiliaryWorkbenchContribution {
  return {
    kind: "agent-chat", label: "Chat", createLabel: "New chat", maximumItems: 8,
    minimumSize: { width: 280, height: 260 }, creationRecipes: [recipe("codex")],
    initialSnapshot: { title: "Chat", accessibleLabel: "Chat", detail: null, iconKey: null, status: "starting", running: false, resourceId: null },
    history: { label: "History", iconKey: null, renderBrowser: () => null },
    prepare, discardPreparedItem: vi.fn(), renderItem: () => null,
    close: { decide: () => ({ kind: "close" }), commit: () => true },
  };
}
function owner(feature: AuxiliaryWorkbenchContribution) {
  const store = new ProjectWorkbenchStore({ projectId: "a", generation: "open-a", rootPath: "/workspace/a" });
  owners.push(store);
  store.configure([feature]);
  return store;
}

describe("Project Workbench contribution admission", () => {
  it("does not reserve runtime resources or consume feature quotas for blank tabs", async () => {
    const prepare = vi.fn(async () => {});
    const feature = { ...contribution(prepare), maximumItems: 1 };
    const store = owner(feature);
    const blanks = Array.from({ length: 64 }, () => store.createLauncher(null, "New tab")!);
    expect(new Set(blanks).size).toBe(64);
    expect(store.getSnapshot().topology.groups).toHaveLength(1);
    expect(store.getSnapshot().topology.groups[0].itemIds).toEqual(blanks);
    expect(store.getSnapshot().preparingKinds.size).toBe(0);
    expect(prepare).not.toHaveBeenCalled();
    expect([...store.getSnapshot().snapshots.values()].every((snapshot) => snapshot.status === "selecting" && snapshot.resourceId === null && !snapshot.running)).toBe(true);
    const runtime = await store.create("agent-chat", null, recipe("codex"), null, blanks[0]);
    expect(runtime).not.toBeNull();
    expect(store.getSnapshot().topology.groups[0].itemIds).toEqual([runtime, ...blanks.slice(1)]);
    expect(store.canCreate("agent-chat")).toBe(false);
    const extra = store.createLauncher(null, "New tab");
    expect(extra).not.toBeNull();
    expect(await store.create("agent-chat", null, recipe("codex"), null, extra)).toBeNull();
    expect(prepare).toHaveBeenCalledOnce();
    store.removeItem(blanks[1]);
    expect(store.getSnapshot().topology.items).toHaveLength(64);
    expect(store.getSnapshot().topology.items.some((item) => item.id === runtime)).toBe(true);
    const topology = store.getSnapshot().topology;
    store.setClosing(true);
    expect(store.createLauncher(null, "New tab")).toBeNull();
    store.dispose();
    expect(store.createLauncher(null, "New tab")).toBeNull();
    expect(store.getSnapshot().topology).toBe(topology);
  });

  it("allows another blank during preparation without redirecting the result or selection", async () => {
    const wait = deferred();
    const store = owner(contribution(() => wait.promise));
    const source = store.createLauncher(null, "New tab")!;
    const pending = store.create("agent-chat", null, recipe("codex"), null, source);
    const next = store.createLauncher(null, "New tab")!;
    expect(next).not.toBe(source);
    wait.resolve();
    const runtime = await pending;
    expect(store.getSnapshot().topology.groups[0].itemIds).toEqual([runtime, next]);
    expect(store.getSnapshot().topology.groups[0].activeItemId).toBe(next);
    expect(store.getHeaderKey(runtime!)).toBe(source);
    expect(store.getSnapshot().snapshots.get(next)?.status).toBe("selecting");
  });

  it("publishes an in-place launcher replacement once and retains its visual key", async () => {
    const store = owner(contribution(async () => {}));
    const first = (await store.create("agent-chat", null, recipe("codex")))!;
    const launcher = store.createLauncher(null, "New")!;
    const last = (await store.create("agent-chat", null, recipe("codex")))!;
    const before = store.getSnapshot().topology;
    const group = before.groups[0].id;
    const resource = store.getResource(`launcher:${launcher}`, () => ({ dispose: vi.fn() }));
    const changes: typeof before[] = [];
    store.subscribe(() => { const value = store.getSnapshot().topology; if (changes.at(-1) !== value) changes.push(value); });
    const result = (await store.create("agent-chat", group, recipe("codex"), null, launcher))!;
    expect(result).not.toBe(launcher);
    expect(changes).toHaveLength(2);
    expect(changes[0]).toBe(before);
    expect(changes[1].groups[0].itemIds).toEqual([first, result, last]);
    expect(changes[1].groups[0].activeItemId).toBe(last);
    expect(changes[1].root).toBe(before.root);
    expect(store.getHeaderKey(result)).toBe(launcher);
    expect(store.getSnapshot().snapshots.has(launcher)).toBe(false);
    expect(resource.dispose).toHaveBeenCalledOnce();
    store.removeItem(result);
    expect(store.getHeaderKey(result)).toBe(result);
  });

  it("follows a pending launcher's current Group without stealing another Group's selection", async () => {
    const wait = deferred();
    const feature = contribution(vi.fn().mockResolvedValueOnce(undefined).mockImplementationOnce(() => wait.promise));
    const store = owner(feature);
    const first = (await store.create("agent-chat", null, recipe("codex")))!;
    const launcher = store.createLauncher(null, "New")!;
    const group = store.getSnapshot().topology.groups[0].id;
    const pending = store.create("agent-chat", group, recipe("codex"), null, launcher);
    store.dispatch({ type: "split-item", sourceItemId: launcher, targetGroupId: group, edge: "right", groupId: "new-group", splitId: "split" });
    store.dispatch({ type: "activate", itemId: first });
    wait.resolve();
    const result = await pending;
    expect(store.getSnapshot().topology.groups.find((entry) => entry.id === "new-group")?.itemIds).toEqual([result]);
    expect(store.getSnapshot().topology.activeGroupId).toBe(group);
  });

  it("discards late readiness after the launcher closes, without recreating tabs", async () => {
    const wait = deferred();
    const feature = contribution(() => wait.promise);
    const store = owner(feature);
    const launcher = store.createLauncher(null, "New")!;
    const pending = store.create("agent-chat", null, recipe("codex"), null, launcher);
    store.removeItem(launcher);
    wait.resolve();
    expect(await pending).toBeNull();
    expect(store.getSnapshot().topology.items).toEqual([]);
    expect(store.getSnapshot().snapshots.size).toBe(0);
    expect(feature.discardPreparedItem).toHaveBeenCalledOnce();
  });

  it("does not prepare two different runtimes for the same launcher", async () => {
    const wait = deferred();
    const feature = contribution(() => wait.promise);
    const terminal = { ...contribution(vi.fn()), kind: "terminal" };
    const store = owner(feature);
    store.configure([feature, terminal]);
    const launcher = store.createLauncher(null, "New")!;
    const pending = store.create("agent-chat", null, recipe("codex"), null, launcher);
    expect(await store.create("terminal", null, recipe("codex"), null, launcher)).toBeNull();
    expect(terminal.prepare).not.toHaveBeenCalled();
    wait.resolve(); await pending;
    expect(store.getSnapshot().topology.items).toHaveLength(1);
  });

  it("retries a failed launcher in place, and rejects stale or non-launcher replacements", async () => {
    const prepare = vi.fn().mockRejectedValueOnce(Object.assign(new Error("Temporary"), { retryable: true })).mockResolvedValue(undefined);
    const store = owner(contribution(prepare));
    const launcher = store.createLauncher(null, "New")!;
    expect(await store.create("agent-chat", null, recipe("codex"), null, launcher)).toBeNull();
    expect(store.getSnapshot().topology.items[0].id).toBe(launcher);
    const result = (await store.retryCreation())!;
    expect(store.getSnapshot().topology.items).toHaveLength(1);
    expect(store.getHeaderKey(result)).toBe(launcher);
    expect(await store.create("agent-chat", null, recipe("codex"), null, result)).toBeNull();
    expect(await store.create("agent-chat", null, recipe("codex"), null, launcher)).toBeNull();
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it("reserves project identity, prepares the recipe, then commits the same Item", async () => {
    const wait = deferred();
    const prepare = vi.fn<(context: AuxiliaryWorkbenchPreparationContext) => Promise<void>>(() => wait.promise);
    const store = owner(contribution(prepare));
    const pending = store.create("agent-chat", null, recipe("codex"));
    const prepared = prepare.mock.calls[0][0];
    expect(prepared).toMatchObject({ project: store, recipe: recipe("codex"), historyTarget: null });
    expect(store.getSnapshot().topology.items).toEqual([]);
    wait.resolve();
    expect(await pending).toBe(prepared.item.id);
    expect(store.getSnapshot().topology.items).toEqual([prepared.item]);
  });

  it("reports preparation failure, rolls back the reservation and keeps topology empty", async () => {
    const feature = contribution(vi.fn(async () => { throw Object.assign(new Error("Try again"), { code: "TEMPORARY", retryable: true }); }));
    const store = owner(feature);
    expect(await store.create("agent-chat", null, recipe("codex"))).toBeNull();
    expect(feature.discardPreparedItem).toHaveBeenCalledOnce();
    expect(store.getSnapshot().topology.items).toEqual([]);
    expect(store.getSnapshot().creationFailure).toMatchObject({ code: "TEMPORARY", retryable: true, detail: "Try again" });
  });

  it("discards a reservation when its contribution is disabled while preparing", async () => {
    const wait = deferred();
    const feature = contribution(() => wait.promise);
    const store = owner(feature);
    const pending = store.create("agent-chat", null, recipe("codex"));
    store.configure([]);
    wait.resolve();
    expect(await pending).toBeNull();
    expect(feature.discardPreparedItem).toHaveBeenCalledOnce();
    expect(store.getSnapshot().topology.items).toEqual([]);
  });

  it("rejects unknown or unavailable recipes before preparation", async () => {
    const prepare = vi.fn();
    const store = owner(contribution(prepare));
    expect(await store.create("agent-chat", null, recipe("missing"))).toBeNull();
    store.configure([{ ...contribution(prepare), creationRecipes: [{ ...recipe("codex"), status: "coming-soon" }] }]);
    expect(await store.create("agent-chat", null, recipe("codex"))).toBeNull();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("admits opaque History through the same project preparation boundary", async () => {
    const prepare = vi.fn(async () => {});
    const store = owner(contribution(prepare));
    const id = await store.create("agent-chat", null, null, target);
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ project: store, historyTarget: target, recipe: null }));
    expect(store.getSnapshot().snapshots.get(id!)).toMatchObject({ title: target.title, resourceId: target.id });
    expect(store.getSnapshot().topology.items[0].id).not.toBe(target.id);
  });

  it("preserves structured History failure and retries the exact target with a fresh reservation", async () => {
    const failure = Object.assign(new Error("Temporarily unavailable"), { code: "HISTORY_UNAVAILABLE", retryable: true });
    const prepare = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined);
    const feature = contribution(prepare);
    const store = owner(feature);
    expect(await store.create("agent-chat", null, null, target)).toBeNull();
    expect(store.getSnapshot().creationFailure).toMatchObject({ code: failure.code, retryable: true });
    expect(feature.discardPreparedItem).toHaveBeenCalledOnce();
    const id = await store.retryCreation();
    expect(id).not.toBeNull();
    const first = prepare.mock.calls[0][0], second = prepare.mock.calls[1][0];
    expect(second.historyTarget).toBe(target);
    expect(second.project).toBe(store);
    expect(second.item.id).not.toBe(first.item.id);
  });

  it("does not retry an unregistered contribution or a dismissed failure", async () => {
    const prepare = vi.fn(async () => { throw Object.assign(new Error("Temporary"), { retryable: true }); });
    const feature = contribution(prepare);
    const store = owner(feature);
    await store.create("agent-chat", null, null, target);
    store.configure([]);
    expect(await store.retryCreation()).toBeNull();
    store.configure([feature]);
    store.dismissCreationFailure();
    expect(await store.retryCreation()).toBeNull();
    expect(prepare).toHaveBeenCalledOnce();
  });

  it("enforces the Chat limit without evicting an existing Item", async () => {
    const feature = contribution(async () => {});
    const store = owner(feature);
    for (let index = 0; index < 8; index++) await store.create("agent-chat", null, recipe("codex"));
    const existing = store.getSnapshot().topology.items;
    expect(await store.create("agent-chat", null, recipe("codex"))).toBeNull();
    expect(store.getSnapshot().topology.items).toBe(existing);
  });
});
