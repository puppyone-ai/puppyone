/** @vitest-environment happy-dom */
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuxiliaryPanelHost } from "../../../../src/features/app-shell/auxiliary/AuxiliaryPanelHost";
import { AuxiliaryWorkbenchPanel } from "../../../../src/features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchPanel";
import { ProjectWorkbenchStore } from "../../../../src/features/app-shell/auxiliary-workbench/ProjectWorkbenchStore";
import type { AuxiliaryWorkbenchContribution, AuxiliaryWorkbenchItemRenderContext } from "../../../../src/features/app-shell/auxiliary-workbench/types";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let store: ProjectWorkbenchStore;
afterEach(() => {
  act(() => root?.unmount()); root = null;
  store?.dispose(); document.body.replaceChildren(); vi.restoreAllMocks();
});

type ContributionKind = "terminal" | "agent-chat";

async function harness(kind: ContributionKind) {
  const contexts = new Map<string, AuxiliaryWorkbenchItemRenderContext>();
  const close = vi.fn(() => true);
  const prepare = vi.fn(async () => {});
  const resource = { dispose: vi.fn() };
  store = new ProjectWorkbenchStore({ projectId: "visibility", generation: "project-1", rootPath: "/visibility-fixture" });
  store.getResource(kind, () => resource);
  const contribution: AuxiliaryWorkbenchContribution = {
    kind, label: kind, createLabel: kind, minimumSize: { width: 100, height: 100 },
    initialSnapshot: { title: kind, accessibleLabel: kind, detail: null, iconKey: null, status: "idle", running: false, resourceId: null },
    prepare,
    renderItem: context => { contexts.set(context.item.id, context); return <input data-test-item={context.item.id} defaultValue="retained draft" />; },
    close: { decide: () => ({ kind: "close" }), commit: close },
  };
  store.configure([contribution]);
  const id = (await store.create(kind, null))!;
  function settle() {
    act(() => document.querySelector(".desktop-right-sidebar")!.dispatchEvent(Object.assign(new Event("transitionend", { bubbles: true }), { propertyName: "width" })));
  }
  async function render(open: boolean) {
    if (!root) { const container = document.createElement("div"); document.body.append(container); root = createRoot(container); }
    await act(async () => root!.render(withTestLocalization(<StrictMode><AuxiliaryPanelHost open={open} width={500}>
      {presentation => <AuxiliaryWorkbenchPanel store={store} contributions={[contribution]} active={presentation.contentVisible} renderLauncher={() => null} />}
    </AuxiliaryPanelHost></StrictMode>)));
    settle();
  }
  function hidden() {
    expect(document.querySelector(".desktop-right-sidebar")?.getAttribute("data-pane-content-visible")).toBe("false");
    expect(document.querySelector(".desktop-right-sidebar-inner[inert][aria-hidden=true]")).not.toBeNull();
    const hosts = [...document.querySelectorAll(".desktop-terminal-contribution-host")];
    expect(hosts.length).toBeGreaterThan(0);
    for (const host of hosts) { expect(host.getAttribute("aria-hidden")).toBe("true"); expect(host.hasAttribute("inert")).toBe(true); }
    for (const context of contexts.values()) expect(context.presentation).toMatchObject({ presented: false, commandTarget: false });
    expect(close).not.toHaveBeenCalled(); expect(resource.dispose).not.toHaveBeenCalled();
  }
  return { id, contexts, close, prepare, render, hidden, settle, contribution, resource };
}

describe.each([
  ["Terminal", "terminal"],
  ["Agent", "agent-chat"],
] as const)("%s sidebar visibility chain", (_label, kind) => {
  it("hides retained content and ignores late status/focus updates until reopened", async () => {
    const h = await harness(kind); await h.render(true);
    const input = document.querySelector<HTMLInputElement>("[data-test-item]")!;
    input.value = "edited draft";
    const previous = store.getSnapshot().topology;
    await h.render(false); h.hidden();
    act(() => { h.contexts.get(h.id)!.onPresentationChange({ ...h.contribution.initialSnapshot, status: "error" }); input.focus(); });
    h.hidden(); expect(store.getSnapshot().topology).toBe(previous);
    act(() => h.contexts.get(h.id)!.onPresentationChange({ ...h.contribution.initialSnapshot, status: "running" }));
    h.hidden(); await h.render(true);
    expect(document.querySelector("[data-test-item]")).toBe(input);
    expect(input.value).toBe("edited draft");
    expect(h.contexts.get(h.id)!.presentation.presented).toBe(true);
    expect(h.prepare).toHaveBeenCalledTimes(1);
  });

  it("keeps delayed preparation hidden when its result arrives after collapse", async () => {
    const h = await harness(kind); await h.render(true);
    let release!: () => void;
    h.prepare.mockImplementationOnce(() => new Promise<void>(done => { release = done; }));
    let creating!: ReturnType<ProjectWorkbenchStore["create"]>;
    act(() => { creating = store.create(kind, null); });
    await h.render(false);
    await act(async () => { release(); await creating; });
    h.hidden(); expect(h.contexts.size).toBe(2);
    await h.render(true);
    expect([...h.contexts.values()].filter(context => context.presentation.presented)).toHaveLength(1);
  });

  it("survives repeated transitions and unmount/remount without closing project resources", async () => {
    const h = await harness(kind);
    for (let cycle = 0; cycle < 8; cycle++) { await h.render(true); await h.render(false); h.settle(); h.hidden(); }
    act(() => root!.unmount()); root = null;
    expect(h.resource.dispose).not.toHaveBeenCalled(); expect(h.close).not.toHaveBeenCalled();
    await h.render(false); h.hidden(); await h.render(true);
    expect(h.prepare).toHaveBeenCalledTimes(1);
    expect(h.contexts.get(h.id)!.presentation.presented).toBe(true);
  });

  it("withdraws presentation from every split pane and restores their ownership", async () => {
    const h = await harness(kind);
    const second = (await store.create(kind, null))!;
    store.dispatch({ type: "split-item", sourceItemId: second, targetGroupId: store.getSnapshot().topology.groups[0].id, edge: "right", groupId: "second", splitId: "split" });
    await h.render(true);
    expect([...h.contexts.values()].filter(context => context.presentation.presented)).toHaveLength(2);
    const topology = store.getSnapshot().topology;
    await h.render(false); h.hidden(); await h.render(true);
    expect(store.getSnapshot().topology).toBe(topology);
    expect([...h.contexts.values()].filter(context => context.presentation.presented)).toHaveLength(2);
    expect(h.prepare).toHaveBeenCalledTimes(2);
  });
});
