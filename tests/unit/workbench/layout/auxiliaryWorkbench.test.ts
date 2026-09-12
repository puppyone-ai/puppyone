import { describe, expect, it } from "vitest";
import {
  assertAuxiliaryWorkbenchState,
  auxiliaryWorkbenchReducer,
  canInsertAuxiliaryWorkbenchItem,
  canSplitAuxiliaryWorkbenchItem,
  createAuxiliaryWorkbenchState,
  findAuxiliaryWorkbenchItemGroup,
  getActiveAuxiliaryWorkbenchItemId,
  getOrderedAuxiliaryWorkbenchItems,
  getPresentedAuxiliaryWorkbenchItemIds,
  type AuxiliaryWorkbenchItem,
  type AuxiliaryWorkbenchState,
} from "@puppyone/shared-ui";

const terminal = item("terminal-1", "terminal", "/workspace-a", "workspace-a");
const chat = item("chat-1", "agent-chat", "/workspace-a", "workspace-a");
const secondRootChat = item("chat-2", "agent-chat", "/workspace-b", "workspace-b");

describe("Auxiliary Workbench topology", () => {
  it("replaces one identity in place without changing selection, topology, or other Groups", () => {
    const state = splitState();
    const replacement = item("replacement", "terminal", chat.rootId, chat.contextId);
    const next = auxiliaryWorkbenchReducer(state, { type: "replace-item", itemId: chat.id, item: replacement });
    expect(next.root).toBe(state.root);
    expect(next.activeGroupId).toBe(state.activeGroupId);
    expect(next.groups.find((group) => group.id === "group-a")?.itemIds).toEqual([replacement.id]);
    expect(next.groups.find((group) => group.id === "group-b")).toBe(state.groups.find((group) => group.id === "group-b"));
    expect(next.items).toHaveLength(state.items.length);
    expect(() => assertAuxiliaryWorkbenchState(next)).not.toThrow();
    for (const invalid of [chat, secondRootChat, { ...replacement, rootId: "/other" }, { ...replacement, contextId: "other" }]) {
      expect(auxiliaryWorkbenchReducer(state, { type: "replace-item", itemId: chat.id, item: invalid })).toBe(state);
    }
    expect(auxiliaryWorkbenchReducer(state, { type: "replace-item", itemId: "closed", item: replacement })).toBe(state);
  });
  it("keeps mixed Terminal and Chat Items in one local Tab stack", () => {
    let state = createAuxiliaryWorkbenchState();
    state = create(state, terminal, "group-a");
    state = create(state, chat, "unused-group", "group-a");

    expect(state.groups).toEqual([{
      id: "group-a",
      itemIds: ["terminal-1", "chat-1"],
      activeItemId: "chat-1",
    }]);
    expect(getActiveAuxiliaryWorkbenchItemId(state)).toBe("chat-1");
    expect(getPresentedAuxiliaryWorkbenchItemIds(state)).toEqual(["chat-1"]);
    expect(getOrderedAuxiliaryWorkbenchItems(state).map(({ kind }) => kind)).toEqual([
      "terminal",
      "agent-chat",
    ]);
    expect(() => assertAuxiliaryWorkbenchState(state)).not.toThrow();
  });

  it("splits either Item kind without changing its root binding", () => {
    let state = createAuxiliaryWorkbenchState();
    state = create(state, terminal, "group-a");
    state = create(state, secondRootChat, "unused-group", "group-a");
    state = auxiliaryWorkbenchReducer(state, {
      type: "split-item",
      sourceItemId: secondRootChat.id,
      targetGroupId: "group-a",
      edge: "right",
      groupId: "group-b",
      splitId: "split-a",
    });

    expect(getPresentedAuxiliaryWorkbenchItemIds(state)).toEqual(["terminal-1", "chat-2"]);
    expect(findAuxiliaryWorkbenchItemGroup(state, "chat-2")?.id).toBe("group-b");
    expect(state.items.find(({ id }) => id === "chat-2")).toMatchObject({
      rootId: "/workspace-b",
      contextId: "workspace-b",
    });
    expect(() => assertAuxiliaryWorkbenchState(state)).not.toThrow();
  });

  it("moves a mixed Item across Groups atomically", () => {
    let state = splitState();
    expect(canInsertAuxiliaryWorkbenchItem(state, "chat-1", "group-b", 1)).toBe(true);
    state = auxiliaryWorkbenchReducer(state, {
      type: "merge-item",
      sourceItemId: "chat-1",
      targetGroupId: "group-b",
      targetIndex: 1,
    });

    expect(state.groups).toHaveLength(1);
    expect(state.groups[0]).toMatchObject({
      id: "group-b",
      itemIds: ["chat-2", "chat-1"],
      activeItemId: "chat-1",
    });
    expect(getOrderedAuxiliaryWorkbenchItems(state).map(({ id }) => id)).toEqual([
      "chat-2",
      "chat-1",
    ]);
    expect(() => assertAuxiliaryWorkbenchState(state)).not.toThrow();
  });

  it("closes the final Item into a valid empty Workbench", () => {
    let state = createAuxiliaryWorkbenchState();
    state = create(state, terminal, "group-a");
    state = auxiliaryWorkbenchReducer(state, { type: "close", itemId: terminal.id });

    expect(state).toEqual({ items: [], groups: [], root: null, activeGroupId: null });
    expect(() => assertAuxiliaryWorkbenchState(state)).not.toThrow();
  });

  it("rejects impossible split and insertion commands without mutation", () => {
    let state = createAuxiliaryWorkbenchState();
    state = create(state, terminal, "group-a");
    expect(canSplitAuxiliaryWorkbenchItem(state, terminal.id, "group-a")).toBe(false);
    expect(canInsertAuxiliaryWorkbenchItem(state, terminal.id, "group-a", 2)).toBe(false);

    const split = auxiliaryWorkbenchReducer(state, {
      type: "split-item",
      sourceItemId: terminal.id,
      targetGroupId: "group-a",
      edge: "right",
      groupId: "group-b",
      splitId: "split-a",
    });
    const merge = auxiliaryWorkbenchReducer(state, {
      type: "merge-item",
      sourceItemId: terminal.id,
      targetGroupId: "group-a",
      targetIndex: 2,
    });
    expect(split).toBe(state);
    expect(merge).toBe(state);
  });
});

function splitState() {
  let state = createAuxiliaryWorkbenchState(secondRootChat, "group-b");
  state = create(state, chat, "unused-group", "group-b");
  state = auxiliaryWorkbenchReducer(state, {
    type: "split-item",
    sourceItemId: chat.id,
    targetGroupId: "group-b",
    edge: "left",
    groupId: "group-a",
    splitId: "split-a",
  });
  return state;
}

function create(
  state: AuxiliaryWorkbenchState,
  nextItem: AuxiliaryWorkbenchItem,
  groupId: string,
  targetGroupId?: string | null,
) {
  return auxiliaryWorkbenchReducer(state, {
    type: "create",
    item: nextItem,
    groupId,
    targetGroupId,
  });
}

function item(
  id: string,
  kind: string,
  rootId: string,
  contextId: string,
): AuxiliaryWorkbenchItem {
  return Object.freeze({ id, kind, rootId, contextId });
}
