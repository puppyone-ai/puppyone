/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXPLORER_REFERENCE_DRAG_TYPE,
  createDocumentDropRegistry,
  type DocumentDropPayload,
  type DocumentDropTargetRegistration,
} from "@puppyone/shared-ui";
import { useExplorerFileDrop } from "../../../../../src/features/editor-workbench/drag-and-drop/useExplorerFileDrop";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

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
});

function transfer(path = "assets/p.png", name = "p.png") {
  const data = new DataTransfer();
  data.setData(EXPLORER_REFERENCE_DRAG_TYPE, JSON.stringify({
    version: 1,
    workspaceId: "workspace",
    entries: [{ path, name, entryType: "file" }],
  }));
  return data;
}

function drag(type: string, data: DataTransfer, x: number, y: number) {
  const event = new DragEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: data },
    clientX: { value: x },
    clientY: { value: y },
  });
  return event;
}

function harness(target: Partial<DocumentDropTargetRegistration> = {}) {
  const registry = createDocumentDropRegistry();
  registry.install({
    containsPoint: (x, y) => x > 200 && x < 600 && y > 100 && y < 500,
    prepareInsert: () => vi.fn(async () => true),
    ...target,
  });
  const open = vi.fn();
  const openInPane = vi.fn();
  function Harness() {
    const drop = useExplorerFileDrop("workspace", open, {
      workspacePath: "/workspace",
      paneIds: ["pane-1"],
    }, { registry, onOpenInPane: openInPane });
    return (
      <>
        <section
          data-pane="pane-1"
          data-edge={drop.dropIntent?.edge ?? ""}
          data-kind={drop.insertTargetPaneId === "pane-1" ? "insert" : ""}
          onDragOver={(event) => drop.over(event, "pane-1")}
          onDrop={(event) => drop.drop(event, "pane-1")}
          onDragLeave={(event) => drop.leave(event, "pane-1")}
        >
          <div data-file-split-targets>
            <div data-file-split-edge="left" />
            <div data-file-split-edge="right" />
          </div>
        </section>
        <output>{drop.dropFailure ?? "ok"}</output>
      </>
    );
  }
  act(() => root.render(<Harness />));
  const pane = host.querySelector("section")!;
  pane.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
  pane.querySelector<HTMLElement>('[data-file-split-edge="left"]')!.getBoundingClientRect = () => new DOMRect(8, 120, 120, 360);
  pane.querySelector<HTMLElement>('[data-file-split-edge="right"]')!.getBoundingClientRect = () => new DOMRect(672, 120, 120, 360);
  return {
    pane,
    open,
    openInPane,
    output: () => host.querySelector("output")!.textContent,
  };
}

describe("image drops into the reading area", () => {
  it("hands the workspace image to the document target without splitting", async () => {
    const inserted: DocumentDropPayload[] = [];
    const f = harness({
      prepareInsert: () => async (payload) => {
        if (payload) inserted.push(payload);
        return true;
      },
    });
    act(() => f.pane.dispatchEvent(drag("dragover", transfer(), 400, 300)));
    expect(f.pane.dataset.kind).toBe("insert");
    expect(f.pane.dataset.edge).toBe("");
    await act(async () => { f.pane.dispatchEvent(drag("drop", transfer(), 400, 300)); });
    expect(inserted).toEqual([{ kind: "workspace-entry", path: "assets/p.png", name: "p.png" }]);
    expect(f.open).not.toHaveBeenCalled();
    expect(f.output()).toBe("ok");
  });

  it("splits when the pointer is inside an explicit card", async () => {
    const f = harness();
    act(() => f.pane.dispatchEvent(drag("dragover", transfer(), 10, 300)));
    expect(f.pane.dataset.kind).toBe("");
    expect(f.pane.dataset.edge).toBe("left");
    await act(async () => { f.pane.dispatchEvent(drag("drop", transfer(), 10, 300)); });
    expect(f.open).toHaveBeenCalledTimes(1);
  });

  it("reports an unsupported image insertion without an unexpected split", async () => {
    const f = harness({ prepareInsert: () => async () => false });
    await act(async () => { f.pane.dispatchEvent(drag("drop", transfer(), 400, 300)); });
    expect(f.open).not.toHaveBeenCalled();
    expect(f.output()).toBe("image");
  });
  it("opens non-image body drops in the existing pane", async () => {
    const f = harness();
    await act(async () => { f.pane.dispatchEvent(drag("drop", transfer("notes/b.md", "b.md"), 400, 300)); });
    expect(f.open).not.toHaveBeenCalled();
    expect(f.openInPane).toHaveBeenCalledWith(expect.objectContaining({ path: "notes/b.md" }), "pane-1");
  });
  it("does not split at an invisible edge above the cards", async () => {
    const f = harness();
    await act(async () => { f.pane.dispatchEvent(drag("drop", transfer(), 10, 30)); });
    expect(f.open).not.toHaveBeenCalled();
    expect(f.openInPane).toHaveBeenCalledOnce();
  });

  it("reports an image insertion failure instead of opening a preview", async () => {
    const f = harness({ prepareInsert: () => async () => { throw new Error("invalid-image"); } });
    await act(async () => { f.pane.dispatchEvent(drag("drop", transfer(), 400, 300)); });
    expect(f.open).not.toHaveBeenCalled();
    expect(f.output()).toBe("image");
  });
  it("forwards the hover point and clears the document line on entering a split card", () => {
    const previewInsert = vi.fn(() => true);
    const clearInsertPreview = vi.fn();
    const f = harness({ previewInsert, clearInsertPreview });
    act(() => f.pane.dispatchEvent(drag("dragover", transfer(), 400, 300)));
    expect(previewInsert).toHaveBeenCalledWith({ x: 400, y: 300 });
    act(() => f.pane.dispatchEvent(drag("dragover", transfer(), 10, 300)));
    expect(clearInsertPreview).toHaveBeenCalledOnce();
    expect(f.pane.dataset.edge).toBe("left");
  });
  it.each(["dragleave", "dragend", "drop"])("clears the insertion line on %s", async (type) => {
    const clearInsertPreview = vi.fn();
    const f = harness({ previewInsert: () => true, clearInsertPreview });
    act(() => f.pane.dispatchEvent(drag("dragover", transfer(), 400, 300)));
    await act(async () => { f.pane.dispatchEvent(drag(type, transfer(), 400, 300)); });
    expect(clearInsertPreview).toHaveBeenCalledOnce();
  });
  it("does not advertise an insertion when the real boundary is outside the viewport", () => {
    const f = harness({ previewInsert: () => false, clearInsertPreview: vi.fn() });
    const data = transfer();
    act(() => f.pane.dispatchEvent(drag("dragover", data, 400, 300)));
    expect(f.pane.dataset.kind).toBe("");
    expect(data.dropEffect).toBe("none");
  });

});
