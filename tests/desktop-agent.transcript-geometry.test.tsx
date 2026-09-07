/** @vitest-environment happy-dom */
import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTranscriptViewport } from "../src/features/desktop-agent/ui/transcript/useTranscriptViewport";
import type { AgentViewportGeometry } from "../src/features/desktop-agent/domain/agent-ui-state";
import type { TimelineRow } from "../src/features/desktop-agent/domain/agent-projection-types";

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
