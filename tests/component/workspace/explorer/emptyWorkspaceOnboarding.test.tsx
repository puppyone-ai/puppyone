/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EmptyWorkspaceOnboardingDialog,
  FIRST_PROJECT_STARTER_STORAGE_KEY,
  markFirstProjectStarterCompleted,
  readFirstProjectStarterCompleted,
  resolveEmptyWorkspaceStarterSelection,
  resolveWorkspaceRootOnboardingStatus,
  shouldShowFirstProjectStarter,
} from "../../../../src/features/app-shell/EmptyWorkspaceOnboardingDialog";
import { testT, withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  window.localStorage.clear();
});

describe("first project starting point", () => {
  it("classifies the workspace root only after loading succeeds", () => {
    expect(resolveWorkspaceRootOnboardingStatus({
      rootLoading: true,
      loadError: null,
      rootEntryCount: 0,
    })).toBe("loading");
    expect(resolveWorkspaceRootOnboardingStatus({
      rootLoading: false,
      loadError: "Permission denied",
      rootEntryCount: 0,
    })).toBe("unavailable");
    expect(resolveWorkspaceRootOnboardingStatus({
      rootLoading: false,
      loadError: null,
      rootEntryCount: 1,
    })).toBe("ready");
    expect(resolveWorkspaceRootOnboardingStatus({
      rootLoading: false,
      loadError: null,
      rootEntryCount: 0,
    })).toBe("empty");
  });

  it("shows only for the first eligible locally-created empty project", () => {
    expect(shouldShowFirstProjectStarter({
      eligible: true,
      completed: false,
      workspaceStatus: "empty",
    })).toBe(true);
    expect(shouldShowFirstProjectStarter({
      eligible: false,
      completed: false,
      workspaceStatus: "empty",
    })).toBe(false);
    expect(shouldShowFirstProjectStarter({
      eligible: true,
      completed: true,
      workspaceStatus: "empty",
    })).toBe(false);
    expect(shouldShowFirstProjectStarter({
      eligible: true,
      completed: false,
      workspaceStatus: "ready",
    })).toBe(false);
  });

  it("persists completion independently from a workspace path", () => {
    expect(readFirstProjectStarterCompleted()).toBe(false);
    markFirstProjectStarterCompleted();
    expect(window.localStorage.getItem(FIRST_PROJECT_STARTER_STORAGE_KEY)).toBe("completed");
    expect(readFirstProjectStarterCompleted()).toBe(true);
  });

  it("resolves blank and the three starter files without multi-file side effects", () => {
    expect(resolveEmptyWorkspaceStarterSelection("blank", testT)).toEqual({
      id: "blank",
      file: null,
    });
    expect(resolveEmptyWorkspaceStarterSelection("get-started", testT)).toEqual({
      id: "get-started",
      file: expect.objectContaining({
        path: "Getting Started.md",
        content: expect.stringContaining("# Getting started with Puppyone"),
      }),
    });
    expect(resolveEmptyWorkspaceStarterSelection("notes", testT)).toEqual({
      id: "notes",
      file: { path: "Notes.md", content: "# Notes\n\n" },
    });
    expect(resolveEmptyWorkspaceStarterSelection("data", testT)).toEqual({
      id: "data",
      file: {
        path: "Data.csv",
        content: "Column 1,Column 2,Column 3\n,,\n,,\n",
      },
    });
  });

  it("uses the global layer and requires a selected starting point", async () => {
    const onConfirm = vi.fn(async () => undefined);
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(withTestLocalization(
      <EmptyWorkspaceOnboardingDialog onConfirm={onConfirm} />,
    )));

    const overlayRoot = document.querySelector<HTMLElement>("#desktop-overlay-root");
    const dialog = overlayRoot?.querySelector<HTMLElement>(".empty-workspace-starter-dialog");
    expect(dialog).not.toBeNull();
    expect(dialog?.closest("#desktop-overlay-root")).toBe(overlayRoot);
    expect(container.querySelector(".desktop-dialog-surface")).toBeNull();
    expect(dialog?.textContent).toContain("Choose a starting point");
    expect(dialog?.textContent).toContain("Blank");
    expect(dialog?.textContent).toContain("Get started");
    expect(dialog?.textContent).toContain("Notes");
    expect(dialog?.textContent).toContain("Data table");
    expect(dialog?.textContent).not.toContain("This project is empty");
    expect(dialog?.textContent).not.toContain("New file");
    expect(dialog?.querySelector('[aria-label="Close"]')).toBeNull();

    const radios = Array.from(dialog?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? []);
    const continueButton = dialog?.querySelector<HTMLButtonElement>(".desktop-dialog-footer button");
    expect(radios.map((radio) => radio.value)).toEqual(["blank", "get-started", "notes", "data"]);
    expect(continueButton?.disabled).toBe(true);

    const backdrop = overlayRoot?.querySelector<HTMLElement>(".desktop-dialog-backdrop");
    act(() => {
      backdrop?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      backdrop?.click();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onConfirm).not.toHaveBeenCalled();

    act(() => radios[1]?.click());
    expect(continueButton?.disabled).toBe(false);
    await act(async () => {
      continueButton?.click();
      await Promise.resolve();
    });
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      id: "get-started",
      file: expect.objectContaining({ path: "Getting Started.md" }),
    }));
  });
});
