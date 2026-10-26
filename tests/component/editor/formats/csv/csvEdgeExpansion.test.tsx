/**
 * @vitest-environment happy-dom
 */
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CsvTableEditor } from "../../../../../packages/shared-ui/src/editor/viewers/csv/CsvTableEditor";
import type { EditorSourceSnapshotPort } from "../../../../../packages/shared-ui/src/editor/sourceSnapshot";
import { withTestLocalization } from "../../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let port: EditorSourceSnapshotPort | null;
let edits: number;
let frames: Map<number, FrameRequestCallback>;
let time: number;

beforeEach(() => {
  window.localStorage.clear();
  port = null; edits = 0; time = 0; frames = new Map();
  let sequence = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.set(++sequence, callback); return sequence; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { frames.delete(id); });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount()); container.remove(); window.localStorage.clear(); vi.restoreAllMocks();
});

describe("CSV horizontal edge expansion", () => {
  it("keeps growing and scrolling with a stationary pointer beyond a full viewport, then commits once", () => {
    const { handle, scroll } = mount(20);
    drag(handle, "pointerdown", 480);
    drag(handle, "pointermove", 520);
    const first = previewColumns();
    advanceFrames(80);
    expect(previewColumns()).toBeGreaterThan(first + 5);
    expect(scroll.scrollLeft).toBeGreaterThan(100);
    expect(edits).toBe(0);
    expect(port!.readSnapshot().content.split("\n")[0].split(",")).toHaveLength(20);
    const added = previewColumns();
    drag(handle, "pointerup", 520);
    expect(edits).toBe(1);
    expect(port!.readSnapshot().content.split("\n")[0].split(",")).toHaveLength(20 + added);
    expect(previewColumns()).toBe(0);
    advanceFrames(20);
    expect(edits).toBe(1);
    // Keeping focus on the corner must not make document undo inaccessible.
    expect(document.activeElement).toBe(handle);
    act(() => handle.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "z", metaKey: true })));
    expect(port!.readSnapshot().content.split("\n")[0].split(",")).toHaveLength(20);
    act(() => handle.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "z", metaKey: true, shiftKey: true })));
    expect(port!.readSnapshot().content.split("\n")[0].split(",")).toHaveLength(20 + added);
  });

  it.each(["Escape", "blur", "pointercancel", "lostpointercapture"])("cancels edge expansion on %s and restores scroll without editing", reason => {
    const { handle, scroll } = mount(20);
    const source = port!.readSnapshot().content;
    scroll.scrollLeft = 200;
    drag(handle, "pointerdown", 480); drag(handle, "pointermove", 520); advanceFrames(60);
    expect(previewColumns()).toBeGreaterThan(0);
    act(() => {
      if (reason === "Escape") document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      else if (reason === "blur") window.dispatchEvent(new Event("blur"));
      else handle.dispatchEvent(new PointerEvent(reason, { bubbles: true, pointerId: 88 }));
    });
    expect(scroll.scrollLeft).toBe(200);
    expect(previewColumns()).toBe(0);
    advanceFrames(60); drag(handle, "pointerup", 520);
    expect(port!.readSnapshot().content).toBe(source); expect(edits).toBe(0);
  });

  it("stops automatic growth when the pointer returns to the middle", () => {
    const { handle } = mount(20);
    drag(handle, "pointerdown", 480); drag(handle, "pointermove", 520); advanceFrames(80);
    drag(handle, "pointermove", 300);
    const added = previewColumns(); advanceFrames(80);
    expect(previewColumns()).toBe(added);
  });

  it("bounds preview DOM and stops at the column safety limit", () => {
    const { handle } = mount(250);
    drag(handle, "pointerdown", 480); drag(handle, "pointermove", 520); advanceFrames(200);
    expect(previewColumns()).toBe(6);
    expect(container.querySelectorAll("input, .csv-table-editor__expansion-cell").length).toBeLessThan(200);
    expect(Number(container.querySelector<HTMLElement>("table")!.dataset.csvMountedCells)).toBeLessThanOrEqual(2_000);
    advanceFrames(100); expect(previewColumns()).toBe(6);
    drag(handle, "pointerup", 520); expect(edits).toBe(1);
    expect(port!.readSnapshot().content.split("\n")[0].split(",")).toHaveLength(256);
  });

  it("commits a release outside the handle when pointer capture is unavailable", () => {
    const { handle } = mount(20);
    drag(handle, "pointerdown", 480); drag(handle, "pointermove", 620);
    const added = previewColumns();
    act(() => window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 88 })));
    expect(edits).toBe(1);
    expect(port!.readSnapshot().content.split("\n")[0].split(",")).toHaveLength(20 + added);
  });

  it("stops its animation when the view unmounts", () => {
    const { handle } = mount(20);
    drag(handle, "pointerdown", 480); drag(handle, "pointermove", 520); advanceFrames(20);
    act(() => root.unmount());
    expect(frames.size).toBe(0);
    advanceFrames(30); expect(edits).toBe(0);
  });

  it("cancels a live preview when an external replacement changes the table shape", () => {
    const { handle } = mount(20);
    drag(handle, "pointerdown", 480); drag(handle, "pointermove", 520); advanceFrames(20);
    act(() => port!.replaceContent("Name,Score\nAda,1"));
    expect(previewColumns()).toBe(0);
    advanceFrames(30); drag(handle, "pointerup", 520);
    expect(port!.readSnapshot().content).toBe("Name,Score\nAda,1");
    expect(edits).toBe(0);
  });
});

function mount(columns: number) {
  const content = [Array.from({ length: columns }, (_, i) => `Column ${i + 1}`).join(","),
    Array.from({ length: columns }, () => "1").join(",")].join("\n");
  act(() => root.render(withTestLocalization(<StrictMode><CsvTableEditor content={content} documentId="edge.csv" readOnly={false}
    onSnapshotPortChange={next => { port = next; }} onSourceRevisionChange={revision => { if (revision.origin === "local-edit") edits++; }} /></StrictMode>)));
  const scroll = container.querySelector<HTMLElement>(".csv-table-editor__scroll")!;
  const surface = container.querySelector<HTMLElement>(".csv-table-editor__surface")!;
  Object.defineProperties(scroll, {
    clientWidth: { configurable: true, value: 400 }, clientHeight: { configurable: true, value: 600 },
    getBoundingClientRect: { configurable: true, value: () => ({ left: 100, right: 500, top: 0, bottom: 600, width: 400, height: 600 }) },
  });
  Object.defineProperty(surface, "getBoundingClientRect", { configurable: true, value: () => ({ left: 100, right: 500, top: 0, bottom: 62, height: 62, width: 400 }) });
  const handle = container.querySelector<HTMLButtonElement>(".csv-table-editor__resize-handle")!;
  return { handle, scroll };
}
function drag(handle: HTMLElement, type: string, clientX: number) {
  act(() => handle.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 88, button: 0, clientX, clientY: 70 })));
}
function previewColumns() { return Number(container.querySelector<HTMLElement>("table")?.dataset.csvPreviewColumns ?? 0); }
function advanceFrames(count: number) {
  for (let i = 0; i < count; i++) {
    const pending = [...frames.values()]; frames.clear(); time += 16;
    act(() => pending.forEach(callback => callback(time)));
  }
}
