/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AuxiliaryWorkbenchItem } from "@puppyone/shared-ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AuxiliaryWorkbenchContribution,
  AuxiliaryWorkbenchCreationRecipe,
  AuxiliaryWorkbenchHistoryTarget,
  AuxiliaryWorkbenchPreparationContext,
} from "../src/features/app-shell/auxiliary-workbench/types";
import { useAuxiliaryWorkbenchContributions } from "../src/features/app-shell/auxiliary-workbench/useAuxiliaryWorkbenchContributions";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

type Registry = ReturnType<typeof useAuxiliaryWorkbenchContributions>;
let latest: Registry | null = null;
let reactRoot: Root | null = null;

const reservedItem = Object.freeze({
  id: "chat-1",
  kind: "agent-chat",
  rootId: "/workspace",
  contextId: "workspace-1",
});

afterEach(() => {
  if (reactRoot) act(() => reactRoot?.unmount());
  reactRoot = null;
  latest = null;
  document.body.replaceChildren();
});

describe("Auxiliary Workbench contribution admission", () => {
  it("reserves identity, prepares the selected recipe, then commits the same Item", async () => {
    const ready = deferred<void>();
    const prepare = vi.fn(() => ready.promise);
    const recipe = availableRecipe("codex");
    const contribution = createContribution(prepare, [recipe]);
    const onReserve = vi.fn(() => reservedItem);
    const onCommit = vi.fn(() => reservedItem.id);
    renderRegistry([contribution], onReserve, onCommit);

    let first: Promise<string | null>;
    let duplicate: Promise<string | null>;
    act(() => {
      first = current().create(contribution, "group-1", recipe);
      duplicate = current().create(contribution, "group-1", recipe);
    });
    expect(onReserve).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
    expect(current().canCreate(contribution, recipe)).toBe(false);
    await expect(duplicate!).resolves.toBeNull();

    await act(async () => {
      ready.resolve();
      await expect(first!).resolves.toBe("chat-1");
    });
    expect(prepare).toHaveBeenCalledWith({ item: reservedItem, recipe, historyTarget: null });
    expect(onCommit).toHaveBeenCalledWith(
      contribution,
      reservedItem,
      "group-1",
      recipe,
      null,
    );
  });

  it("reports preparation failure, disposes prepared state, and leaves topology empty", async () => {
    const prepare = vi.fn()
      .mockRejectedValueOnce(new Error("chunk unavailable"))
      .mockResolvedValueOnce(undefined);
    const discardPreparedItem = vi.fn();
    const contribution = createContribution(prepare, undefined, discardPreparedItem);
    const onCommit = vi.fn(() => "chat-1");
    renderRegistry([contribution], () => reservedItem, onCommit);

    await act(async () => {
      await expect(current().create(contribution, null)).resolves.toBeNull();
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(discardPreparedItem).toHaveBeenCalledWith({
      item: reservedItem,
      recipe: null,
      historyTarget: null,
    });
    expect(current().creationFailure).toEqual({
      kind: "agent-chat",
      label: "Agent Chat",
      code: null,
      detail: "chunk unavailable",
      retryable: false,
    });
    expect(current().canCreate(contribution)).toBe(true);

    await act(async () => {
      await expect(current().create(contribution, null)).resolves.toBe("chat-1");
    });
    expect(onCommit).toHaveBeenCalledOnce();
    expect(discardPreparedItem).toHaveBeenCalledOnce();
    expect(current().creationFailure).toBeNull();
  });

  it("disposes a reservation when the contribution is disabled during preparation", async () => {
    const ready = deferred<void>();
    const discardPreparedItem = vi.fn();
    const contribution = createContribution(() => ready.promise, undefined, discardPreparedItem);
    const onCommit = vi.fn(() => "chat-1");
    const rerender = renderRegistry([contribution], () => reservedItem, onCommit);

    let creation: Promise<string | null>;
    act(() => {
      creation = current().create(contribution, null);
    });
    rerender([]);
    await act(async () => {
      ready.resolve();
      await expect(creation!).resolves.toBeNull();
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(discardPreparedItem).toHaveBeenCalledOnce();
  });

  it("rejects unknown and Coming soon recipes before reserving an Item", async () => {
    const codex = availableRecipe("codex");
    const puppyone = Object.freeze({
      id: "puppyone-agent",
      label: "PuppyOne",
      iconKey: "puppyone-agent",
      status: "coming-soon" as const,
    });
    const contribution = createContribution(async () => undefined, [codex, puppyone]);
    const onReserve = vi.fn(() => reservedItem);
    renderRegistry([contribution], onReserve, vi.fn(() => "chat-1"));

    expect(current().canCreate(contribution, codex)).toBe(true);
    expect(current().canCreate(contribution, puppyone)).toBe(false);
    expect(current().canCreate(contribution, availableRecipe("cursor"))).toBe(false);
    await expect(current().create(contribution, null, puppyone)).resolves.toBeNull();
    expect(onReserve).not.toHaveBeenCalled();
  });

  it("admits an opaque history target through the same transactional preparation boundary", async () => {
    const prepare = vi.fn(async () => undefined);
    const base = createContribution(prepare, [availableRecipe("codex")]);
    const contribution: AuxiliaryWorkbenchContribution = Object.freeze({
      ...base,
      history: Object.freeze({
        label: "Chat history",
        iconKey: null,
        renderBrowser: () => null,
      }),
    });
    const target: AuxiliaryWorkbenchHistoryTarget = Object.freeze({
      id: "saved-chat",
      title: "Saved chat",
      iconKey: "codex",
      payload: Object.freeze({ runtimeId: "codex" }),
    });
    const onCommit = vi.fn(() => "chat-1");
    renderRegistry([contribution], () => reservedItem, onCommit);

    expect(current().canCreate(contribution, null, target)).toBe(true);
    await act(async () => {
      await expect(current().create(contribution, null, null, target)).resolves.toBe("chat-1");
    });
    expect(prepare).toHaveBeenCalledWith({
      item: reservedItem,
      recipe: null,
      historyTarget: target,
    });
    expect(onCommit).toHaveBeenCalledWith(contribution, reservedItem, null, null, target);
  });

  it("preserves structured History open failures through Workbench admission", async () => {
    const failure = Object.assign(new Error("This saved chat is no longer available."), {
      code: "SESSION_NOT_FOUND",
      retryable: false,
    });
    const prepare = vi.fn(async () => { throw failure; });
    const contribution = createContribution(prepare);
    renderRegistry([contribution], () => reservedItem, vi.fn(() => "chat-1"));

    await act(async () => {
      await expect(current().create(contribution, null)).resolves.toBeNull();
    });
    expect(current().creationFailure).toEqual({
      kind: "agent-chat",
      label: "Agent Chat",
      code: "SESSION_NOT_FOUND",
      detail: "This saved chat is no longer available.",
      retryable: false,
    });
    await expect(current().retryCreation()).resolves.toBeNull();
    expect(prepare).toHaveBeenCalledOnce();
  });

  it("retries the exact saved target through fresh admission after cleanup", async () => {
    const prepare = vi.fn().mockRejectedValueOnce(Object.assign(new Error("History messages could not be loaded"), {
      code: "HISTORY_READ_FAILED", retryable: true,
    })).mockResolvedValueOnce(undefined);
    const discard = vi.fn();
    const contribution = Object.freeze({
      ...createContribution(prepare, undefined, discard),
      history: { label: "History", iconKey: null, renderBrowser: () => null },
    });
    const target = Object.freeze({ id: "saved-chat", title: "Saved", iconKey: "codex", payload: { runtimeId: "codex" } });
    const reserve = vi.fn(() => ({ ...reservedItem, id: `reserved-${reserve.mock.calls.length}` }));
    const commit = vi.fn((_contribution, item) => item.id);
    renderRegistry([contribution], reserve, commit);
    await act(async () => { await current().create(contribution, "group-1", null, target); });
    expect(discard).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
    await act(async () => { await current().retryCreation(); });
    expect(reserve).toHaveBeenCalledTimes(2);
    expect(prepare.mock.calls[1][0]).toMatchObject({ item: { id: "reserved-2" }, recipe: null, historyTarget: target });
    expect(commit).toHaveBeenCalledWith(contribution, expect.objectContaining({ id: "reserved-2" }), "group-1", null, target);
    expect(current().creationFailure).toBeNull();
  });

  it("does not retry a stale registration or a dismissed failure", async () => {
    const prepare = vi.fn().mockRejectedValue(Object.assign(new Error("History read failed"), { code: "HISTORY_READ_FAILED", retryable: true }));
    const contribution = createContribution(prepare);
    const rerender = renderRegistry([contribution], () => reservedItem, vi.fn());
    await act(async () => { await current().create(contribution, null); });
    const retry = current().retryCreation;
    rerender([]);
    await act(async () => { expect(await retry()).toBeNull(); });
    expect(prepare).toHaveBeenCalledOnce();
    rerender([contribution]);
    act(() => current().dismissCreationFailure());
    await act(async () => { expect(await retry()).toBeNull(); });
    expect(prepare).toHaveBeenCalledOnce();
  });
});

function renderRegistry(
  contributions: readonly AuxiliaryWorkbenchContribution[],
  onReserve: (contribution: AuxiliaryWorkbenchContribution) => AuxiliaryWorkbenchItem,
  onCommit: (
    contribution: AuxiliaryWorkbenchContribution,
    item: AuxiliaryWorkbenchItem,
    groupId: string | null,
    recipe: AuxiliaryWorkbenchCreationRecipe | null,
    historyTarget: AuxiliaryWorkbenchHistoryTarget | null,
  ) => string,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  reactRoot = createRoot(container);
  const render = (next: readonly AuxiliaryWorkbenchContribution[]) => {
    act(() => reactRoot?.render(
      <Harness
        contributions={next}
        onReserve={onReserve}
        onCommit={onCommit}
      />,
    ));
  };
  render(contributions);
  return render;
}

function Harness({
  contributions,
  onCommit,
  onReserve,
}: Readonly<{
  contributions: readonly AuxiliaryWorkbenchContribution[];
  onReserve: (contribution: AuxiliaryWorkbenchContribution) => AuxiliaryWorkbenchItem;
  onCommit: (
    contribution: AuxiliaryWorkbenchContribution,
    item: AuxiliaryWorkbenchItem,
    groupId: string | null,
    recipe: AuxiliaryWorkbenchCreationRecipe | null,
    historyTarget: AuxiliaryWorkbenchHistoryTarget | null,
  ) => string;
}>) {
  latest = useAuxiliaryWorkbenchContributions({
    contributions,
    items: [],
    onCommit,
    onReserve,
  });
  return null;
}

function current() {
  if (!latest) throw new Error("Contribution registry is not mounted.");
  return latest;
}

function createContribution(
  prepare: (context: AuxiliaryWorkbenchPreparationContext) => Promise<void>,
  creationRecipes?: readonly AuxiliaryWorkbenchCreationRecipe[],
  discardPreparedItem?: (context: AuxiliaryWorkbenchPreparationContext) => void | Promise<void>,
): AuxiliaryWorkbenchContribution {
  return Object.freeze({
    kind: "agent-chat",
    label: "Agent Chat",
    createLabel: "New chat",
    creationRecipes,
    initialSnapshot: Object.freeze({
      title: "New chat",
      accessibleLabel: "New chat — Agent Chat",
      detail: "Agent Chat",
      iconKey: null,
      status: "starting" as const,
      running: false,
      resourceId: null,
    }),
    maximumItems: 8,
    minimumSize: Object.freeze({ width: 320, height: 260 }),
    prepare,
    discardPreparedItem,
    renderItem: () => null,
    close: Object.freeze({
      decide: () => Object.freeze({ kind: "close" as const }),
      commit: async () => true,
    }),
  });
}

function availableRecipe(id: string): AuxiliaryWorkbenchCreationRecipe {
  return Object.freeze({ id, label: id, iconKey: id, status: "available" });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}
