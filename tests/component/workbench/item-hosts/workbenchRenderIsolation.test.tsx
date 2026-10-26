/** @vitest-environment happy-dom */
import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApplicationRenderBoundary } from "../../../../src/components/ApplicationRenderBoundary";
import { AuxiliaryWorkbenchPanel } from "../../../../src/features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchPanel";
import { ProjectWorkbenchStore } from "../../../../src/lib/workbench/ProjectWorkbenchStore";
import type { AuxiliaryWorkbenchContribution } from "../../../../src/lib/workbench/types";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let store: ProjectWorkbenchStore;
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  store = new ProjectWorkbenchStore({ projectId: "fixture", generation: "open-1", rootPath: "/fixture" });
});
afterEach(() => {
  act(() => root?.unmount()); root = null;
  store.dispose(); vi.restoreAllMocks(); document.body.replaceChildren();
});

function BrokenView(): React.ReactElement { throw new Error("fixture render failure"); }

async function mixedWorkbench() {
  const mounts = new Map<string, number>();
  const unmounts = new Map<string, number>();
  const resources = new Map<string, { dispose: ReturnType<typeof vi.fn> }>();
  const prepare = vi.fn();
  const close = vi.fn(() => true);
  let failingKind = "";
  let failureSurface = "";
  let failureMode = "";
  function ItemView({ kind }: { kind: string }) {
    useEffect(() => {
      mounts.set(kind, (mounts.get(kind) ?? 0) + 1);
      return () => { unmounts.set(kind, (unmounts.get(kind) ?? 0) + 1); };
    }, [kind]);
    if (kind === failingKind && failureSurface === "content" && failureMode === "child") return <BrokenView />;
    return <input data-fixture-kind={kind} defaultValue="draft" />;
  }
  const contributions: AuxiliaryWorkbenchContribution[] = ["terminal", "chat"].map((kind) => ({
    kind, label: kind, createLabel: kind, minimumSize: { width: 100, height: 100 },
    initialSnapshot: { title: kind, accessibleLabel: kind, detail: null, iconKey: null, status: "idle", running: false, resourceId: null },
    prepare: async (context) => {
      prepare(kind, context.item.id);
      resources.set(kind, context.project.getResource(`fixture-${kind}`, () => ({ dispose: vi.fn() })));
    },
    renderItem: () => {
      if (kind === failingKind && failureSurface === "content" && failureMode === "callback") throw new Error("fixture contribution failure");
      return <ItemView kind={kind} />;
    },
    renderStatus: () => {
      if (kind === failingKind && failureSurface === "status") {
        if (failureMode === "callback") throw new Error("fixture status failure");
        return <BrokenView />;
      }
      return <span data-fixture-status={kind} />;
    },
    getMinimumSize: () => {
      if (kind === failingKind && failureSurface === "minimum") throw new Error("fixture minimum failure");
      return null;
    },
    close: { decide: () => ({ kind: "close" }), commit: close },
  }));
  store.configure(contributions);
  const terminal = (await store.create("terminal", null))!;
  const chat = (await store.create("chat", null))!;
  store.dispatch({ type: "split-item", sourceItemId: chat, targetGroupId: store.getSnapshot().topology.groups[0].id, edge: "right", groupId: "chat-group", splitId: "split" });
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  const render = (renderLauncher = () => <span>Launcher</span>) => act(() => root!.render(withTestLocalization(
    <ApplicationRenderBoundary><AuxiliaryWorkbenchPanel store={store}
      contributions={contributions.map((entry) => ({ ...entry }))} active renderLauncher={renderLauncher} /></ApplicationRenderBoundary>,
  )));
  render();
  return { container, mounts, unmounts, resources, prepare, close, terminal, chat, render,
    fail: (kind: string, surface: string, mode: string) => { failingKind = kind; failureSurface = surface; failureMode = mode; },
    recover: () => { failingKind = ""; },
  };
}

