/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useExplorerFileDrop } from "../../../../src/features/editor-workbench/drag-and-drop/useExplorerFileDrop";
import { useResourceDragExport } from "../../../../src/features/data-workspace/useResourceDragExport";
import type { ResolvedWorkbenchDataResource } from "../../../../src/features/data-workspace/workbenchDataPort";
import type { ResourceDragState } from "../../../../src/platform/resourceDragSession";
import { useDesktopEditorWorkbench, type DesktopEditorWorkbenchController } from "../../../../src/features/editor-workbench/controller/useDesktopEditorWorkbench";
import { getEditorPanes, EXPLORER_REFERENCE_DRAG_TYPE, serializeExplorerReferenceDrag } from "@puppyone/shared-ui";
import { parseWorkspaceResourceReference, createWorkspaceResourceReference } from "../../../../shared/workspace-resource-reference.mjs";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const uri = "puppyone-local://workspace/root-b/docs/same.md";
const entry = { path: uri, name: "same.md", entryType: "file" as const };
let root: Root;
afterEach(() => { act(() => root?.unmount()); document.body.innerHTML = ""; window.localStorage.clear(); delete window.puppyoneDesktop; vi.restoreAllMocks(); });

const resolveEditorResource = (resource: string) => {
  const { folderId, relativePath } = parseWorkspaceResourceReference(resource);
  return { rootUri: createWorkspaceResourceReference(folderId), resourcePath: relativePath, hostPath: resource };
};

function fixture() {
  let publish!: (state: ResourceDragState) => void;
  const claim = vi.fn<NonNullable<typeof window.puppyoneDesktop>["claimResourceDrop"]>(async () => ({ entries: [entry] }));
  const pointer = vi.fn();
  const start = vi.fn(async () => { publish({ id: "native-1", entries: [entry] }); return true; });
  window.puppyoneDesktop = {
    resourceDragSessionSupported: true,
    claimResourceDrop: claim,
    startResourceDrag: start,
    previewResourceDrag: vi.fn(async () => ({ id: "native-1", entries: [entry] })),
    onResourceDragState: (listener: typeof publish) => { publish = listener; return () => {}; },
    setNativeSurfacePointerPassthrough: pointer,
  } as unknown as NonNullable<typeof window.puppyoneDesktop>;
  const open = vi.fn();
  let workbench!: DesktopEditorWorkbenchController;
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  const resolve = () => ({ folder: { workspace: { path: "/repo-b" } }, providerPath: "docs/same.md" }) as ResolvedWorkbenchDataResource;
  function Harness({ workspace = "workspace", panes = ["pane-1"] }: { workspace?: string; panes?: string[] }) {
    workbench = useDesktopEditorWorkbench({ id: workspace, name: workspace, path: `/${workspace}`, status: "recording" }, null, null, resolveEditorResource);
    const drop = useExplorerFileDrop(workspace, (...args) => {
      open(...args);
      workbench.openDocumentAtPaneEdge(...args);
    }, { paneIds: panes, workspacePath: `/${workspace}` });
    const exportNodes = useResourceDragExport(resolve);
    return <><div draggable data-source onDragStart={(event) => exportNodes([{ id: uri, path: uri, name: entry.name, type: "file" }], event)} />
      {panes.map((id) => <section key={id} data-pane={id} data-edge={drop.dropIntent?.edge}
        onDragOver={(event) => drop.over(event, id)} onDrop={(event) => drop.drop(event, id)} />)}
      <output>{drop.dropFailed ? "failed" : "ok"}</output></>;
  }
  const render = (workspace?: string, panes?: string[]) => act(() => root.render(<Harness workspace={workspace} panes={panes} />));
  render();
  const pane = container.querySelector("section")!;
  pane.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
  return { container, pane, claim, pointer, start, open, render, get workbench() { return workbench; }, publish: (state: ResourceDragState) => publish(state) };
}

function nativeFiles() {
  const transfer = new DataTransfer(); transfer.items.add(new File(["content"], "same.md"));
  // Chromium advertises Files, unlike happy-dom's file MIME type.
  Object.defineProperty(transfer, "types", { value: ["Files"] });
  return transfer;
}
function drag(type: string, transfer: DataTransfer) {
  const event = new DragEvent(type, { bubbles: true, cancelable: true, clientX: 790, clientY: 300 });
  Object.defineProperties(event, { dataTransfer: { value: transfer }, clientX: { value: 790 }, clientY: { value: 300 } });
  return event;
}

it("connects the ordinary native source to Editor using Files and the canonical root-qualified identity", async () => {
  const f = fixture();
  const startEvent = drag("dragstart", new DataTransfer());
  await act(async () => { f.container.querySelector("[data-source]")!.dispatchEvent(startEvent); });
  expect(startEvent.defaultPrevented).toBe(true);
  expect(f.start).toHaveBeenCalledWith({ resources: [uri] });
  expect(f.pointer).toHaveBeenLastCalledWith({ active: true });
  const transfer = nativeFiles();
  act(() => f.pane.dispatchEvent(drag("dragover", transfer)));
  expect(f.pane.dataset.edge).toBe("right");
  await act(async () => { f.pane.dispatchEvent(drag("drop", transfer)); });
  expect(f.claim).toHaveBeenCalledWith({ files: [transfer.files[0]], intent: "editor-open", targetResource: undefined });
  expect(f.open).toHaveBeenCalledExactlyOnceWith({ id: uri, path: uri, name: "same.md", type: "markdown" }, "pane-1", "horizontal", "second");
  expect(f.pane.dataset.edge).toBeUndefined();
  expect(f.pointer).toHaveBeenLastCalledWith({ active: false });
});

