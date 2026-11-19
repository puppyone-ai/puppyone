/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudPublishDialog } from "../../../../src/features/cloud/initialization/CloudPublishDialog";
import { renderWithTestLocalization } from "../../../support/react/localization";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); });
function render() {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const onClose = vi.fn();
  act(() => renderWithTestLocalization(root!, <CloudPublishDialog onClose={onClose}><div data-publish-content="">Progress</div></CloudPublishDialog>));
  return { host, onClose, dialog: document.querySelector<HTMLElement>(".desktop-cloud-publish-dialog")! };
}
describe("single-task Cloud publish dialog", () => {
  it("uses the shared overlay without mounting services navigation", () => {
    const { host, dialog } = render();
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-label")).toBe("Put in the Cloud");
    expect(dialog.querySelector("[data-publish-content]")?.textContent).toBe("Progress");
    expect(dialog.querySelector("aside, nav, .desktop-cloud-dialog-layout, .desktop-cloud-dialog-navigation")).toBeNull();
    expect(host.querySelector("[role=dialog]")).toBeNull();
    expect(document.querySelector("#desktop-overlay-root")?.contains(dialog)).toBe(true);
  });
  it("dismisses with Escape without cancelling the publish operation", () => {
    const { onClose } = render();
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("closes from its explicit Close control and never offers a provider switch", () => {
    const { dialog, onClose } = render();
    act(() => dialog.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click());
    expect(onClose).toHaveBeenCalledOnce();
    expect(dialog.querySelector("[data-project-location], .desktop-project-repository-link")).toBeNull();
  });
});
