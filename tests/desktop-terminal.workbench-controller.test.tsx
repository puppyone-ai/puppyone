/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useAuxiliaryWorkbench } from "../src/features/app-shell/auxiliary-workbench/useAuxiliaryWorkbench";
import { ProjectWorkbenchStore } from "../src/features/app-shell/auxiliary-workbench/ProjectWorkbenchStore";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let latest: ReturnType<typeof useAuxiliaryWorkbench> | null = null;
let store: ProjectWorkbenchStore;

afterEach(() => {
  latest = null;
  store?.dispose();
  document.body.replaceChildren();
});

describe("Terminal Workbench controller", () => {
  it("creates, activates, splits and closes mixed Item kinds through one topology", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const reactRoot = createRoot(container);
    act(() => reactRoot.render(<Harness />));

    let terminalId = "";
    let chatId = "";
    await act(async () => {
      terminalId = store.createLauncher(null, "New");
      chatId = (await store.create("agent-chat", null))!;
    });

    expect(current().items.map(({ id, kind, rootId }) => ({ id, kind, rootId }))).toEqual([
      { id: terminalId, kind: "launcher", rootId: "/workspace/a" },
      { id: chatId, kind: "agent-chat", rootId: "/workspace/a" },
    ]);
    expect(current().groups).toHaveLength(1);
    expect(current().groups[0].itemIds).toEqual([terminalId, chatId]);
    expect(current().activeItemId).toBe(chatId);

    const sourceGroupId = current().groups[0].id;
    act(() => current().splitItem(chatId, sourceGroupId, "right"));
    expect(current().groups).toHaveLength(2);
    expect(current().presentedItemIds).toEqual([terminalId, chatId]);
    expect(current().activeItemId).toBe(chatId);

    act(() => current().removeItem(chatId));
    expect(current().items.map(({ id }) => id)).toEqual([terminalId]);
    expect(current().groups).toHaveLength(1);
    expect(current().activeItemId).toBe(terminalId);

    act(() => reactRoot.unmount());
  });

  it("deduplicates an unlaunched Terminal selector within one Group", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const reactRoot = createRoot(container);
    act(() => reactRoot.render(<Harness />));

    let first = "";
    let second = "";
    act(() => {
      first = store.createLauncher(null, "New");
      second = store.createLauncher(null, "New");
    });

    expect(second).toBe(first);
    expect(current().items).toHaveLength(1);
    expect(current().snapshots.get(first)?.status).toBe("selecting");
    act(() => reactRoot.unmount());
  });
});

function Harness() {
  const [owned] = React.useState(() => {
    const value = new ProjectWorkbenchStore({ projectId: "a", generation: "a", rootPath: "/workspace/a" });
    value.configure([{ kind: "agent-chat", label: "Chat", createLabel: "Chat", minimumSize: { width: 280, height: 260 },
      initialSnapshot: { title: "Chat", accessibleLabel: "Chat", detail: null, iconKey: null, status: "idle", running: false, resourceId: null },
      renderItem: () => null, close: { decide: () => ({ kind: "close" }), commit: () => true } }]);
    return value;
  });
  store = owned;
  latest = useAuxiliaryWorkbench(store);
  return null;
}

function current() {
  if (!latest) throw new Error("Workbench controller is not mounted.");
  return latest;
}