it("claims without relying on a preview that window drop capture has already cleared", async () => {
  const f = fixture();
  let complete!: (value: { entries: typeof entry[] }) => void;
  f.claim.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  act(() => { f.publish({ id: "native-1", entries: [entry] }); f.pane.dispatchEvent(drag("drop", nativeFiles())); });
  expect(f.open).not.toHaveBeenCalled();
  expect(f.pointer).toHaveBeenLastCalledWith({ active: false });
  // Native end and HTML dragend retire presentation, not a valid pending receipt.
  act(() => { f.publish({ id: "native-1", entries: null }); window.dispatchEvent(new Event("dragend")); });
  await act(async () => { complete({ entries: [entry] }); });
  expect(f.open).toHaveBeenCalledOnce();
});

it.each(["workspace", "pane", "unmount"])("discards a late receipt after %s retirement", async (retire) => {
  const f = fixture();
  let complete!: (value: { entries: typeof entry[] }) => void;
  f.claim.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  act(() => { f.pane.dispatchEvent(drag("drop", nativeFiles())); });
  if (retire === "workspace") { f.render("different"); f.render("workspace"); }
  if (retire === "pane") { f.render("workspace", []); f.render("workspace", ["pane-1"]); }
  if (retire === "unmount") act(() => root.unmount());
  await act(async () => { complete({ entries: [entry] }); });
  expect(f.open).not.toHaveBeenCalled();
});

it("reports a rejected native claim without falling back to the preview or raw path", async () => {
  const f = fixture(); f.claim.mockRejectedValueOnce(new Error("expired"));
  act(() => f.publish({ id: "native-1", entries: [entry] }));
  await act(async () => { f.pane.dispatchEvent(drag("drop", nativeFiles())); });
  expect(f.open).not.toHaveBeenCalled();
  expect(f.container.querySelector("output")?.textContent).toBe("failed");
  expect(f.pointer).toHaveBeenLastCalledWith({ active: false });
});

it.each([null, { entries: [{ ...entry, entryType: "directory" as const }] }, { entries: [entry, entry] }, { entries: [{ ...entry, path: "/repo-b/same.md" }] }])(
  "does not turn an external or unsupported payload into an Editor document: %j", async (result) => {
    const f = fixture(); f.claim.mockResolvedValueOnce(result);
    await act(async () => { f.pane.dispatchEvent(drag("drop", nativeFiles())); });
    expect(f.open).not.toHaveBeenCalled();
  },
);

it("does not offer a split preview for a directory or multiple entries and releases native routing on cancellation", () => {
  const f = fixture();
  for (const entries of [[{ ...entry, entryType: "directory" as const }], [entry, entry]]) {
    act(() => { f.publish({ id: "native-1", entries }); f.pane.dispatchEvent(drag("dragover", nativeFiles())); });
    expect(f.pane.dataset.edge).toBeUndefined();
    expect(f.pointer).not.toHaveBeenCalledWith({ active: true });
  }
  act(() => f.publish({ id: "native-1", entries: [entry] }));
  expect(f.pointer).toHaveBeenLastCalledWith({ active: true });
  act(() => f.publish({ id: "native-1", entries: null }));
  expect(f.pointer).toHaveBeenLastCalledWith({ active: false });
});

it("opens an empty pane, splits distinct same-named resources, then focuses an already visible document", async () => {
  const f = fixture();
  f.render("workspace", ["editor-pane-1"]);
  const pane = f.container.querySelector("section")!;
  pane.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
  await act(async () => { pane.dispatchEvent(drag("drop", nativeFiles())); });
  expect(getEditorPanes(f.workbench.paneLayout)).toHaveLength(1);
  expect(f.workbench.activeEditorId).toBe(uri);
  const other = { ...entry, path: uri.replace("root-b", "root-a") };
  f.claim.mockResolvedValueOnce({ entries: [other] });
  await act(async () => { pane.dispatchEvent(drag("drop", nativeFiles())); });
  expect(getEditorPanes(f.workbench.paneLayout)).toHaveLength(2);
  expect(f.workbench.state.editors.map((editor) => editor.id).sort()).toEqual([other.path, uri]);
  await act(async () => { pane.dispatchEvent(drag("drop", nativeFiles())); });
  expect(getEditorPanes(f.workbench.paneLayout)).toHaveLength(2);
  expect(f.workbench.activeEditorId).toBe(uri);
});

it("requires a native receipt even when Files also advertises forged HTML identity", async () => {
  const f = fixture(); f.claim.mockRejectedValueOnce(new Error("forged files"));
  const transfer = nativeFiles();
  transfer.setData(EXPLORER_REFERENCE_DRAG_TYPE, serializeExplorerReferenceDrag("workspace", [{ id: uri, path: uri, name: "same.md", type: "file" }]));
  await act(async () => { f.pane.dispatchEvent(drag("drop", transfer)); });
  expect(f.claim).toHaveBeenCalledOnce();
  expect(f.open).not.toHaveBeenCalled();
});
