/**
 * @vitest-environment happy-dom
 */
import { act, useMemo, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTabularViewport, type TabularViewportProjection } from "../../../../packages/shared-ui/src/editor/table/useTabularViewport";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let projection: TabularViewportProjection;
let resize: ResizeObserverCallback;
let frames: Map<number, FrameRequestCallback>;

beforeEach(() => {
  vi.useFakeTimers();
  frames = new Map();
  let sequence = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { frames.delete(id); });
  vi.spyOn(window, "ResizeObserver").mockImplementation(function(callback: ResizeObserverCallback) {
    resize = callback;
    return { observe() {}, unobserve() {}, disconnect() {} };
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("tabular viewport geometry changes", () => {
  it("keeps RTL geometry in logical scroll coordinates as the table grows", () => {
    act(() => root.render(<Harness rows={2} columns={20} direction="rtl" />));
    const scroll = container.firstElementChild as HTMLElement;
    const surface = scroll.firstElementChild as HTMLElement;
    scroll.scrollLeft = -960;
    Object.defineProperties(scroll, {
      clientWidth: { configurable: true, value: 400 },
      getBoundingClientRect: { configurable: true, value: () => ({ left: 100, right: 500 }) },
    });
    Object.defineProperties(surface, {
      offsetLeft: { configurable: true, value: -2_000 },
      getBoundingClientRect: { configurable: true, value: () => ({ right: 500 - 32 + Math.abs(scroll.scrollLeft) }) },
    });
    act(() => root.render(<Harness rows={2} columns={25} direction="rtl" />));
    expect(projection.columnRange.start).toBeLessThanOrEqual(10);
    expect(projection.columnRange.end).toBeGreaterThanOrEqual(14);
  });

  it.each([
    ["resize frame", 2, 5], ["scroll end", 2, 5],
    ["resize frame", 5, 2], ["scroll end", 5, 2],
  ] as const)("uses the current shape after an older %s and a %s→%s change", async (source, before, after) => {
    act(() => root.render(<Harness rows={before} columns={before} />));
    if (source === "resize frame") {
      act(() => resize([], {} as ResizeObserver));
      expect(frames.size).toBe(1);
    } else {
      act(() => projection.handleScroll());
    }
    act(() => root.render(<Harness rows={after} columns={after} />));
    expect(projection.rowRange.end).toBe(after);
    expect(projection.columnRange.end).toBe(after);

    await act(async () => {
      if (source === "resize frame") {
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach(callback => callback(16));
      } else await vi.advanceTimersByTimeAsync(170);
    });
    expect(projection.rowRange.end).toBe(after);
    expect(projection.columnRange.end).toBe(after);
    expect(projection.rowItems.filter(item => item.kind === "item")).toHaveLength(after);
    expect(projection.columnItems.filter(item => item.kind === "item")).toHaveLength(after);
  });
});

function Harness({ rows, columns, direction = "ltr" }: { rows: number; columns: number; direction?: "ltr" | "rtl" }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const widths = useMemo(() => Array.from({ length: columns }, () => 96), [columns]);
  projection = useTabularViewport({
    rowCount: rows, columnWidths: widths,
    direction, hasHeader: false, hasRowNumbers: false, scrollRef, surfaceRef,
  });
  return <div ref={scrollRef}><div ref={surfaceRef} /></div>;
}
