/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsDialog, type SettingsDialogProps } from "../../../../src/features/settings/SettingsDialog";
import { renderWithTestLocalization } from "../../../support/react/localization";

vi.mock("../../../../src/features/settings/SettingsWorkspaceSurface", () => ({
  createSettingsWorkspaceSurface: () => ({
    sidebar: <div data-testid="settings-navigation">Navigation</div>,
    main: <div data-testid="settings-content">Content</div>,
  }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("SettingsDialog", () => {
  it("hosts Settings in a dismissible, two-column dialog", () => {
    const host = document.createElement("div");
    const onClose = vi.fn();
    document.body.append(host);
    root = createRoot(host);

    act(() => renderWithTestLocalization(root,
      <SettingsDialog {...({ onClose } as unknown as SettingsDialogProps)} />,
    ));

    const dialog = host.querySelector<HTMLElement>(".desktop-settings-dialog");
    expect(dialog?.getAttribute("role")).toBe("dialog");
    expect(dialog?.getAttribute("aria-label")).toBe("Settings");
    expect(dialog?.querySelector("[data-testid='settings-navigation']")?.textContent)
      .toBe("Navigation");
    expect(dialog?.querySelector("[data-testid='settings-content']")?.textContent)
      .toBe("Content");
    expect(dialog?.querySelector(".desktop-settings-dialog-layout")).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
