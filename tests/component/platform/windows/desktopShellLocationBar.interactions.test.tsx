/**
 * @vitest-environment happy-dom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopShellLocationBar } from "../../../../src/features/app-shell/DesktopShellLocationBar";
import { renderWithTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("DesktopShellLocationBar interactions", () => {
  it("submits an edited address from the clickable Go button", () => {
    const container = document.createElement("div");
    const onNavigate = vi.fn();
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => renderWithTestLocalization(root,
      <DesktopShellLocationBar
        path="C:\\PuppyOne"
        onNavigate={onNavigate}
      />,
    ));

    const input = container.querySelector<HTMLInputElement>(".desktop-shell-location-bar-value")!;
    const go = container.querySelector<HTMLButtonElement>(".desktop-shell-location-bar-go")!;
    expect(go.tagName).toBe("BUTTON");
    expect(input.readOnly).toBe(false);

    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(input, "C:\\PuppyOne\\document");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => go.click());

    expect(onNavigate).toHaveBeenCalledWith("C:\\PuppyOne\\document");
  });
});
