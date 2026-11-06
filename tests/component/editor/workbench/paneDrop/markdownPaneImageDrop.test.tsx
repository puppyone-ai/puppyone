/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDocumentDropRegistry,
  DocumentDropTargetProvider,
  EXPLORER_REFERENCE_DRAG_TYPE,
} from "@puppyone/shared-ui";
import { DocumentAssetImportBoundary, type DocumentAssetImportPort } from "../../../../../src/shared-ui/editor/resource/DocumentAssetImport";
import { MarkdownCodeMirrorEditor } from "../../../../../src/shared-ui/editor/markdown/MarkdownCodeMirrorEditor";
import { useExplorerFileDrop } from "../../../../../src/features/editor-workbench/drag-and-drop/useExplorerFileDrop";
import { withTestLocalization } from "../../../../support/react/localization";
import type { ResourceDragState } from "../../../../../src/platform/resourceDragSession";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const resourceRoot = "puppyone-local://workspace/root";
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete window.puppyoneDesktop;
  vi.restoreAllMocks();
});

function imageTransfer() {
  const transfer = new DataTransfer();
  transfer.setData(EXPLORER_REFERENCE_DRAG_TYPE, JSON.stringify({
    version: 1, workspaceId: "workspace",
    entries: [{ path: `${resourceRoot}/assets/p.png`, name: "p.png", entryType: "file" }],
  }));
  return transfer;
}
function nativeFiles(count = 1) {
  const transfer = new DataTransfer();
  for (let i = 0; i < count; i++) transfer.items.add(new File(["image"], `p${i}.png`));
  Object.defineProperty(transfer, "types", { value: ["Files"] });
  return transfer;
}
function drag(type: string, transfer: DataTransfer, x = 400, y = 300) {
  const event = new DragEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: transfer }, clientX: { value: x }, clientY: { value: y },
  });
  return event;
}
async function fixture(assets: DocumentAssetImportPort | null = null) {
  let publish!: (state: ResourceDragState) => void;
  if (window.puppyoneDesktop) Object.assign(window.puppyoneDesktop, {
    onResourceDragState: (listener: typeof publish) => { publish = listener; return () => {}; },
    previewResourceDrag: async () => null,
    setNativeSurfacePointerPassthrough: vi.fn(), setNativeSurfaceOccluded: vi.fn(),
  });
  const registry = createDocumentDropRegistry();
  const open = vi.fn();
  function Harness({ path = `${resourceRoot}/notes/a.md`, readOnly = false }) {
    const controller = useExplorerFileDrop("workspace", open, { workspacePath: "/workspace", paneIds: ["pane"] }, { registry });
    return <DocumentDropTargetProvider registry={registry}>
      <DocumentAssetImportBoundary port={assets}>
        <section data-pane data-insert-pane={controller.insertTargetPaneId}
          onDragOverCapture={(event) => controller.over(event, "pane")}
          onDropCapture={(event) => controller.drop(event, "pane")}>
          <MarkdownCodeMirrorEditor value={"alpha\n\nbeta\n"} readOnly={readOnly} livePreview={false}
            documentPath={path} workspaceRoot={resourceRoot} workspaceId="workspace" />
          <div data-file-split-targets>
            <div data-file-split-edge="left" />
            <div data-file-split-edge="right" />
            <div data-file-split-edge="top" />
            <div data-file-split-edge="bottom" />
          </div>
        </section>
        <output>{controller.dropFailure ?? "ok"}</output>
      </DocumentAssetImportBoundary>
    </DocumentDropTargetProvider>;
  }
  const render = async (path?: string, readOnly?: boolean) => {
    await act(async () => root.render(withTestLocalization(<Harness path={path} readOnly={readOnly} />)));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    host.querySelector<HTMLElement>("[data-pane]")!.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    host.querySelector<HTMLElement>(".cm-scroller")!.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
    host.querySelector<HTMLElement>('[data-file-split-edge="left"]')!.getBoundingClientRect = () => new DOMRect(12, 160, 120, 280);
    host.querySelector<HTMLElement>('[data-file-split-edge="right"]')!.getBoundingClientRect = () => new DOMRect(668, 160, 120, 280);
    host.querySelector<HTMLElement>('[data-file-split-edge="top"]')!.getBoundingClientRect = () => new DOMRect(260, 12, 280, 72);
    host.querySelector<HTMLElement>('[data-file-split-edge="bottom"]')!.getBoundingClientRect = () => new DOMRect(260, 516, 280, 72);
  };
  await render();
  const view = EditorView.findFromDOM(host.querySelector(".cm-content")!)!;
  vi.spyOn(view, "documentTop", "get").mockReturnValue(0);
  vi.spyOn(view, "scaleX", "get").mockReturnValue(1);
  vi.spyOn(view, "scaleY", "get").mockReturnValue(1);
  view.dom.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
  view.contentDOM.getBoundingClientRect = () => new DOMRect(50, 100, 700, 400);
  vi.spyOn(view, "lineBlockAt").mockImplementation(position => {
    const line = view.state.doc.lineAt(position);
    const top = line.number * 100;
    return { from: line.from, to: line.to, top, bottom: top + 60, height: 60 } as ReturnType<EditorView["lineBlockAt"]>;
  });
  return {
    open, view, render,
    preview: (state: ResourceDragState) => act(() => publish(state)),
    drop: async (data = imageTransfer(), x = 400, y = 300) => {
      await act(async () => { host.querySelector(".cm-content")!.dispatchEvent(drag("drop", data, x, y)); });
    },
    text: () => host.querySelector(".cm-content")!.textContent,
    error: () => host.querySelector("output")!.textContent,
  };
}