it.each([
  ["chat", "terminal", "callback"], ["chat", "terminal", "child"],
  ["terminal", "chat", "callback"], ["terminal", "chat", "child"],
])("isolates %s %s-neighbor content failure (%s), and reloads only the failed view", async (failedKind, neighborKind, mode) => {
  const workbench = await mixedWorkbench();
  const { container } = workbench;
  const neighbor = container.querySelector<HTMLInputElement>(`[data-fixture-kind="${neighborKind}"]`)!;
  neighbor.value = "unfinished input";
  const topology = store.getSnapshot().topology;
  workbench.fail(failedKind, "content", mode); workbench.render();

  expect(container.querySelector(".application-render-fallback")).toBeNull();
  expect(container.querySelector(".auxiliary-workbench-render-failure")).not.toBeNull();
  expect(container.querySelector(`[data-fixture-kind="${neighborKind}"]`)).toBe(neighbor);
  expect(workbench.unmounts.get(neighborKind) ?? 0).toBe(0);
  act(() => container.querySelector<HTMLButtonElement>(".auxiliary-workbench-render-failure button")!.click());
  expect(container.querySelector(".auxiliary-workbench-render-failure")).not.toBeNull();
  expect(container.querySelector(`[data-fixture-kind="${neighborKind}"]`)).toBe(neighbor);
  workbench.recover();
  act(() => container.querySelector<HTMLButtonElement>(".auxiliary-workbench-render-failure button")!.click());

  expect(container.querySelector(".auxiliary-workbench-render-failure")).toBeNull();
  expect(container.querySelector(`[data-fixture-kind="${failedKind}"]`)).not.toBeNull();
  expect(container.querySelector(`[data-fixture-kind="${neighborKind}"]`)).toBe(neighbor);
  expect(neighbor.value).toBe("unfinished input");
  expect(workbench.mounts.get(neighborKind)).toBe(1);
  expect(store.getSnapshot().topology).toBe(topology);
  expect(workbench.prepare).toHaveBeenCalledTimes(2);
  expect(workbench.close).not.toHaveBeenCalled();
  for (const [kind, resource] of workbench.resources) {
    expect(store.getResource(`fixture-${kind}`, () => { throw new Error("resource was lost"); })).toBe(resource);
    expect(resource.dispose).not.toHaveBeenCalled();
  }
});

it.each(["callback", "child"])("isolates an optional status renderer failure (%s) without removing tabs or content", async (mode) => {
  const workbench = await mixedWorkbench();
  const terminal = workbench.container.querySelector('[data-fixture-kind="terminal"]');
  const chat = workbench.container.querySelector('[data-fixture-kind="chat"]');
  workbench.fail("chat", "status", mode); workbench.render();
  expect(workbench.container.querySelector(".application-render-fallback")).toBeNull();
  expect(workbench.container.querySelector('[data-fixture-kind="terminal"]')).toBe(terminal);
  expect(workbench.container.querySelector('[data-fixture-kind="chat"]')).toBe(chat);
  expect(workbench.container.querySelectorAll('[role="tab"]')).toHaveLength(2);
  expect(workbench.container.querySelector('[data-fixture-status="chat"]')).toBeNull();
  expect(workbench.close).not.toHaveBeenCalled();
  expect(workbench.unmounts.size).toBe(0);
  workbench.recover();
  act(() => store.updateSnapshot(workbench.chat, { ...store.getSnapshot().snapshots.get(workbench.chat)!, status: "running", running: true }));
  expect(workbench.container.querySelector('[data-fixture-status="chat"]')).not.toBeNull();
  expect(workbench.container.querySelector('[data-fixture-kind="terminal"]')).toBe(terminal);
});

it("uses the declared minimum when a feature measurement fails, retaining both split hosts", async () => {
  const workbench = await mixedWorkbench();
  const terminal = workbench.container.querySelector('[data-fixture-kind="terminal"]');
  const chat = workbench.container.querySelector('[data-fixture-kind="chat"]');
  workbench.fail("terminal", "minimum", "callback"); workbench.render();
  expect(workbench.container.querySelector(".application-render-fallback")).toBeNull();
  expect(workbench.container.querySelector('[data-fixture-kind="terminal"]')).toBe(terminal);
  expect(workbench.container.querySelector('[data-fixture-kind="chat"]')).toBe(chat);
  expect(workbench.unmounts.size).toBe(0);
  expect(console.error).toHaveBeenCalledWith("[AuxiliaryWorkbench] minimum size unavailable", { itemId: workbench.terminal });
});

it.each(["empty", "tab"])("contains a launcher callback failure in the %s workbench", async (placement) => {
  const workbench = await mixedWorkbench();
  const terminal = workbench.container.querySelector('[data-fixture-kind="terminal"]');
  if (placement === "empty") {
    act(() => { store.removeItem(workbench.terminal); store.removeItem(workbench.chat); });
  } else {
    act(() => { store.createLauncher(null, "New tab"); });
  }
  let failed = true;
  workbench.render(() => { if (failed) throw new Error("fixture launcher failure"); return <span>Recovered launcher</span>; });
  expect(workbench.container.querySelector(".application-render-fallback")).toBeNull();
  expect(workbench.container.querySelector(".auxiliary-workbench-render-failure")).not.toBeNull();
  if (placement === "tab") {
    expect(workbench.container.querySelector('[data-fixture-kind="terminal"]')).toBe(terminal);
    expect(workbench.unmounts.get("terminal") ?? 0).toBe(0);
  }
  failed = false;
  act(() => workbench.container.querySelector<HTMLButtonElement>(".auxiliary-workbench-render-failure button")!.click());
  expect(workbench.container.textContent).toContain("Recovered launcher");
  expect(workbench.close).not.toHaveBeenCalled();
});
