/** @vitest-environment happy-dom */
import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTranscriptViewport } from "../../../../src/features/desktop-agent/ui/transcript/useTranscriptViewport";
import type { AgentViewportGeometry } from "../../../../src/features/desktop-agent/domain/agent-ui-state";
import type { TimelineRow } from "../../../../src/features/desktop-agent/domain/agent-projection-types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
const originalObserver = globalThis.ResizeObserver;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); globalThis.ResizeObserver = originalObserver; });
const rows: TimelineRow[] = [{ id: "one", partId: "one", kind: "assistant", turnId: null, sequence: 1, estimatedHeight: 40 }];

function Harness({ width, geometry, onChange }: { width: number; geometry?: AgentViewportGeometry; onChange: ReturnType<typeof vi.fn> }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewport = useTranscriptViewport({ rows, scrollRef, initialScrollTop: 0, initialPinned: false,
    initialMeasurements: { one: 90 }, initialGeometry: geometry, onViewportChange: onChange });
  return <div ref={element => {
    (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = element;
    if (element) {
      Object.defineProperties(element, { clientWidth: { configurable: true, value: width },
        clientHeight: { configurable: true, value: 200 }, scrollHeight: { configurable: true, value: 1000 } });
    }
  }}><div ref={viewport.canvasRef} /></div>;
}
function render(width: number, onChange: ReturnType<typeof vi.fn>, geometry?: AgentViewportGeometry) {
  const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  act(() => root?.render(<Harness width={width} geometry={geometry} onChange={onChange} />));
}

describe("Transcript geometry lifetime", () => {
  it("rejects cached sizes from another width or unknown provenance", () => {
    const onChange = vi.fn();
    render(420, onChange, { layoutSignature: "560|different-font", anchor: null });
    expect(onChange.mock.lastCall?.[1]).toEqual({});
    expect(onChange.mock.lastCall?.[3].layoutSignature).toMatch(/^420\|/);
  });

  it("retains sizes while the hidden viewport cannot be measured", () => {
    const onChange = vi.fn();
    render(0, onChange, { layoutSignature: "420|known-font", anchor: null });
    expect(onChange.mock.lastCall?.[1]).toEqual({ one: 90 });
    expect(onChange.mock.lastCall?.[3].layoutSignature).toBe("420|known-font");
  });

  it("does not let a queued observer callback publish after unmount", () => {
    const callbacks: ResizeObserverCallback[] = [];
    const disconnect = vi.fn();
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) { callbacks.push(callback); }
      observe() {} unobserve() {} disconnect = disconnect;
    } as unknown as typeof ResizeObserver;
    const onChange = vi.fn();
    render(420, onChange);
    act(() => root?.unmount()); root = null;
    onChange.mockClear();
    act(() => callbacks.forEach(callback => callback([], {} as ResizeObserver)));
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });
});

function scrollingHarness() {
  const onChange = vi.fn();
  const geometry = { height: 2000, top: 0, writes: 0 };
  let history = Array.from({ length: 50 }, (_, index): TimelineRow => ({
    id: `row:${index}`, partId: `part:${index}`, kind: "assistant", turnId: null, sequence: index, estimatedHeight: 40,
  }));
  function Scroller({ revision }: { revision: number }) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const viewport = useTranscriptViewport({ rows: history, scrollRef, initialScrollTop: 0,
      initialPinned: true, initialMeasurements: {}, onViewportChange: onChange });
    return <div data-revision={revision}>
      <div data-scroller data-pinned={viewport.pinned} onScroll={viewport.handleScroll} ref={element => {
        (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = element;
        if (element) Object.defineProperties(element, {
          clientWidth: { configurable: true, value: 420 }, clientHeight: { configurable: true, value: 200 },
          scrollHeight: { configurable: true, get: () => geometry.height },
          scrollTop: { configurable: true, get: () => geometry.top, set: (value: number) => {
            geometry.writes++; geometry.top = Math.max(0, Math.min(value, geometry.height - 200));
          } },
        });
      }}><div ref={viewport.canvasRef}>{history.slice(viewport.range.start, viewport.range.end).map(row =>
        <div key={row.id} data-visible-row={row.id} />)}</div></div>
      <button onClick={viewport.jumpToLatest}>Latest</button>
    </div>;
  }
  const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  let revision = 0;
  const refresh = () => act(() => root?.render(<Scroller revision={++revision} />));
  refresh();
  const element = host.querySelector<HTMLDivElement>("[data-scroller]")!;
  const scrollTo = (top: number) => act(() => {
    // Browser/user scroll, rather than a write made by the viewport controller.
    geometry.top = top;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  const reflow = () => {
    history = history.map(row => ({ ...row, estimatedHeight: 160 }));
    geometry.height = 8400;
    refresh();
  };
  return { geometry, element, refresh, reflow, scrollTo, latest: () => act(() => host.querySelector("button")!.click()), onChange };
}

describe("Transcript scrolling intent", () => {
  it.each([1, 10, 79])("releases following after an upward scroll of %s pixels", delta => {
    const { geometry, element, refresh, scrollTo } = scrollingHarness();
    const target = geometry.top - delta;
    scrollTo(target);
    expect(element.dataset.pinned).toBe("false");
    expect(geometry.top).toBe(target);
    refresh();
    expect(geometry.top).toBe(target);
    geometry.height += 100;
    refresh();
    expect(geometry.top).toBe(target);
  });

  it("reattaches only on reaching the bottom or explicitly choosing Latest", () => {
    const { geometry, element, refresh, scrollTo, latest } = scrollingHarness();
    scrollTo(1700);
    scrollTo(1780);
    expect(element.dataset.pinned).toBe("false");
    expect(geometry.top).toBe(1780);
    scrollTo(1800);
    expect(element.dataset.pinned).toBe("true");
    geometry.height += 100;
    refresh();
    expect(geometry.top).toBe(1900);
    scrollTo(1890);
    latest();
    expect(geometry.top).toBe(1900);
    expect(element.dataset.pinned).toBe("true");
  });

  it("does not rewrite scrollTop when already at the clamped bottom", () => {
    const { geometry, refresh } = scrollingHarness();
    const writes = geometry.writes;
    refresh(); refresh();
    expect(geometry.writes).toBe(writes);
  });

  it("keeps the visible row mounted while reflow changes its pixel offset", () => {
    const { element, scrollTo, reflow, onChange } = scrollingHarness();
    scrollTo(1780);
    const anchor = onChange.mock.lastCall?.[3].anchor;
    expect(anchor.kind).toBe("row");
    const selector = `[data-visible-row="${anchor.rowId}"]`;
    const row = element.querySelector(selector);
    expect(row).not.toBeNull();
    reflow();
    expect(element.querySelector(selector)).toBe(row);
    expect(onChange.mock.lastCall?.[3].anchor).toEqual(anchor);
  });
});
