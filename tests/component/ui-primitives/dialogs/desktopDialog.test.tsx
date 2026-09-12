/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopDialogRoot, DesktopDialogSurface } from "../../../../src/components/DesktopDialog";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
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
