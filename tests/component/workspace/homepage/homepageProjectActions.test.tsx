/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createDragEvent, createTextTransfer, createTransfer, notesProject, projectMenuItem, renderHome, requireSurface, setUpOnboardingHome } from "../../../support/react/onboardingHome";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
setUpOnboardingHome();

describe("a project's actions on the Homepage", () => {
  it("leaves the waiting to the project's window and blocks duplicate opens", async () => {
    let finishOpening: (() => void) | null = null;
    const onOpenWorkspacePath = vi.fn(() => new Promise<void>((resolve) => {
      finishOpening = resolve;
    }));
    const container = renderHome({
      onOpenWorkspacePath,
      projectItems: [{
        id: "notes",
        label: "Notes",
        localPath: "/Users/example/Desktop/Notes",
        lastOpenedAt: null,
      }],
    });
    const row = container.querySelector<HTMLButtonElement>(".onboarding-project-row");

    await act(async () => {
      row?.click();
      await Promise.resolve();
    });

    expect(row?.disabled).toBe(true);
    expect(container.querySelectorAll("[data-puppy-loader]")).toHaveLength(0);
    await act(async () => row?.click());
    expect(onOpenWorkspacePath).toHaveBeenCalledOnce();

    await act(async () => finishOpening?.());
    expect(row?.disabled).toBe(false);
  });

  it("shows folder-opening progress only inside the folder action", async () => {
    let finishOpening: (() => void) | null = null;
    const onChooseWorkspace = vi.fn(() => new Promise<void>((resolve) => {
      finishOpening = resolve;
    }));
    const container = renderHome({
      onChooseWorkspace,
      projectItems: [{
        id: "notes",
        label: "Notes",
        localPath: "/Users/example/Desktop/Notes",
        lastOpenedAt: null,
      }],
    });
    const more = container.querySelector<HTMLButtonElement>("[data-onboarding-action='more']");
    await act(async () => more?.click());

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>("[data-onboarding-action='open']")?.click();
      await Promise.resolve();
    });

    expect(more?.querySelectorAll("[data-puppy-loader]")).toHaveLength(1);
    expect(container.querySelector(".onboarding-operation-status")).toBeNull();
    expect(container.querySelector(".onboarding-project-row [data-puppy-loader]")).toBeNull();

    await act(async () => finishOpening?.());
  });

  it("unlinks one project from its menu, after confirming, without opening it", async () => {
    const onOpenWorkspacePath = vi.fn(async () => undefined);
    const onRemoveProject = vi.fn(async () => undefined);
    const container = renderHome({ onOpenWorkspacePath, onRemoveProject, projectItems: [notesProject] });
    const trigger = container.querySelector<HTMLButtonElement>(".onboarding-project-actions");

    expect(trigger?.getAttribute("aria-label")).toContain("Project actions for");
    expect(trigger?.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger?.dataset.tooltip).toBe("Project actions");
    await act(async () => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".onboarding-project-row-wrap")?.getAttribute("data-menu-open")).toBe("true");
    expect(onRemoveProject).not.toHaveBeenCalled();

    await act(async () => projectMenuItem("Unlink…")?.click());
    expect(document.body.querySelector(".desktop-project-row-dialog")?.textContent).toMatch(/Local files will stay on disk/);
    expect(onRemoveProject).not.toHaveBeenCalled();
    await act(async () => document.body.querySelector<HTMLButtonElement>(".desktop-dialog-button.destructive")?.click());

    expect(onRemoveProject).toHaveBeenCalledWith("/Users/example/Desktop/Notes");
    expect(onOpenWorkspacePath).not.toHaveBeenCalled();
    expect(document.body.querySelector(".desktop-project-row-dialog")).toBeNull();
  });

  it("keeps a project registered when unlink confirmation is cancelled", async () => {
    const onRemoveProject = vi.fn(async () => undefined);
    const container = renderHome({ onRemoveProject, projectItems: [notesProject] });

    await act(async () => container.querySelector<HTMLButtonElement>(".onboarding-project-actions")?.click());
    await act(async () => projectMenuItem("Unlink…")?.click());
    await act(async () => document.body.querySelector<HTMLButtonElement>(".desktop-dialog-footer .desktop-dialog-button:not(.destructive)")?.click());

    expect(onRemoveProject).not.toHaveBeenCalled();
    expect(document.body.querySelector(".desktop-project-row-dialog")).toBeNull();
    expect(container.querySelector(".onboarding-project-row")).not.toBeNull();
  });

  it("copies the absolute project path and exposes it as text when dragging a row", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const container = renderHome({
      projectItems: [{
        id: "notes",
        label: "Notes",
        localPath: "/Users/example/Desktop/Notes",
        lastOpenedAt: null,
      }],
    });
    const row = container.querySelector<HTMLButtonElement>(".onboarding-project-row");
    const transfer = createTextTransfer();

    await act(async () => {
      row?.dispatchEvent(createDragEvent("dragstart", transfer));
      await Promise.resolve();
    });

    expect(row?.getAttribute("draggable")).toBe("true");
    expect(transfer.effectAllowed).toBe("copy");
    expect(transfer.getData("text/plain")).toBe("/Users/example/Desktop/Notes");
    expect(writeText).toHaveBeenCalledWith("/Users/example/Desktop/Notes");
    expect(row?.parentElement?.classList.contains("is-dragging")).toBe(true);

    act(() => row?.dispatchEvent(createDragEvent("dragend", transfer)));
    expect(row?.parentElement?.classList.contains("is-dragging")).toBe(false);
  });

  it("highlights the primary folder action for drag feedback", () => {
    const container = renderHome();
    const surface = requireSurface(container);
    const folder = new File([], "Notes");
    const transfer = createTransfer([folder], [{ isDirectory: true }]);

    act(() => surface.dispatchEvent(createDragEvent("dragenter", transfer)));
    expect(container.querySelector("[data-onboarding-action='open']")?.classList.contains("is-dragging")).toBe(true);
    expect(container.querySelector(".onboarding-folder-drop-overlay")).toBeNull();

    act(() => surface.dispatchEvent(createDragEvent("dragleave", transfer)));
    expect(container.querySelector("[data-onboarding-action='open']")?.classList.contains("is-dragging")).toBe(false);
  });

  it("hands one folder File to the native workspace boundary", async () => {
    const onOpenDroppedWorkspace = vi.fn(async () => undefined);
    const container = renderHome({ onOpenDroppedWorkspace });
    const folder = new File([], "Notes");
    const transfer = createTransfer([folder], [{ isDirectory: true }]);

    await act(async () => {
      requireSurface(container).dispatchEvent(createDragEvent("drop", transfer));
      await Promise.resolve();
    });

    expect(onOpenDroppedWorkspace).toHaveBeenCalledTimes(1);
    expect(onOpenDroppedWorkspace).toHaveBeenCalledWith(folder);
  });

  it.each([
    ["a regular file", [new File(["hello"], "notes.md")], [{ isDirectory: false }]],
    ["multiple folders", [new File([], "One"), new File([], "Two")], [{ isDirectory: true }, { isDirectory: true }]],
  ])("rejects %s without starting a workspace open", async (_label, files, entries) => {
    const onOpenDroppedWorkspace = vi.fn(async () => undefined);
    const container = renderHome({ onOpenDroppedWorkspace });

    await act(async () => {
      requireSurface(container).dispatchEvent(createDragEvent("drop", createTransfer(files, entries)));
      await Promise.resolve();
    });

    expect(onOpenDroppedWorkspace).not.toHaveBeenCalled();
    expect(container.querySelector("[role='alert']")?.textContent).toContain("Drop a local folder");
  });
});
