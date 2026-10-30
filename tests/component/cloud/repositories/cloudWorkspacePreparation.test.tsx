/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudProjectOpeningSurface } from "../../../../src/app/CloudProjectOpeningSurface";
import { createCloudWorkspaceOpeningProgress } from "../../../../src/features/cloud/files/cloudWorkspaceOpening";
import { CloudWorkspaceOpeningLoading } from "../../../../src/features/cloud/workbench/CloudWorkspaceOpeningLoading";
import { renderWithTestLocalization } from "../../../support/react/localization";
import { createTestSurfaceAppearance } from "../../../support/react/surfaceAppearance";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
const appearance = createTestSurfaceAppearance();
const button = () => container.querySelector<HTMLButtonElement>(".desktop-cloud-opening button");

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("Cloud project opening", () => {
  it("states only the stage, however long the open takes", () => {
    const progress = createCloudWorkspaceOpeningProgress();
    act(() => renderWithTestLocalization(root, <CloudWorkspaceOpeningLoading progress={progress} />));
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toBe("Waking up…");
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(status?.textContent).toBe("Waking up…");
    act(() => progress.set("files"));
    expect(status?.textContent).toBe("Taking out your files…");
  });

  it("opens inside the project's window with the file tree waiting, and cancels", () => {
    const onCancel = vi.fn();
    act(() => renderWithTestLocalization(root, <CloudProjectOpeningSurface projectName="Launch plan"
      appearance={appearance} onCancel={onCancel} />));
    expect(container.querySelector(".desktop-account-cloud-workspace")).not.toBeNull();
    expect(container.querySelector(".desktop-titlebar")?.textContent).toContain("Launch plan");
    expect(container.querySelector('.desktop-cloud-preparation [data-file-workbench="true"] .data-explorer-pane')).not.toBeNull();
    expect(container.querySelector(".onboarding-project-loading")).toBeNull();
    const surface = container.querySelector<HTMLElement>(".desktop-cloud-preparation");
    expect(document.activeElement).toBe(surface);
    act(() => button()?.click());
    expect(onCancel).toHaveBeenCalledOnce();
    act(() => { surface?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
