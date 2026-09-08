import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectWorkbenchStore } from "../src/features/app-shell/auxiliary-workbench/ProjectWorkbenchStore";
import type {
  AuxiliaryWorkbenchContribution, AuxiliaryWorkbenchCreationRecipe,
  AuxiliaryWorkbenchHistoryTarget, AuxiliaryWorkbenchPreparationContext,
} from "../src/features/app-shell/auxiliary-workbench/types";

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
  it("reserves project identity, prepares the recipe, then commits the same Item", async () => {
    const wait = deferred();
    const prepare = vi.fn(() => wait.promise);
    const store = owner(contribution(prepare));
    const pending = store.create("agent-chat", null, recipe("codex"));
    const prepared = prepare.mock.calls[0][0] as AuxiliaryWorkbenchPreparationContext;
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
