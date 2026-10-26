/**
 * @vitest-environment happy-dom
 */
import React, { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useExplorerVirtualWindow } from "../../../../packages/shared-ui/src/data/explorer/useExplorerVirtualWindow";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function Harness({ activeIndex }: { activeIndex: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualWindow = useExplorerVirtualWindow({ rowCount: 200, scrollRef, activeIndex });
  return <div ref={scrollRef} data-testid="scroll" data-row-size={virtualWindow.rowSize} />;
}

function revealRow(activeIndex: number, scrollPadding: { start?: string; end?: string }) {
  const getComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
    const style = getComputedStyle(element, pseudo);
    if (!(element instanceof HTMLElement) || element.dataset.testid !== "scroll") return style;
    return new Proxy(style, {
      get(target, property) {
        if (property === "scrollPaddingBlockStart") return scrollPadding.start ?? "auto";
        if (property === "scrollPaddingBlockEnd") return scrollPadding.end ?? "auto";
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(<Harness activeIndex={activeIndex} />));
  const scroll = container.querySelector<HTMLElement>("[data-testid=scroll]")!;
  return { scrollTop: scroll.scrollTop, rowSize: Number(scroll.dataset.rowSize) };
}

describe("Explorer keyboard reveal", () => {
  // happy-dom has no layout, so the window uses its 640px fallback viewport.
  const viewportHeight = 640;

  it("keeps the revealed row clear of a pinned bottom band via scroll-padding", () => {
    const plain = revealRow(60, {});
    expect(plain.scrollTop).toBe(61 * plain.rowSize - viewportHeight);
    act(() => root?.unmount());
    vi.restoreAllMocks();

    const padded = revealRow(60, { end: "42px" });
    expect(padded.scrollTop).toBe(61 * padded.rowSize - viewportHeight + 42);
  });

  it("treats auto scroll-padding as no inset", () => {
    const { scrollTop, rowSize } = revealRow(60, { start: "auto", end: "auto" });
    expect(scrollTop).toBe(61 * rowSize - viewportHeight);
  });
});
