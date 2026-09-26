/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopTooltipLayer } from "../../../../src/components/DesktopTooltipLayer";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
  document.body.replaceChildren();
});

function mountTooltip(label = "New", shortcut?: string) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<><button aria-label={label} data-tooltip={label} data-tooltip-shortcut={shortcut}>+</button><DesktopTooltipLayer /></>));
  return host.querySelector<HTMLButtonElement>("button")!;
}

describe("DesktopTooltipLayer", () => {
  it("waits for hover and shows the label and optional shortcut", () => {
    vi.useFakeTimers();
    const button = mountTooltip("Search", "⌘K");

    act(() => button.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    act(() => vi.advanceTimersByTime(450));
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Search⌘K");
    expect(button.getAttribute("aria-describedby")).toBeTruthy();

    act(() => button.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body })));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("opens on keyboard focus and dismisses on Escape", () => {
    const button = mountTooltip();
    act(() => button.focus());
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("New");

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" })));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(button.hasAttribute("aria-describedby")).toBe(false);
  });

  it("does not reopen immediately when a pointer press focuses the trigger", () => {
    const button = mountTooltip();
    act(() => {
      button.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      button.focus();
    });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });
});
