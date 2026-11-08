import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, vi } from "vitest";
import type { DataPort } from "../../../src/shared-ui/core/types";
import { DataWorkspace } from "../../../src/shared-ui/data/DataWorkspace";
import { AuxiliaryPanelHost } from "../../../src/features/app-shell/auxiliary/AuxiliaryPanelHost";
import { withTestLocalization } from "../react/localization";

/** Mounted workspaces with controlled side panes, and the pointer and frame stubs that drive their resize. */
export let root: Root | null = null;

/** Registers the shared setup in the calling test file. */
export function setUpPaneResize() {
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    document.body.className = "";
    vi.restoreAllMocks();
  });
}

export async function renderWorkspace({
  explorerCollapsed = false,
  onCollapsedChange,
  onResizeActiveChange,
  onWidthChange,
}: {
  explorerCollapsed?: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onResizeActiveChange?: (active: boolean) => void;
  onWidthChange: (width: number) => void;
}) {
  const dataPort: DataPort = {
    listChildren: vi.fn(async () => []),
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(withTestLocalization(
      <DataWorkspace
        collapsedExplorerWidth={0}
        dataPort={dataPort}
        enableMarkdownLinkContentIndexing={false}
        explorerCollapsed={explorerCollapsed}
        explorerCollapseThreshold={120}
        explorerWidth={320}
        maxExplorerWidth={900}
        minExplorerWidth={240}
        resizableExplorer
        showHeader={false}
        workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
        onExplorerCollapsedChange={onCollapsedChange}
        onExplorerResizeActiveChange={onResizeActiveChange}
        onExplorerWidthChange={onWidthChange}
      />,
    ));
    await Promise.resolve();
  });
  return container;
}

export function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(node));
  return container;
}

export function ControlledExplorerWorkspace() {
  const [collapsed, setCollapsed] = React.useState(false);
  const [width, setWidth] = React.useState(480);
  const dataPort = React.useMemo<DataPort>(() => ({
    listChildren: vi.fn(async () => []),
  }), []);
  return (
    <>
      <button
        className="controlled-explorer-expand"
        type="button"
        onClick={() => setCollapsed(false)}
      >
        Expand
      </button>
      <output className="controlled-explorer-width">{width}</output>
      <DataWorkspace
        collapsedExplorerWidth={0}
        dataPort={dataPort}
        enableMarkdownLinkContentIndexing={false}
        explorerCollapsed={collapsed}
        explorerCollapseThreshold={120}
        explorerWidth={width}
        maxExplorerWidth={900}
        minExplorerWidth={240}
        resizableExplorer
        showHeader={false}
        workspace={{ id: "workspace", name: "Workspace", path: "/workspace", status: "recording" }}
        onExplorerCollapsedChange={setCollapsed}
        onExplorerWidthChange={setWidth}
      />
    </>
  );
}

export function ControlledAuxiliaryPanel({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = React.useState(true);
  const changeOpen = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    setOpen(nextOpen);
  };
  return (
    <>
      <button className="external-panel-close" type="button" onClick={() => changeOpen(false)}>
        Close
      </button>
      <AuxiliaryPanelHost
        collapseThreshold={210}
        maxWidth={900}
        minWidth={420}
        open={open}
        resizable
        width={700}
        onOpenChange={changeOpen}
        onWidthChange={vi.fn()}
      >
        <div>Agent</div>
      </AuxiliaryPanelHost>
    </>
  );
}

export function requireHandle(container: HTMLElement, selector: string) {
  const handle = container.querySelector<HTMLElement>(selector);
  if (!handle) throw new Error(`Missing resize handle: ${selector}`);
  return handle;
}

export function pointerEvent(type: string, clientX: number, pointerId: number) {
  return new PointerEvent(type, {
    bubbles: true,
    button: 0,
    clientX,
    pointerId,
  });
}

export function transitionEvent(type: string, propertyName: string) {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "propertyName", { value: propertyName });
  return event;
}

export function mockAnimationFrames() {
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.set(++id, callback); return id; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(frame => { frames.delete(frame); });
  return () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(0));
  };
}

/** Mounts a tree the shared teardown unmounts. */
export function mountRoot(container: HTMLElement): Root {
  root = createRoot(container);
  return root;
}

/** Unmounts the tree before the test ends, as a closing window would. */
export function unmountRoot() {
  root?.unmount();
  root = null;
}
