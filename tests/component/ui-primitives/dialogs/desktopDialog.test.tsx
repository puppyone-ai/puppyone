/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopDialogRoot, DesktopDialogSurface } from "../../../../src/components/DesktopDialog";
import { holdInert } from "../../../../src/lib/inertHold";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  window.dispatchEvent(new Event("pointermove"));
});

describe("DesktopDialog", () => {
  it("moves focus inside, traps Tab, closes on Escape, and restores focus", () => {
    const opener = document.createElement("button");
    opener.textContent = "Open";
    document.body.appendChild(opener);
    opener.focus();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const onClose = vi.fn();
    root = createRoot(container);

    act(() => root?.render(
      <DesktopDialogRoot onClose={onClose}>
        <DesktopDialogSurface>
          <button type="button">First</button>
          <button type="button">Last</button>
        </DesktopDialogSurface>
      </DesktopDialogRoot>,
    ));

    const surface = container.querySelector<HTMLElement>("[role='dialog']");
    const buttons = container.querySelectorAll<HTMLButtonElement>("button");
    expect(document.activeElement).toBe(surface);

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    expect(document.activeElement).toBe(buttons[0]);
    buttons[1].focus();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    expect(document.activeElement).toBe(buttons[0]);
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })));
    expect(document.activeElement).toBe(buttons[1]);

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => root?.unmount());
    root = null;
    expect(document.activeElement).toBe(opener);
  });

  it("keeps focus in the dialog when the focused control is disabled", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const dialog = (disabled: boolean) => (
      <DesktopDialogRoot>
        <form role="dialog" aria-label="Create">
          <input data-desktop-dialog-initial-focus="true" disabled={disabled} />
        </form>
      </DesktopDialogRoot>
    );
    act(() => root?.render(dialog(false)));
    const surface = document.querySelector<HTMLElement>("[role='dialog']");
    expect(document.activeElement?.tagName).toBe("INPUT");

    await act(async () => {
      root?.render(dialog(true));
      await Promise.resolve();
    });

    expect(surface?.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(surface);
  });

  it("makes the page inert while open, and gives it back before restoring focus", () => {
    const page = document.createElement("button");
    const overlay = document.createElement("div");
    overlay.setAttribute("data-po-overlay-root", "true");
    const container = document.createElement("div");
    document.body.append(page, overlay, container);
    page.focus();
    root = createRoot(container);

    act(() => root?.render(
      <DesktopDialogRoot><DesktopDialogSurface ariaLabel="Dialog" /></DesktopDialogRoot>,
    ));
    expect(page.hasAttribute("inert")).toBe(true);
    expect(overlay.hasAttribute("inert")).toBe(false);

    act(() => root?.render(null));
    expect(page.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(page);
  });

  it("wakes the page only when the last stacked dialog has closed", () => {
    const page = document.createElement("div");
    const container = document.createElement("div");
    document.body.append(page, container);
    root = createRoot(container);
    const dialogs = (second: boolean) => (
      <>
        <DesktopDialogRoot><DesktopDialogSurface ariaLabel="First" /></DesktopDialogRoot>
        {second && <DesktopDialogRoot><DesktopDialogSurface ariaLabel="Second" /></DesktopDialogRoot>}
      </>
    );

    act(() => root?.render(dialogs(true)));
    const [first, second] = document.querySelectorAll("[data-desktop-dialog-root='true']");
    expect(first?.hasAttribute("inert")).toBe(true);
    expect(second?.hasAttribute("inert")).toBe(false);

    act(() => root?.render(dialogs(false)));
    expect(first?.hasAttribute("inert")).toBe(false);
    expect(page.hasAttribute("inert")).toBe(true);

    act(() => root?.render(null));
    expect(page.hasAttribute("inert")).toBe(false);
  });

  it("leaves an element inert by its own markup as it found it", () => {
    const element = document.createElement("div");
    element.setAttribute("inert", "");
    holdInert(element)();
    expect(element.hasAttribute("inert")).toBe(true);
  });

  it("holds hover from closing until the pointer is used again", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<DesktopDialogRoot><DesktopDialogSurface ariaLabel="Dialog" /></DesktopDialogRoot>));
    expect(document.documentElement.hasAttribute("data-pointer-resting")).toBe(false);

    act(() => root?.render(null));
    expect(document.documentElement.hasAttribute("data-pointer-resting")).toBe(true);

    window.dispatchEvent(new Event("pointermove"));
    expect(document.documentElement.hasAttribute("data-pointer-resting")).toBe(false);
  });

  it("requires an in-dialog action when the dismissal policy is action-required", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const onClose = vi.fn();
    root = createRoot(container);

    act(() => root?.render(
      <DesktopDialogRoot
        dismissalPolicy="action-required"
        onClose={onClose}
      >
        <DesktopDialogSurface>
          <button type="button" onClick={onClose}>Continue</button>
        </DesktopDialogSurface>
      </DesktopDialogRoot>,
    ));

    const backdrop = container.querySelector<HTMLElement>(".desktop-dialog-backdrop");
    act(() => {
      backdrop?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      backdrop?.click();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    const action = container.querySelector<HTMLButtonElement>("button");
    act(() => action?.click());
    expect(onClose).toHaveBeenCalledOnce();
  });
});
