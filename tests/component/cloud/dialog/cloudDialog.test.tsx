/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopProjectLocationControls } from "../../../../src/components/DesktopProjectLocationSwitcher";
import { CloudDialog } from "../../../../src/features/cloud/CloudDialog";
import { renderWithTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("CloudDialog", () => {
  it("keeps Puppyone Cloud navigation and content in the shared dismissible overlay", () => {
    const host = document.createElement("div");
    const onClose = vi.fn();
    document.body.append(host);
    root = createRoot(host);

    act(() => renderWithTestLocalization(root,
      <CloudDialog
        sidebar={<div data-testid="cloud-navigation">Navigation</div>}
        main={<div data-testid="cloud-content">Content</div>}
        onClose={onClose}
      />,
    ));

    const overlayRoot = document.querySelector<HTMLElement>("#desktop-overlay-root");
    const dialog = overlayRoot?.querySelector<HTMLElement>(".desktop-cloud-dialog");
    expect(dialog?.getAttribute("role")).toBe("dialog");
    expect(dialog?.getAttribute("aria-label")).toBe("Puppyone Cloud");
    expect(dialog?.querySelector(".desktop-cloud-icon[data-cloud-icon=ant-design]")).not.toBeNull();
    expect(host.querySelector(".desktop-cloud-dialog")).toBeNull();
    expect(dialog?.querySelector("[data-testid='cloud-navigation']")?.textContent)
      .toBe("Navigation");
    expect(dialog?.querySelector("[data-testid='cloud-content']")?.textContent)
      .toBe("Content");

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("shows only location controls inside Cloud and lets Local dismiss the dialog", () => {
    const host = document.createElement("div");
    const onClose = vi.fn();
    const onViewCloud = vi.fn();
    document.body.append(host);
    root = createRoot(host);
    act(() => renderWithTestLocalization(root,
      <CloudDialog sidebar={<nav>Navigation</nav>} main={<div>Cloud contents</div>} onClose={onClose}
        locationControls={<DesktopProjectLocationControls
          projectLocation={{ current: "cloud", localAvailable: true, cloudState: "available" }}
          onViewLocal={onClose} onViewCloud={onViewCloud} />} />,
    ));
    const dialog = document.querySelector(".desktop-cloud-dialog")!;
    expect(dialog.querySelector(".desktop-project-repository-link")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(onViewCloud).not.toHaveBeenCalled();
    act(() => dialog.querySelector<HTMLButtonElement>("button[data-project-location='cloud']")!.click());
    expect(onClose).not.toHaveBeenCalled();
    expect(onViewCloud).not.toHaveBeenCalled();
    act(() => dialog.querySelector<HTMLButtonElement>("button[data-project-location='local']")!.click());
    expect(onClose).toHaveBeenCalledOnce();
  });

});