describe("Markdown image insertion through the pane capture handler", () => {
  it("inserts a root-qualified image at release coordinates without prior editor dragover", async () => {
    const f = await fixture();
    await f.drop();
    expect(f.view.state.doc.toString()).toBe("alpha\n\n![p](../assets/p.png)\n\nbeta\n");
    expect(f.open).not.toHaveBeenCalled();
    expect(f.view.hasFocus).toBe(true);
  });
  it.each([
    { edge: "left", x: 50, y: 300, direction: "horizontal", placement: "first" },
    { edge: "right", x: 750, y: 300, direction: "horizontal", placement: "second" },
    { edge: "top", x: 400, y: 40, direction: "vertical", placement: "first" },
    { edge: "bottom", x: 400, y: 560, direction: "vertical", placement: "second" },
  ])("splits an image on the $edge card without editing the document", async ({ x, y, direction, placement }) => {
    const f = await fixture();
    await f.drop(imageTransfer(), x, y);
    expect(f.open).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ path: `${resourceRoot}/assets/p.png` }), "pane", direction, placement);
    expect(f.view.state.doc.toString()).toBe("alpha\n\nbeta\n");
  });
  it("previews insertion using native session metadata while Files is protected", async () => {
    window.puppyoneDesktop = { resourceDragSessionSupported: true } as unknown as NonNullable<typeof window.puppyoneDesktop>;
    const f = await fixture();
    f.preview({ id: "drag-1", entries: [{ path: `${resourceRoot}/assets/p.png`, name: "p.png", entryType: "file" }] });
    const protectedTransfer = new DataTransfer();
    Object.defineProperty(protectedTransfer, "types", { value: ["Files"] });
    act(() => host.querySelector(".cm-content")!.dispatchEvent(drag("dragover", protectedTransfer)));
    expect(host.querySelector<HTMLElement>("[data-pane]")!.dataset.insertPane).toBe("pane");
    expect(host.querySelector<HTMLElement>(".cm-md-image-drop-indicator")!.hidden).toBe(false);
    expect(f.view.state.doc.toString()).toBe("alpha\n\nbeta\n");
  });
  it("keeps the painted anchor when window capture resets native metadata before the pane drop", async () => {
    window.puppyoneDesktop = { resourceDragSessionSupported: true, claimResourceDrop: vi.fn(async () => ({ entries: [
      { path: `${resourceRoot}/assets/p.png`, name: "p.png", entryType: "file" },
    ] })) } as unknown as NonNullable<typeof window.puppyoneDesktop>;
    const f = await fixture();
    f.preview({ id: "drag-1", entries: [{ path: `${resourceRoot}/assets/p.png`, name: "p.png", entryType: "file" }] });
    act(() => host.querySelector(".cm-content")!.dispatchEvent(drag("dragover", nativeFiles())));
    expect(host.querySelector<HTMLElement>(".cm-md-image-drop-indicator")!.hidden).toBe(false);
    vi.mocked(f.view.lineBlockAt).mockReturnValue({ from: 0, to: 12, top: 400, bottom: 500, height: 100 } as ReturnType<EditorView["lineBlockAt"]>);
    await f.drop(nativeFiles());
    expect(f.view.state.doc.toString()).toBe("alpha\n\n![p](../assets/p.png)\n\nbeta\n");
  });
  it("claims native workspace images before referencing their canonical path", async () => {
    const claim = vi.fn(async () => ({ entries: [{ path: `${resourceRoot}/assets/p.png`, name: "p.png", entryType: "file" }] }));
    window.puppyoneDesktop = { resourceDragSessionSupported: true, claimResourceDrop: claim } as unknown as NonNullable<typeof window.puppyoneDesktop>;
    const importImage = vi.fn(async () => ({ path: `${resourceRoot}/notes/copied.png` }));
    const f = await fixture({ importImage });
    await f.drop(nativeFiles());
    expect(claim).toHaveBeenCalledOnce();
    expect(importImage).not.toHaveBeenCalled();
    expect(f.text()).toContain("![p](../assets/p.png)");
    expect(f.open).not.toHaveBeenCalled();
  });
  it("never imports a rejected native session as an external image", async () => {
    window.puppyoneDesktop = { resourceDragSessionSupported: true, claimResourceDrop: vi.fn(async () => { throw new Error("expired"); }) } as unknown as NonNullable<typeof window.puppyoneDesktop>;
    const importImage = vi.fn(async () => ({ path: `${resourceRoot}/notes/copied.png` }));
    const f = await fixture({ importImage });
    await f.drop(nativeFiles());
    expect(importImage).not.toHaveBeenCalled();
    expect(f.error()).toBe("export");
    expect(f.open).not.toHaveBeenCalled();
  });
  it("does not reinterpret an unsupported receipt as a genuine external image", async () => {
    window.puppyoneDesktop = { resourceDragSessionSupported: true, claimResourceDrop: vi.fn(async () => ({
      entries: [{ path: `${resourceRoot}/folder`, name: "folder", entryType: "directory" }],
    })) } as unknown as NonNullable<typeof window.puppyoneDesktop>;
    const importImage = vi.fn(async () => ({ path: `${resourceRoot}/notes/copied.png` }));
    const f = await fixture({ importImage });
    await f.drop(nativeFiles());
    expect(importImage).not.toHaveBeenCalled();
    expect(f.view.state.doc.toString()).toBe("alpha\n\nbeta\n");
    expect(f.open).not.toHaveBeenCalled();
  });
  it("imports a genuine external file once using its original File handle", async () => {
    window.puppyoneDesktop = { resourceDragSessionSupported: true, claimResourceDrop: vi.fn(async () => null) } as unknown as NonNullable<typeof window.puppyoneDesktop>;
    const importImage = vi.fn(async () => ({ path: `${resourceRoot}/notes/copied.png` }));
    const f = await fixture({ importImage });
    const data = nativeFiles();
    await f.drop(data);
    expect(importImage).toHaveBeenCalledExactlyOnceWith(`${resourceRoot}/notes/a.md`, data.files[0]);
    expect(f.text()).toContain("![p0](copied.png)");
    expect(f.open).not.toHaveBeenCalled();
  });
  it("does not silently insert only the first of several native files", async () => {
    window.puppyoneDesktop = { resourceDragSessionSupported: true, claimResourceDrop: vi.fn(async () => null) } as unknown as NonNullable<typeof window.puppyoneDesktop>;
    const importImage = vi.fn(async () => ({ path: `${resourceRoot}/notes/copied.png` }));
    const f = await fixture({ importImage });
    await f.drop(nativeFiles(2));
    expect(importImage).not.toHaveBeenCalled();
    expect(f.view.state.doc.toString()).toBe("alpha\n\nbeta\n");
  });
  it("maps the release position through edits while the native receipt is pending", async () => {
    let finish!: (value: { entries: { path: string; name: string; entryType: "file" }[] }) => void;
    window.puppyoneDesktop = { resourceDragSessionSupported: true, claimResourceDrop: vi.fn(() => new Promise((resolve) => { finish = resolve; })) } as unknown as NonNullable<typeof window.puppyoneDesktop>;
    const f = await fixture();
    await f.drop(nativeFiles());
    act(() => f.view.dispatch({ changes: { from: 0, insert: "prefix\n" } }));
    await act(async () => finish({ entries: [{ path: `${resourceRoot}/assets/p.png`, name: "p.png", entryType: "file" }] }));
    expect(f.view.state.doc.toString()).toBe("prefix\nalpha\n\n![p](../assets/p.png)\n\nbeta\n");
    expect(f.open).not.toHaveBeenCalled();
  });
  it("retires pending insertion when another document replaces the target", async () => {
    let finish!: (value: { entries: { path: string; name: string; entryType: "file" }[] }) => void;
    window.puppyoneDesktop = { resourceDragSessionSupported: true, claimResourceDrop: vi.fn(() => new Promise((resolve) => { finish = resolve; })) } as unknown as NonNullable<typeof window.puppyoneDesktop>;
    const f = await fixture();
    await f.drop(nativeFiles());
    await f.render(`${resourceRoot}/notes/other.md`);
    await act(async () => finish({ entries: [{ path: `${resourceRoot}/assets/p.png`, name: "p.png", entryType: "file" }] }));
    expect(f.text()).not.toContain("![");
    expect(f.open).not.toHaveBeenCalled();
  });
  it("discards a failed import after the target becomes read-only", async () => {
    window.puppyoneDesktop = { resourceDragSessionSupported: true, claimResourceDrop: vi.fn(async () => null) } as unknown as NonNullable<typeof window.puppyoneDesktop>;
    let fail!: (error: Error) => void;
    const importImage = vi.fn(() => new Promise<{ path: string }>((_resolve, reject) => { fail = reject; }));
    const f = await fixture({ importImage });
    await f.drop(nativeFiles());
    expect(importImage).toHaveBeenCalledOnce();
    await f.render(`${resourceRoot}/notes/a.md`, true);
    await act(async () => fail(new Error("cancelled import")));
    expect(f.text()).not.toContain("![");
    expect(f.error()).toBe("ok");
    expect(f.open).not.toHaveBeenCalled();
  });
  it("does not steal focus moved elsewhere while image import is pending", async () => {
    window.puppyoneDesktop = { resourceDragSessionSupported: true, claimResourceDrop: vi.fn(async () => null) } as unknown as NonNullable<typeof window.puppyoneDesktop>;
    let finish!: (value: { path: string }) => void;
    const f = await fixture({ importImage: () => new Promise((resolve) => { finish = resolve; }) });
    await f.drop(nativeFiles());
    const input = document.createElement("input");
    host.append(input);
    input.focus();
    await act(async () => finish({ path: `${resourceRoot}/notes/imported.png` }));
    expect(f.text()).toContain("![p0](imported.png)");
    expect(document.activeElement).toBe(input);
  });
  it("inserts exactly at the previewed paragraph boundary and retires the line", async () => {
    const f = await fixture();
    act(() => host.querySelector(".cm-content")!.dispatchEvent(drag("dragover", imageTransfer())));
    const marker = host.querySelector<HTMLElement>(".cm-md-image-drop-indicator")!;
    expect(marker.hidden).toBe(false);
    expect(marker.style.transform).toContain("230px");
    await f.drop();
    expect(f.view.state.doc.toString()).toBe("alpha\n\n![p](../assets/p.png)\n\nbeta\n");
    expect(marker.hidden).toBe(true);
  });
  it("rejects a delayed insertion if an intervening edit joins the two paragraphs", async () => {
    let finish!: (value: { entries: { path: string; name: string; entryType: "file" }[] }) => void;
    window.puppyoneDesktop = { resourceDragSessionSupported: true, claimResourceDrop: vi.fn(() => new Promise(resolve => { finish = resolve; })) } as unknown as NonNullable<typeof window.puppyoneDesktop>;
    const f = await fixture();
    await f.drop(nativeFiles());
    act(() => f.view.dispatch({ changes: { from: 5, to: 7, insert: " " } }));
    await act(async () => finish({ entries: [{ path: `${resourceRoot}/assets/p.png`, name: "p.png", entryType: "file" }] }));
    expect(f.view.state.doc.toString()).toBe("alpha beta\n");
    expect(f.error()).toBe("image");
    expect(f.open).not.toHaveBeenCalled();
  });

});
