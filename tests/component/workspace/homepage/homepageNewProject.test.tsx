/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createProjectResult, expectBrandLockup, renderHome, requireSurface, setInputValue, setUpOnboardingHome } from "../../../support/react/onboardingHome";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
setUpOnboardingHome();

describe("New project from the Homepage", () => {
  it("uses one explicit CTA in the empty state", async () => {
    const onChooseWorkspace = vi.fn(async () => undefined);
    const onChooseProjectLocation = vi.fn(async () => ({
      grantId: "location-1",
      path: "/Users/example/Desktop",
    }));
    const onCreateProject = vi.fn(createProjectResult);
    const onImportSource = vi.fn(async () => true);
    const container = renderHome({
      onChooseWorkspace,
      onChooseProjectLocation,
      onCreateProject,
      onImportSource,
    });

    expectBrandLockup(container);
    const actions = [...container.querySelectorAll<HTMLButtonElement>(".onboarding-entry-action")];
    expect(actions).toHaveLength(3);
    expect(actions.map((action) => action.textContent)).toEqual([
      "New project",
      "Open a folder",
      "Import",
    ]);
    expect(actions.every((action) => action.classList.contains("po-button"))).toBe(true);
    expect(actions[0]?.classList.contains("po-button--primary")).toBe(true);
    expect(actions[1]?.classList.contains("po-button--neutral")).toBe(true);
    expect(actions[0]?.classList.contains("onboarding-entry-action-default")).toBe(true);
    expect(actions[0]?.dataset.onboardingAction).toBe("create");
    expect(actions[1]?.dataset.onboardingAction).toBe("open");
    expect(actions[2]?.dataset.onboardingAction).toBe("import");
    expect(actions[0]?.classList.contains("onboarding-entry-action-folder")).toBe(false);
    expect(actions[0]?.querySelector(".onboarding-entry-create-icon")).not.toBeNull();
    expect(actions[1]?.querySelector('[data-product-icon="folder"]')).not.toBeNull();
    expect(actions[2]?.querySelector(".po-button__icon .lucide-download")).not.toBeNull();
    expect(actions[2]?.disabled).toBe(false);
    // Import keeps one accessible target, with an action icon and named source marks.
    const importGroup = container.querySelector(".onboarding-entry-import");
    expect(importGroup).toBe(actions[2]);
    expect(importGroup?.getAttribute("aria-label")).toBeNull();
    expect(importGroup?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(importGroup?.querySelectorAll("button, [tabindex]")).toHaveLength(0);
    expect(container.querySelectorAll(".onboarding-entry-actions button")).toHaveLength(2);
    const marks = [...importGroup!.querySelectorAll<HTMLImageElement>(".onboarding-import-mark")];
    expect(marks.map((mark) => mark.dataset.importBrand)).toEqual(["github", "gitlab"]);
    expect(marks.map((mark) => mark.alt)).toEqual(["GitHub", "GitLab"]);
    const badges = [...importGroup!.querySelectorAll(".onboarding-entry-import-brand-badge")];
    expect(badges).toHaveLength(2);
    expect(badges.map((badge) => badge.querySelectorAll(".onboarding-import-mark").length)).toEqual([1, 1]);
    expect(importGroup?.querySelector(".onboarding-entry-import-more, .lucide-plus")).toBeNull();
    const preview = importGroup!.querySelector(".onboarding-entry-import-brands");
    const importLabel = importGroup!.querySelector(".onboarding-entry-import-label");
    expect(importLabel!.compareDocumentPosition(preview as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector(".onboarding-entry-action-divider")).toBeNull();
    expect(actions[1]!.compareDocumentPosition(importGroup as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const launcher = container.querySelector(".onboarding-launcher");
    expect(launcher?.contains(container.querySelector(".onboarding-brand-lockup"))).toBe(true);
    expect(launcher?.contains(container.querySelector(".onboarding-entry-actions"))).toBe(true);
    const primary = container.querySelector(".onboarding-home-primary");
    expect(primary?.getAttribute("data-onboarding-primary")).toBe("create");
    expect(primary?.contains(actions[0] as Node)).toBe(true);
    expect(container.querySelector(".onboarding-entry-actions")?.contains(actions[0] as Node)).toBe(false);
    expect([...container.querySelectorAll(".onboarding-entry-actions .onboarding-entry-action")]).toEqual([
      actions[1], actions[2],
    ]);
    expect(requireSurface(container).dataset.onboardingState).toBe("empty");
    expect(container.querySelector(".onboarding-project-list")).toBeNull();
    expect(container.textContent).not.toContain("Get started with puppyone");

    await act(async () => actions[1]?.click());
    expect(onChooseWorkspace).toHaveBeenCalledTimes(1);
    expect(onCreateProject).not.toHaveBeenCalled();
    expect(onImportSource).not.toHaveBeenCalled();
  });

  it("never reads the clipboard from the create dialog, which offers no paste of its own", async () => {
    const readText = vi.fn(async () => "https://www.puppyone.ai/t/b91aaade-bc9e-4dfd-8f23-11f06ec00301");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText } });
    const location = vi.fn(async () => ({ grantId: "default", path: "/example/Projects" }));
    const container = renderHome({ onDefaultProjectLocation: location, onChooseProjectLocation: location, onCreateProject: vi.fn(createProjectResult) });
    await act(async () => container.querySelector<HTMLButtonElement>("[data-onboarding-action='create']")?.click());
    expect(container.querySelector("[role='dialog']")).not.toBeNull();
    // A template link arrives from the store or a paste on the page, never from a button here.
    expect([...container.querySelectorAll("button")].some((button) => /template/i.test(button.textContent ?? ""))).toBe(false);
    expect(readText).not.toHaveBeenCalled();
  });

  it("prefills the name and built-in projects folder for one-action creation", async () => {
    const onDefaultProjectLocation = vi.fn(async () => ({
      grantId: "default-1",
      path: "/Users/example/Documents/PuppyOne",
    }));
    const onChooseProjectLocation = vi.fn(async () => ({
      grantId: "location-1",
      path: "/Users/example/Desktop",
    }));
    const onCreateProject = vi.fn(createProjectResult);
    const container = renderHome({
      onDefaultProjectLocation,
      onChooseProjectLocation,
      onCreateProject,
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-onboarding-action='create']")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector("[role='dialog']")?.getAttribute("aria-label")).toBe("Create a project");
    expect(container.querySelector(".desktop-dialog-title-row > h2")?.textContent).toBe("Create a project");
    expect(onDefaultProjectLocation).toHaveBeenCalledOnce();
    expect(onChooseProjectLocation).not.toHaveBeenCalled();
    expect(container.querySelector(".onboarding-entry-location-path")?.textContent).toBe("/Users/example/Documents/PuppyOne");
    expect(container.querySelector(".onboarding-entry-location-action")?.textContent).toBe("Change");
    const projectName = container.querySelector<HTMLInputElement>(".onboarding-entry-dialog input[type='text']");
    expect(projectName?.value).toMatch(/^My project [A-F0-9]{4}$/);
    const defaultName = projectName?.value;
    expect(container.querySelector(".onboarding-entry-dialog select")).toBeNull();
    expect(container.textContent).not.toContain("Files are created locally");
    expect(container.textContent).not.toContain("Getting Started");
    expect(container.textContent).not.toContain("Blank folder");
    const createButton = container.querySelector<HTMLButtonElement>(".onboarding-entry-dialog button[type='submit']");
    expect(createButton?.disabled).toBe(false);
    await act(async () => {
      createButton?.click();
      await Promise.resolve();
    });
    expect(onCreateProject).toHaveBeenCalledWith({
      operationId: expect.any(String),
      locale: "en",
      source: { kind: "template", ref: { sourceId: "builtin", id: "puppyone.project.getting-started", version: 1 } },
      name: defaultName,
      locationGrantId: "default-1",
    });
    expect(container.querySelector(".onboarding-entry-dialog")).toBeNull();
  });

  it("lets Change replace the default location with an explicitly browsed one", async () => {
    const onDefaultProjectLocation = vi.fn(async () => ({
      grantId: "default-1",
      path: "/Users/example/Documents/PuppyOne",
    }));
    const onChooseProjectLocation = vi.fn(async () => ({
      grantId: "location-1",
      path: "/Users/example/Desktop",
    }));
    const onCreateProject = vi.fn(createProjectResult);
    const container = renderHome({
      onDefaultProjectLocation,
      onChooseProjectLocation,
      onCreateProject,
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-onboarding-action='create']")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    setInputValue(container.querySelector<HTMLInputElement>(".onboarding-entry-dialog input[type='text']"), "Knowledge Base");
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".onboarding-entry-browse-button")?.click();
      await Promise.resolve();
    });
    expect(onChooseProjectLocation).toHaveBeenCalledOnce();
    expect(container.querySelector(".onboarding-entry-location-path")?.textContent).toBe("/Users/example/Desktop");
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".onboarding-entry-dialog button[type='submit']")?.click();
      await Promise.resolve();
    });
    expect(onCreateProject).toHaveBeenCalledWith({
      operationId: expect.any(String),
      locale: "en",
      source: { kind: "template", ref: { sourceId: "builtin", id: "puppyone.project.getting-started", version: 1 } },
      name: "Knowledge Base",
      locationGrantId: "location-1",
    });
  });

  it("falls back to Browse when no default location is available", async () => {
    const onChooseProjectLocation = vi.fn(async () => ({
      grantId: "location-1",
      path: "/Users/example/Desktop",
    }));
    const container = renderHome({
      onChooseProjectLocation,
      onCreateProject: vi.fn(createProjectResult),
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-onboarding-action='create']")?.click();
    });
    expect(container.querySelector(".onboarding-entry-location-path")?.textContent).toBe("Choose a folder");
    expect(container.querySelector(".onboarding-entry-location-action")?.textContent).toBe("Browse");
    const createButton = container.querySelector<HTMLButtonElement>(".onboarding-entry-dialog button[type='submit']");
    setInputValue(container.querySelector<HTMLInputElement>(".onboarding-entry-dialog input[type='text']"), "Knowledge Base");
    expect(createButton?.disabled).toBe(true);
  });
});
