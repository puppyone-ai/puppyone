/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { AuxiliaryWorkbenchPanel } from "../../../../src/features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchPanel";
import { ProjectWorkbenchStore } from "../../../../src/features/app-shell/auxiliary-workbench/ProjectWorkbenchStore";
import type { AuxiliaryWorkbenchContribution, AuxiliaryWorkbenchItemRenderContext } from "../../../../src/features/app-shell/auxiliary-workbench/types";
import { withTestLocalization } from "../../../support/react/localization";

let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); });

it("uses one Store for DOM focus activation, while only explicit tab actions request focus", async () => {
  const store = new ProjectWorkbenchStore({ projectId: "fixture", generation: "open-1", rootPath: "/fixture" });
  const contexts = new Map<string, AuxiliaryWorkbenchItemRenderContext>();
  const contribution: AuxiliaryWorkbenchContribution = {
    kind: "fixture", label: "Fixture", createLabel: "Fixture", minimumSize: { width: 100, height: 100 },
    initialSnapshot: { title: "Fixture", accessibleLabel: "Fixture", detail: null, iconKey: null, status: "idle", running: false, resourceId: null },
    renderItem: (context) => { contexts.set(context.item.id, context); return <input data-test-item={context.item.id} />; },
    close: { decide: () => ({ kind: "close" }), commit: () => true },
  };
  store.configure([contribution]);
  const a = (await store.create("fixture", null))!;
  const b = (await store.create("fixture", null))!;
  const first = store.getSnapshot().topology.groups[0].id;
  store.dispatch({ type: "split-item", sourceItemId: b, targetGroupId: first, edge: "right", groupId: "second", splitId: "split" });
  store.dispatch({ type: "activate", itemId: a });
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  const render = (active: boolean) => act(() => root!.render(withTestLocalization(<AuxiliaryWorkbenchPanel
    store={store} contributions={[contribution]} active={active} renderLauncher={() => null} />)));
  render(true);
  expect(contexts.get(a)!.presentation.commandTarget).toBe(true);
  act(() => container.querySelector<HTMLInputElement>(`[data-test-item="${b}"]`)!.focus());
  expect(store.getSnapshot().topology.activeGroupId).toBe("second");
  expect(contexts.get(b)!.presentation.commandTarget).toBe(true);
  expect(contexts.get(b)!.focusRequest).toBe(0);
  expect(contexts.get(a)!.presentation.commandTarget).toBe(false);
  act(() => container.querySelector<HTMLButtonElement>(`[data-terminal-tab-session-id="${a}"] [role="tab"]`)!.click());
  expect(store.getSnapshot().topology.activeGroupId).toBe(first);
  expect(contexts.get(a)!.focusRequest).toBe(1);
  act(() => container.querySelector<HTMLInputElement>(`[data-test-item="${a}"]`)!.focus());
  act(() => contexts.get(a)!.onPresentationChange({ ...contribution.initialSnapshot, title: "Updated" }));
  expect(contexts.get(a)!.focusRequest).toBe(1);
  act(() => container.querySelector<HTMLInputElement>(`[data-test-item="${a}"]`)!.blur());
  expect(store.getSnapshot().topology.activeGroupId).toBe(first);
  render(false);
  act(() => container.querySelector<HTMLInputElement>(`[data-test-item="${b}"]`)!.focus());
  expect(store.getSnapshot().topology.activeGroupId).toBe(first);
  expect(container.querySelectorAll(".desktop-terminal-pane-handle")).toHaveLength(0);
  expect(container.querySelectorAll(".desktop-terminal-tab-group > .desktop-terminal-subheader")).toHaveLength(2);
  act(() => root!.unmount()); root = null; store.dispose();
});
