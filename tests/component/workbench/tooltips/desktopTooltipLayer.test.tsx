/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tooltip, disableTooltipHints } from "../../../../packages/shared-ui/src/primitives/Tooltip";
import { DesktopTooltipLayer } from "../../../../src/components/DesktopTooltipLayer";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
  document.body.replaceChildren();
});

function mountTooltip(label = "New", shortcut?: string, overflowOnly = false, trigger: "hover" | "hover-focus" = "hover-focus") {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<>
    <Tooltip content={label} shortcut={shortcut} overflowOnly={overflowOnly} trigger={trigger}>
      <button aria-label={label}>+</button>
    </Tooltip>
    <DesktopTooltipLayer />
  </>));
  return host.querySelector<HTMLButtonElement>("button")!;
}

describe("DesktopTooltipLayer", () => {
  it("shows hover-only hints after a delay and hides them on leave even while their menu item is focused", () => {
    vi.useFakeTimers();
    const button = mountTooltip("Insert row", undefined, false, "hover");
    act(() => button.focus());
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    act(() => button.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
    act(() => vi.advanceTimersByTime(449));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Insert row");
    act(() => button.dispatchEvent(new MouseEvent("pointerout", { bubbles: true, relatedTarget: document.body })));
    expect(document.activeElement).toBe(button);
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(button.getAttribute("aria-label")).toBe("Insert row");
  });

  it("removes a stale tooltip and its description when the trigger is unmounted", async () => {
    const button = mountTooltip();
    button.setAttribute("aria-describedby", "existing-help");
    act(() => button.focus());
    expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
    await act(async () => {
      root?.render(<><span>Closed menu</span><DesktopTooltipLayer /></>);
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(button.getAttribute("aria-describedby")).toBe("existing-help");
  });

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

  it("does not show hover or focus hints in a disabled editor scope", async () => {
    vi.useFakeTimers();
    const button = mountTooltip("Editor command");
    button.setAttribute("aria-describedby", "existing-help");
    disableTooltipHints(button.parentElement!);

    act(() => button.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
    act(() => vi.advanceTimersByTime(900));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    act(() => button.focus());
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    expect(button.getAttribute("aria-label")).toBe("Editor command");
    expect(button.getAttribute("aria-describedby")).toBe("existing-help");

    const outsideHost = document.createElement("div");
    document.body.append(outsideHost);
    const outsideRoot = createRoot(outsideHost);
    try {
      act(() => outsideRoot.render(<Tooltip content="Shell command"><button>Shell</button></Tooltip>));
      act(() => outsideHost.querySelector<HTMLButtonElement>("button")!.focus());
      expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Shell command");
    } finally {
      await act(async () => {
        outsideRoot.unmount();
        await vi.advanceTimersByTimeAsync(0);
      });
    }
  });

  it("rechecks suppression before a delayed hover hint opens", () => {
    vi.useFakeTimers();
    const button = mountTooltip();
    act(() => button.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
    disableTooltipHints(button.parentElement!);
    act(() => vi.advanceTimersByTime(450));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("suppresses hints in a document-level menu independently of its editor", () => {
    vi.useFakeTimers();
    const button = mountTooltip("Menu command");
    const menu = button.parentElement!;
    menu.setAttribute("role", "menu");
    disableTooltipHints(menu);
    act(() => button.focus());
    act(() => button.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })));
    act(() => vi.advanceTimersByTime(900));
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("uses the themed overlay root for the selected typography scale", () => {
    const overlayRoot = document.createElement("div");
    overlayRoot.id = "desktop-overlay-root";
    document.body.append(overlayRoot);
    const button = mountTooltip();

    act(() => button.focus());
    expect(overlayRoot.querySelector('[role="tooltip"]')?.textContent).toBe("New");
  });

  it("only shows overflow hints when their visible value is clipped", () => {
    const button = mountTooltip("Full project path", undefined, true);
    let scrollWidth = 80;
    Object.defineProperties(button, {
      clientWidth: { configurable: true, value: 120 },
      scrollWidth: { configurable: true, get: () => scrollWidth },
    });

    act(() => button.focus());
    expect(document.querySelector('[role="tooltip"]')).toBeNull();

    act(() => button.blur());
    scrollWidth = 180;
    act(() => button.focus());
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Full project path");
  });
});
