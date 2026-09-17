/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ViewerPackSnapshot } from "@puppyone/shared-ui";
import { PluginsDialog } from "../../../../src/features/plugins/PluginsDialog";
import { renderWithTestLocalization } from "../../../support/react/localization";

vi.mock("../../../../src/features/plugins/PluginsSidebar", () => ({
  DEFAULT_PLUGINS_SECTION: "installed",
  PluginsSidebar: () => <div data-testid="plugins-navigation">Navigation</div>,
}));

vi.mock("../../../../src/features/plugins/PluginsView", () => ({
  PluginsView: () => <div data-testid="plugins-content">Content</div>,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("PluginsDialog", () => {
  it("hosts Plugins in a dismissible two-column application dialog", async () => {
    const host = document.createElement("div");
    const onClose = vi.fn();
    document.body.append(host);
    root = createRoot(host);

    await act(async () => renderWithTestLocalization(root,
      <PluginsDialog
        hostAvailable
        snapshot={{ contributions: [] } as unknown as ViewerPackSnapshot}
        onRefresh={vi.fn()}
        onClose={onClose}
      />,
    ));

    const dialog = document.querySelector<HTMLElement>(".desktop-plugins-dialog");
    expect(dialog?.getAttribute("role")).toBe("dialog");
    expect(dialog?.getAttribute("aria-label")).toBe("Plugins");
    expect(dialog?.querySelector("[data-testid='plugins-navigation']")?.textContent)
      .toBe("Navigation");
    expect(dialog?.querySelector("[data-testid='plugins-content']")?.textContent)
      .toBe("Content");
    expect(dialog?.querySelector(".desktop-plugins-dialog-layout")).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
