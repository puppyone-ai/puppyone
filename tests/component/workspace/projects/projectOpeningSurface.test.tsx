/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectOpeningSurface } from "../../../../src/app/ProjectOpeningSurface";
import { createCloudWorkspaceOpeningProgress } from "../../../../src/features/cloud/files/cloudWorkspaceOpening";
import { CloudWorkspaceOpeningLoading } from "../../../../src/features/cloud/workbench/CloudWorkspaceOpeningLoading";
import { renderWithTestLocalization } from "../../../support/react/localization";
import { createTestSurfaceAppearance } from "../../../support/react/surfaceAppearance";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLElement;
const appearance = createTestSurfaceAppearance();
const button = () => container.querySelector<HTMLButtonElement>(".desktop-project-opening button");
const surface = () => container.querySelector<HTMLElement>(".desktop-project-preparation");

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
  it("states the stage in one line, however long the open takes", () => {
    const progress = createCloudWorkspaceOpeningProgress();
    act(() => renderWithTestLocalization(root, <CloudWorkspaceOpeningLoading progress={progress} />));
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toBe("Starting workspace…");
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(status?.textContent).toBe("Starting workspace…");
    act(() => progress.set("files"));
    expect(status?.textContent).toBe("Preparing files…");
    expect(container.querySelectorAll(".desktop-project-opening p")).toHaveLength(1);
  });

  it("opens inside the project's window with the file tree waiting, and cancels", () => {
    const onCancel = vi.fn();
    act(() => renderWithTestLocalization(root, <ProjectOpeningSurface location="cloud" projectName="Launch plan"
      appearance={appearance} onCancel={onCancel} />));
    expect(container.querySelector(".desktop-account-cloud-workspace")).not.toBeNull();
    expect(container.querySelector(".desktop-titlebar")?.textContent).toContain("Launch plan");
    expect(container.querySelector('.desktop-project-preparation [data-file-workbench="true"] .data-explorer-pane')).not.toBeNull();
    expect(document.activeElement).toBe(surface());
    act(() => button()?.click());
    expect(onCancel).toHaveBeenCalledOnce();
    act(() => { surface()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("hangs what it says below the mark, so words never move the mark", () => {
    act(() => renderWithTestLocalization(root, <ProjectOpeningSurface location="cloud" projectName="Launch plan"
      appearance={appearance} onCancel={vi.fn()} />));
    const opening = container.querySelector(".desktop-project-opening");
    expect(opening?.querySelector(":scope > [data-loading-layout]")).not.toBeNull();
    expect(opening?.querySelector(":scope > p")).toBeNull();
    expect(opening?.querySelector(":scope > button")).toBeNull();
    expect(opening?.querySelector(".desktop-project-opening-detail p")?.textContent).toBe("Starting workspace…");
    expect(opening?.querySelector(".desktop-project-opening-detail button")?.textContent).toBe("Cancel");
  });
});

describe("Local project opening", () => {
  it("waits in the same window as a Cloud project, with one mark and nothing to read or cancel", () => {
    act(() => renderWithTestLocalization(root, <ProjectOpeningSurface location="local" projectName="Notes" appearance={appearance} />));
    expect(container.querySelector(".desktop-titlebar-workspace-name")?.textContent).toBe("Notes");
    expect(container.querySelector(".desktop-titlebar")?.getAttribute("data-workspace-kind")).toBeNull();
    expect(container.querySelector(".desktop-account-cloud-workspace")).toBeNull();
    expect(container.querySelector('.desktop-project-preparation [data-file-workbench="true"] .data-explorer-pane')).not.toBeNull();
    const opening = container.querySelector(".desktop-project-opening");
    expect(opening?.getAttribute("aria-label")).toBe("Loading project");
    expect(opening?.textContent).toBe("");
    expect(opening?.querySelector(".desktop-project-opening-detail")).toBeNull();
    expect(button()).toBeNull();
    expect(opening?.getAttribute("role")).toBe("status");
  });

  it("ignores Escape, because a local open cannot be abandoned", () => {
    act(() => renderWithTestLocalization(root, <ProjectOpeningSurface location="local" projectName="Notes" appearance={appearance} />));
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => { surface()?.dispatchEvent(escape); });
    expect(escape.defaultPrevented).toBe(false);
    expect(surface()).not.toBeNull();
  });

  it("names the project in the Header's usual place, not as a control", () => {
    act(() => renderWithTestLocalization(root, <ProjectOpeningSurface location="local" projectName="Notes" appearance={appearance} />));
    const name = container.querySelector(".desktop-titlebar-context .desktop-titlebar-workspace-wrap .desktop-titlebar-workspace-button");
    expect(name?.tagName).toBe("SPAN");
    expect(name?.querySelector(".desktop-titlebar-workspace-mark")).not.toBeNull();
  });

  it("returns focus to the entry that opened the project when the open ends without one", async () => {
    const entry = document.createElement("button");
    document.body.appendChild(entry);
    entry.focus();
    act(() => renderWithTestLocalization(root, <ProjectOpeningSurface location="local" projectName="Notes" appearance={appearance} />));
    expect(document.activeElement).toBe(surface());
    act(() => renderWithTestLocalization(root, null));
    await act(async () => { await Promise.resolve(); });
    expect(document.activeElement).toBe(entry);
  });
});
