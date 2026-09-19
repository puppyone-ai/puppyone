/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MinimalOnboarding, type MinimalOnboardingProps } from "../../../../src/components/MinimalOnboarding";
import { PUPPY_BRAND_MARK_ASSETS } from "../../../../src/components/brand/PuppyBrandMark";
import {
  EMPTY_STATE_INTRO_FALLBACK_TIMEOUT_MS,
} from "../../../../src/components/onboarding/emptyStateIntro";
import type { WorkspaceCreateProjectRequest, WorkspaceCreateProjectResult, DesktopTelemetryState } from "../../../../src/types/electron";
import { renderWithTestLocalization } from "../../../support/react/localization";
import { createTestSurfaceAppearance } from "../../../support/react/surfaceAppearance";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const originalClipboard = navigator.clipboard;
const originalConfirm = window.confirm;
const onboardingCss = readFileSync("src/styles/onboarding.css", "utf8");

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: originalClipboard,
  });
  Object.defineProperty(window, "confirm", {
    configurable: true,
    value: originalConfirm,
  });
  delete window.puppyoneDesktop;
  window.localStorage.clear();
  vi.useRealTimers();
});

describe("project folder home", () => {
  it("applies the effective Sub Theme on the real onboarding appearance root", () => {
    const styles = document.createElement("style");
    styles.textContent = `
      .onboarding-shell.dark { --po-surface-canvas: #161413; }
      [data-po-appearance-root][data-sub-theme-id="default.newspaper"].dark {
        --po-surface-canvas: #092d30;
      }
    `;
    document.head.append(styles);

    const container = renderHome({}, { subThemeId: "default.newspaper" });
    const surface = requireSurface(container);

    expect(surface.dataset.poAppearanceRoot).toBe("true");
    expect(surface.dataset.subThemeId).toBe("default.newspaper");
    expect(getComputedStyle(surface).getPropertyValue("--po-surface-canvas").trim())
      .toBe("#092d30");
    styles.remove();
  });

  it("plays the reveal whenever project home mounts empty", async () => {
    vi.useFakeTimers();
    const container = renderHome();

    const intro = container.querySelector<HTMLElement>("[data-onboarding-empty-state-intro]");
    const reveal = intro?.querySelector(".onboarding-empty-state-reveal");
    expect(intro).not.toBeNull();
    expect(reveal).not.toBeNull();
    expect([...intro!.children]).toEqual([reveal]);
    expect(requireSurface(container).classList.contains("is-empty-state-intro")).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(EMPTY_STATE_INTRO_FALLBACK_TIMEOUT_MS + 100);
    });

    expect(container.querySelector("[data-onboarding-empty-state-intro]")).toBeNull();
    expect(requireSurface(container).classList.contains("is-empty-state-intro")).toBe(false);
  });

  it("places the versioned telemetry disclosure below the first-launch CTA only once", async () => {
    vi.useFakeTimers();
    const bridge = installFirstLaunchTelemetryBridge();
    const container = renderHome();

    expect(container.querySelector("[data-onboarding-telemetry-disclosure]")).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(EMPTY_STATE_INTRO_FALLBACK_TIMEOUT_MS + 100);
      await Promise.resolve();
      await Promise.resolve();
    });

    const actionArea = container.querySelector(".onboarding-primary-area");
    const actions = container.querySelector(".onboarding-entry-actions");
    const disclosure = container.querySelector("[data-onboarding-telemetry-disclosure]");
    expect(disclosure).not.toBeNull();
    expect(actionArea?.lastElementChild).toBe(disclosure);
    expect(actions!.compareDocumentPosition(disclosure as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bridge.markTelemetryNoticeSeen).toHaveBeenCalledOnce();
  });

  it("ignores the legacy first-launch marker while project home is empty", () => {
    window.localStorage.setItem("puppyone.desktop.onboardingIntro", "1");
    const container = renderHome();

    expect(container.querySelector("[data-onboarding-empty-state-intro]")).not.toBeNull();
  });

  it("skips the empty-state reveal when recent projects already exist", () => {
    const container = renderHome({
      projectItems: [{
        id: "notes",
        label: "Notes",
        localPath: "/Users/example/Desktop/Notes",
        lastOpenedAt: null,
      }],
    });

    expect(container.querySelector("[data-onboarding-empty-state-intro]")).toBeNull();
  });

  it("replays the empty-state reveal from the development preview shortcut", async () => {
    vi.useFakeTimers();
    const container = renderHome({
      projectItems: [{
        id: "notes",
        label: "Notes",
        localPath: "/Users/example/Desktop/Notes",
        lastOpenedAt: null,
      }],
    });

    expect(container.querySelector("[data-onboarding-empty-state-intro]")).toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        code: "KeyL",
        altKey: true,
        shiftKey: true,
      }));
    });

    expect(container.querySelector("[data-onboarding-empty-state-intro]")).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(EMPTY_STATE_INTRO_FALLBACK_TIMEOUT_MS + 100);
    });

    expect(container.querySelector("[data-onboarding-empty-state-intro]")).toBeNull();
  });

  it("shows registered projects before neutral entry actions", () => {
    const container = renderHome({
      projectItems: [{
        id: "notes",
        label: "Notes",
        localPath: "/Users/example/Desktop/Notes",
        lastOpenedAt: null,
      }],
    });

    expect(container.querySelector(".onboarding-project-row")?.classList.contains("desktop-menu-item")).toBe(true);
    expect(container.textContent).toContain("Which project do you want to start with?");
    expect(container.textContent).not.toContain("Local Projects");
    expect(container.textContent).not.toContain("Other options");
    expect(container.textContent).not.toContain("Get started with puppyone");
    expectBrandLockup(container, "projects");
    const projectActions = [...container.querySelectorAll<HTMLButtonElement>(".onboarding-entry-action")];
    expect(projectActions).toHaveLength(3);
    expect(projectActions.map((action) => action.textContent)).toEqual([
      "New empty project",
      "Open a folder",
      "Import",
    ]);
    expect(projectActions.every((action) => action.classList.contains("po-button--neutral"))).toBe(true);
    expect(projectActions.every((action) => !action.classList.contains("onboarding-entry-action-cta"))).toBe(true);
    expect(container.querySelector(".onboarding-entry-action-divider")).toBeNull();
    const brand = container.querySelector(".onboarding-brand-lockup");
    const projects = container.querySelector(".onboarding-projects-layout");
    const launcher = container.querySelector(".onboarding-primary-area");
    expect(requireSurface(container).dataset.onboardingState).toBe("projects");
    expect(container.querySelector(".onboarding-recent-projects")?.children).toHaveLength(1);
    expect(container.querySelector(".onboarding-project-list")?.children).toHaveLength(1);
    expect(brand!.compareDocumentPosition(projects as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(projects!.compareDocumentPosition(launcher as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("uses Puppy Lite only when the resolved theme is light", () => {
    const container = renderHome({}, { themeMode: "light" });

    expectBrandLockup(
      container,
      "empty",
      PUPPY_BRAND_MARK_ASSETS.lite,
    );
  });

  it("tones the canonical Puppy mark down only on dark onboarding surfaces", () => {
    expect(onboardingCss).toMatch(
      /\.onboarding-shell\.dark \.onboarding-brand-mark-artwork\s*\{[^}]*filter:\s*grayscale\(1\) brightness\(0\.7\);/s,
    );
    expect(onboardingCss).not.toMatch(
      /(?:^|\n)\.onboarding-brand-mark-artwork\s*\{[^}]*filter:/s,
    );
  });

  it("uses one launcher geometry with a full-width first-section divider", () => {
    expect(onboardingCss).toMatch(
      /\.onboarding-launcher\s*\{[^}]*display:\s*grid;[^}]*width:\s*var\(--onboarding-column-width\);[^}]*gap:\s*var\(--onboarding-section-gap\);/s,
    );
    expect(onboardingCss).not.toMatch(
      /\.onboarding-shell\[data-onboarding-state="empty"\] \.onboarding-launcher/,
    );
    expect(onboardingCss).toMatch(
      /\.onboarding-shell\[data-onboarding-state="empty"\] \.onboarding-primary-area\s*\{[^}]*padding-block-start:\s*18px;[^}]*border-top:\s*1px solid var\(--po-border\);/s,
    );
    expect(onboardingCss).toMatch(
      /\.onboarding-shell\[data-onboarding-state="empty"\] \.onboarding-entry-action-default\s*\{[^}]*width:\s*fit-content;[^}]*min-width:\s*0;[^}]*justify-content:\s*flex-start;/s,
    );
  });

  it("exposes one vertical projects-state contract", () => {
    const container = renderHome({
      projectItems: [{
        id: "notes",
        label: "Notes",
        localPath: "/Users/example/Desktop/Notes",
        lastOpenedAt: null,
      }],
    });
    const surface = requireSurface(container);
    const homepage = container.querySelector(".onboarding-homepage");

    expect(surface.dataset.onboardingState).toBe("projects");
    expect(homepage?.className).toBe("onboarding-homepage");
    expect(homepage?.getAttribute("data-start-page-layout")).toBeNull();
  });

  it("keeps one folder action after the project panel", async () => {
    const onChooseWorkspace = vi.fn(async () => undefined);
    const container = renderHome({
      onChooseWorkspace,
      projectItems: [{
        id: "notes",
        label: "Notes",
        localPath: "/Users/example/Desktop/Notes",
        lastOpenedAt: null,
      }],
    });

    expect(container.querySelectorAll(".folder-drop-zone")).toHaveLength(0);
    expectBrandLockup(container, "projects");
    const panel = container.querySelector(".onboarding-recent-projects");
    expect(panel?.lastElementChild?.classList.contains("onboarding-project-list")).toBe(true);
    const projectFolder = container.querySelector(".onboarding-project-row .lucide-folder");
    expect(projectFolder).not.toBeNull();
    expect(container.querySelector(".desktop-menu-item-label")?.textContent).toBe("Notes");
    expect(container.querySelector(".desktop-menu-item-detail")?.textContent).toBe("~/Desktop");
    expect(container.querySelector(".desktop-menu-item-trailing")?.textContent).toContain("Previously opened");

    await act(async () => container.querySelector<HTMLButtonElement>("[data-onboarding-action='open']")?.click());
    expect(onChooseWorkspace).toHaveBeenCalledTimes(1);
  });

  it("uses one explicit CTA in the empty state", async () => {
    const onChooseWorkspace = vi.fn(async () => undefined);
    const onChooseProjectLocation = vi.fn(async () => ({
      grantId: "location-1",
      path: "/Users/example/Desktop",
    }));
    const onCreateProject = vi.fn(createProjectResult);
    const onCloneRepository = vi.fn(async () => true);
    const container = renderHome({
      onChooseWorkspace,
      onChooseProjectLocation,
      onCreateProject,
      onCloneRepository,
    });

    expectBrandLockup(container);
    const actions = [...container.querySelectorAll<HTMLButtonElement>(".onboarding-entry-action")];
    expect(actions).toHaveLength(3);
    expect(actions.map((action) => action.textContent)).toEqual([
      "New empty project",
      "Open a folder",
      "Import",
    ]);
    expect(actions.every((action) => action.classList.contains("po-button"))).toBe(true);
    expect(actions[0]?.classList.contains("po-button--neutral")).toBe(true);
    expect(actions[1]?.classList.contains("po-button--neutral")).toBe(true);
    expect(actions[0]?.classList.contains("onboarding-entry-action-default")).toBe(true);
    expect(actions[0]?.dataset.onboardingAction).toBe("create");
    expect(actions[1]?.dataset.onboardingAction).toBe("open");
    expect(actions[2]?.dataset.onboardingAction).toBe("clone");
    expect(actions[0]?.classList.contains("onboarding-entry-action-folder")).toBe(false);
    expect(actions[0]?.querySelector(".onboarding-entry-create-icon")).not.toBeNull();
    expect(actions[1]?.querySelector(".lucide-folder-open")).not.toBeNull();
    expect(actions[2]?.querySelector(".po-button__icon .lucide-download")).not.toBeNull();
    expect(actions[2]?.disabled).toBe(false);
    // Import keeps one accessible target, with an action icon and named source marks.
    const importGroup = container.querySelector(".onboarding-entry-import");
    expect(importGroup).toBe(actions[2]);
    expect(importGroup?.getAttribute("aria-label")).toBeNull();
    expect(importGroup?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(importGroup?.querySelectorAll("button, [tabindex]")).toHaveLength(0);
    expect(container.querySelectorAll(".onboarding-entry-actions button")).toHaveLength(3);
    const marks = [...importGroup!.querySelectorAll<HTMLImageElement>(".onboarding-import-mark")];
    expect(marks.map((mark) => mark.dataset.importBrand)).toEqual(["github", "notion", "google-drive"]);
    expect(marks.map((mark) => mark.alt)).toEqual(["GitHub", "Notion", "Google Drive"]);
    expect(importGroup?.querySelector(".onboarding-entry-import-more.lucide-plus")).not.toBeNull();
    const preview = importGroup!.querySelector(".onboarding-entry-import-brands");
    const importLabel = importGroup!.querySelector(".onboarding-entry-import-label");
    expect(importLabel!.compareDocumentPosition(preview as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const divider = container.querySelector(".onboarding-entry-action-divider");
    expect(divider?.getAttribute("role")).toBe("separator");
    expect(divider?.parentElement).toBe(importGroup?.parentElement);
    expect(actions[1]!.compareDocumentPosition(divider as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(divider!.compareDocumentPosition(importGroup as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const launcher = container.querySelector(".onboarding-launcher");
    expect(launcher?.contains(container.querySelector(".onboarding-brand-lockup"))).toBe(true);
    expect(launcher?.contains(container.querySelector(".onboarding-entry-actions"))).toBe(true);
    expect(container.querySelector(".onboarding-entry-action-primary")?.contains(actions[0] as Node)).toBe(true);
    expect([...container.querySelectorAll(".onboarding-entry-action-secondary .onboarding-entry-action")]).toEqual([
      actions[1],
    ]);
    expect(requireSurface(container).dataset.onboardingState).toBe("empty");
    expect(container.querySelector(".onboarding-projects-layout")).toBeNull();
    expect(container.textContent).not.toContain("Get started with puppyone");

    await act(async () => actions[1]?.click());
    expect(onChooseWorkspace).toHaveBeenCalledTimes(1);
    expect(onCreateProject).not.toHaveBeenCalled();
    expect(onCloneRepository).not.toHaveBeenCalled();
  });

  it("prefills the built-in projects folder so creating needs only a name", async () => {
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
    expect(container.querySelector(".onboarding-entry-local-note")?.textContent).toBe(
      "Files are created locally. Setup does not upload them.",
    );
    const projectName = container.querySelector<HTMLInputElement>(".onboarding-entry-dialog input");
    expect(projectName?.placeholder).toBe("My project");
    const createButton = container.querySelector<HTMLButtonElement>(".onboarding-entry-dialog button[type='submit']");
    expect(createButton?.disabled).toBe(true);
    setInputValue(projectName, "Knowledge Base");
    expect(createButton?.disabled).toBe(false);
    await act(async () => {
      createButton?.click();
      await Promise.resolve();
    });
    expect(onCreateProject).toHaveBeenCalledWith({
      operationId: expect.any(String),
      locale: "en",
      source: { kind: "template", ref: { sourceId: "builtin", id: "puppyone.project.getting-started", version: 1 } },
      name: "Knowledge Base",
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
    setInputValue(container.querySelector<HTMLInputElement>(".onboarding-entry-dialog input"), "Knowledge Base");
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
    setInputValue(container.querySelector<HTMLInputElement>(".onboarding-entry-dialog input"), "Knowledge Base");
    expect(createButton?.disabled).toBe(true);
  });

  it("frames Import as bringing work back from other apps, with Git as one source", async () => {
    const onCloneRepository = vi.fn(async () => true);
    const onChooseWorkspace = vi.fn(async () => undefined);
    const container = renderHome({ onCloneRepository, onChooseWorkspace });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-onboarding-action='clone']")?.click();
    });
    const dialog = container.querySelector<HTMLElement>("[role='dialog']");
    expect(dialog?.getAttribute("aria-label")).toBe("Import");
    expect(dialog?.classList.contains("is-import")).toBe(true);
    expect(container.querySelector(".onboarding-import-intro")?.textContent).toBe(
      "Turn SaaS data into files on your computer.",
    );
    const sources = [...container.querySelectorAll<HTMLButtonElement>(".onboarding-import-source")];
    expect(sources.map((source) => source.dataset.importSource)).toEqual([
      "git",
      "notion",
      "google-drive",
      "obsidian",
      "airtable",
      "folder",
    ]);
    expect(sources.map((source) => source.textContent)).toEqual([
      "GitHub or GitLab",
      "Notion",
      "Google Drive",
      "Obsidian",
      "Airtable",
      "Any folder of files",
    ]);
    expect(container.querySelector(".onboarding-entry-dialog input")).toBeNull();
    expect(dialog?.querySelectorAll("p")).toHaveLength(1);
    expect(dialog?.querySelector(".desktop-dialog-leading, .onboarding-import-source-chevron, .onboarding-import-source-copy")).toBeNull();
    expect(dialog?.getAttribute("aria-describedby")).toBe(dialog?.querySelector(".onboarding-import-intro")?.id);
    expect(dialog?.querySelectorAll(".onboarding-import-sources > li > button")).toHaveLength(6);
    expect(sources.every((source) => source.getAttribute("role") === null)).toBe(true);
    expect(sources.every((source) => source.children.length === 2)).toBe(true);
    expect(document.activeElement).toBe(sources[0]);
    // Rows show the real product marks, not generic glyphs.
    expect(
      [...sources[0]!.querySelectorAll<HTMLImageElement>(".onboarding-import-source-marks img")]
        .map((mark) => mark.dataset.importBrand),
    ).toEqual(["github", "gitlab"]);
    expect(sources.slice(1, 5).map((source) => (
      source.querySelector<HTMLImageElement>(".onboarding-import-source-icon img")?.dataset.importBrand
    ))).toEqual(["notion", "google-drive", "obsidian", "airtable"]);
    expect(sources[5]?.querySelector(".lucide-folder-open")).not.toBeNull();

    await act(async () => {
      sources[5]?.click();
      await Promise.resolve();
    });
    expect(container.querySelector(".onboarding-entry-dialog")).toBeNull();
    expect(onChooseWorkspace).toHaveBeenCalledOnce();
    expect(onCloneRepository).not.toHaveBeenCalled();
  });

  it.each([
    ".onboarding-entry-import",
    ".onboarding-entry-import .po-button__icon",
    ".onboarding-entry-import-label",
    ".onboarding-entry-import [data-import-brand='github']",
    ".onboarding-entry-import [data-import-brand='notion']",
    ".onboarding-entry-import [data-import-brand='google-drive']",
  ])("opens the common source picker from the import entry (%s)", async (selector) => {
    const onDefaultProjectLocation = vi.fn(async () => null);
    const container = renderHome({
      onCloneRepository: vi.fn(async () => true),
      onChooseWorkspace: vi.fn(async () => undefined),
      onDefaultProjectLocation,
    });

    await act(async () => {
      container.querySelector<HTMLElement>(selector)?.click();
    });
    expect(container.querySelector("[role='dialog']")?.getAttribute("aria-label")).toBe("Import");
    expect(container.querySelectorAll(".onboarding-import-source")).toHaveLength(6);
    expect(onDefaultProjectLocation).not.toHaveBeenCalled();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".desktop-dialog-header .desktop-dialog-icon-button")?.click();
    });
    expect(container.querySelector("[role='dialog']")).toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".onboarding-entry-import")?.click();
      await Promise.resolve();
    });
    expect(container.querySelector("[role='dialog']")?.getAttribute("aria-label")).toBe("Import");
  });

  it("keeps the label and source marks disabled when import is unavailable", async () => {
    const container = renderHome();
    const button = container.querySelector<HTMLButtonElement>(".onboarding-entry-import");
    expect(button?.disabled).toBe(true);
    expect(button?.querySelectorAll("button, [tabindex]")).toHaveLength(0);
    await act(async () => {
      button?.querySelector<HTMLElement>(".onboarding-entry-import-label")?.click();
      button?.querySelector<HTMLImageElement>(".onboarding-import-mark")?.click();
    });
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("guides Google Drive downloads to a local folder without account connection", async () => {
    const onChooseWorkspace = vi.fn(async () => undefined);
    const onCloneRepository = vi.fn(async () => true);
    const container = renderHome({ onChooseWorkspace, onCloneRepository });
    await act(async () => container.querySelector<HTMLButtonElement>(".onboarding-entry-import")?.click());
    await act(async () => container.querySelector<HTMLButtonElement>(".onboarding-import-source[data-import-source='google-drive']")?.click());
    expect(container.querySelector("[role='dialog']")?.getAttribute("aria-label")).toBe("Import from Google Drive");
    expect(container.querySelectorAll(".onboarding-import-steps > li")).toHaveLength(3);
    expect(container.querySelector(".onboarding-import-outcome")?.textContent).toContain("No Google account connection or ongoing sync.");
    const action = container.querySelector<HTMLButtonElement>(".desktop-dialog-footer .desktop-dialog-button.primary");
    expect(action?.textContent).toBe("Choose downloaded folder");
    await act(async () => action?.click());
    expect(onChooseWorkspace).toHaveBeenCalledOnce();
    expect(onCloneRepository).not.toHaveBeenCalled();
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("guides a Notion export into the regular folder picker", async () => {
    const onChooseWorkspace = vi.fn(async () => undefined);
    const container = renderHome({ onCloneRepository: vi.fn(async () => true), onChooseWorkspace });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-onboarding-action='clone']")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".onboarding-import-source[data-import-source='notion']")?.click();
    });
    expect(container.querySelector("[role='dialog']")?.getAttribute("aria-label")).toBe("Import from Notion");
    const steps = [...container.querySelectorAll(".onboarding-import-steps > li")];
    expect(steps).toHaveLength(3);
    expect(steps[1]?.textContent).toBe("Pick Markdown & CSV and include subpages.");
    expect(container.querySelector(".onboarding-import-outcome")?.textContent).toContain("Everything stays on this computer.");
    const action = container.querySelector<HTMLButtonElement>(".desktop-dialog-footer .desktop-dialog-button.primary");
    expect(action?.textContent).toBe("Choose exported folder");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".onboarding-import-back")?.click();
    });
    expect(container.querySelector("[role='dialog']")?.getAttribute("aria-label")).toBe("Import");
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".onboarding-import-source[data-import-source='obsidian']")?.click();
    });
    expect([...container.querySelectorAll(".onboarding-import-steps > li")]).toHaveLength(2);
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".desktop-dialog-footer .desktop-dialog-button.primary")?.click();
      await Promise.resolve();
    });
    expect(container.querySelector(".onboarding-entry-dialog")).toBeNull();
    expect(onChooseWorkspace).toHaveBeenCalledOnce();
  });

  it("imports a GitHub repository into the default location without a folder picker", async () => {
    const onCloneRepository = vi.fn(async () => true);
    const onDefaultProjectLocation = vi.fn(async () => ({
      grantId: "default-1",
      path: "/Users/example/Documents/PuppyOne",
    }));
    const container = renderHome({ onCloneRepository, onDefaultProjectLocation });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-onboarding-action='clone']")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".onboarding-import-source[data-import-source='git']")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector("[role='dialog']")?.getAttribute("aria-label")).toBe("Import a repository");
    const providerMarks = Array.from(
      container.querySelectorAll<SVGElement>(".onboarding-clone-provider-marks svg"),
    );
    expect(providerMarks.map((mark) => mark.dataset.repositoryProvider)).toEqual(["github", "gitlab"]);
    expect(providerMarks.every((mark) => mark.getAttribute("fill") === "currentColor")).toBe(true);
    expect(container.querySelector(".onboarding-clone-hint")?.textContent).toBe(
      "Works with GitHub and GitLab URLs. The repository is copied to this computer.",
    );
    expect(onDefaultProjectLocation).toHaveBeenCalledOnce();
    expect(container.querySelector(".onboarding-entry-location-path")?.textContent).toBe("/Users/example/Documents/PuppyOne");
    const repositoryUrl = container.querySelector<HTMLInputElement>(".onboarding-entry-dialog input");
    expect(repositoryUrl?.inputMode).toBe("url");
    expect(repositoryUrl?.placeholder).toBe("https://github.com/owner/repository.git");
    const submitButton = container.querySelector<HTMLButtonElement>(".onboarding-entry-dialog button[type='submit']");
    expect(submitButton?.textContent).toBe("Import");
    expect(submitButton?.disabled).toBe(true);
    setInputValue(repositoryUrl, "https://github.com/puppyone-ai/puppyone.git");
    expect(submitButton?.disabled).toBe(false);
    await act(async () => {
      submitButton?.click();
      await Promise.resolve();
    });
    expect(onCloneRepository).toHaveBeenCalledWith({
      repositoryUrl: "https://github.com/puppyone-ai/puppyone.git",
      locationGrantId: "default-1",
    });
    expect(container.querySelector(".onboarding-entry-dialog")).toBeNull();
  });

  it("auto-detects a GitLab URL and passes a null grant when no default location exists", async () => {
    const onCloneRepository = vi.fn(async () => true);
    const container = renderHome({ onCloneRepository });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-onboarding-action='clone']")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".onboarding-import-source[data-import-source='git']")?.click();
    });
    const repositoryUrl = container.querySelector<HTMLInputElement>(".onboarding-entry-dialog input");
    setInputValue(repositoryUrl, "git@gitlab.com:puppyone/data/knowledge-base.git");
    expect(container.querySelector<HTMLButtonElement>(".onboarding-entry-dialog button[type='submit']")?.disabled).toBe(false);
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".onboarding-entry-dialog button[type='submit']")?.click();
      await Promise.resolve();
    });
    expect(onCloneRepository).toHaveBeenCalledWith({
      repositoryUrl: "git@gitlab.com:puppyone/data/knowledge-base.git",
      locationGrantId: null,
    });
  });

  it("explains unsupported repository URLs instead of silently disabling Import", async () => {
    const onCloneRepository = vi.fn(async () => true);
    const container = renderHome({ onCloneRepository });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-onboarding-action='clone']")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".onboarding-import-source[data-import-source='git']")?.click();
    });
    const repositoryUrl = container.querySelector<HTMLInputElement>(".onboarding-entry-dialog input");
    const submitButton = container.querySelector<HTMLButtonElement>(".onboarding-entry-dialog button[type='submit']");
    setInputValue(repositoryUrl, "https://example.com/owner/repository.git");

    expect(repositoryUrl?.getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector(".onboarding-clone-hint")?.textContent).toBe(
      "Only GitHub and GitLab URLs are supported right now.",
    );
    expect(container.querySelector(".onboarding-clone-hint")?.getAttribute("role")).toBe("alert");
    expect(submitButton?.disabled).toBe(true);
    expect(onCloneRepository).not.toHaveBeenCalled();
  });

  it("shows project-opening progress only inside the project row", async () => {
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

    expect(row?.querySelectorAll("[data-puppy-loader]")).toHaveLength(1);
    expect(container.querySelector(".onboarding-operation-status")).toBeNull();
    expect(container.querySelectorAll("[data-puppy-loader]")).toHaveLength(1);

    await act(async () => finishOpening?.());
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
    const folderAction = container.querySelector<HTMLButtonElement>("[data-onboarding-action='open']");

    await act(async () => {
      folderAction?.click();
      await Promise.resolve();
    });

    expect(folderAction?.querySelectorAll("[data-puppy-loader]")).toHaveLength(1);
    expect(container.querySelector(".onboarding-operation-status")).toBeNull();
    expect(container.querySelector(".onboarding-project-row [data-puppy-loader]")).toBeNull();

    await act(async () => finishOpening?.());
  });

  it("removes one registration without opening the project", async () => {
    const onOpenWorkspacePath = vi.fn(async () => undefined);
    const onRemoveProject = vi.fn(async () => undefined);
    const confirm = vi.fn(() => true);
    Object.defineProperty(window, "confirm", { configurable: true, value: confirm });
    const container = renderHome({
      onOpenWorkspacePath,
      onRemoveProject,
      projectItems: [{
        id: "notes",
        label: "Notes",
        localPath: "/Users/example/Desktop/Notes",
        lastOpenedAt: null,
      }],
    });
    const removeButton = container.querySelector<HTMLButtonElement>(".onboarding-project-remove");

    expect(removeButton?.getAttribute("aria-label")).toContain("Remove");
    expect(removeButton?.title).toBe("Removes this registration only. Local files are not deleted.");
    expect(removeButton?.querySelector(".lucide-unlink")).not.toBeNull();
    expect(removeButton?.querySelector(".lucide-x")).toBeNull();
    await act(async () => removeButton?.click());

    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/Local files will stay on disk/));
    expect(onRemoveProject).toHaveBeenCalledWith("/Users/example/Desktop/Notes");
    expect(onOpenWorkspacePath).not.toHaveBeenCalled();
  });

  it("keeps a project registered when unlink confirmation is cancelled", async () => {
    const onRemoveProject = vi.fn(async () => undefined);
    Object.defineProperty(window, "confirm", { configurable: true, value: vi.fn(() => false) });
    const container = renderHome({
      onRemoveProject,
      projectItems: [{
        id: "notes",
        label: "Notes",
        localPath: "/Users/example/Desktop/Notes",
        lastOpenedAt: null,
      }],
    });

    await act(async () => container.querySelector<HTMLButtonElement>(".onboarding-project-remove")?.click());

    expect(onRemoveProject).not.toHaveBeenCalled();
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

function renderHome(
  overrides: Partial<Omit<MinimalOnboardingProps, "appearance">> & Pick<Partial<MinimalOnboardingProps>, "appearance"> = {},
  appearanceInput: Parameters<typeof createTestSurfaceAppearance>[0] = {},
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const props: MinimalOnboardingProps = {
    onChooseWorkspace: vi.fn(async () => undefined),
    onOpenDroppedWorkspace: vi.fn(async () => undefined),
    onOpenWorkspacePath: vi.fn(async () => undefined),
    appearance: createTestSurfaceAppearance(appearanceInput),
    ...overrides,
  };
  act(() => renderWithTestLocalization(root, React.createElement(MinimalOnboarding, props)));
  return container;
}

function expectBrandLockup(
  container: HTMLElement,
  state: "empty" | "projects" = "empty",
  expectedMarkAsset: string = PUPPY_BRAND_MARK_ASSETS.dark,
) {
  const lockup = container.querySelector(".onboarding-brand-lockup");
  const mark = lockup?.querySelector<HTMLImageElement>(".onboarding-brand-mark-artwork");
  expect(mark?.getAttribute("src")).toContain(expectedMarkAsset);
  expect(mark?.getAttribute("alt")).toBe("");
  if (state === "projects") {
    expect(lockup?.querySelector(".onboarding-brand-prompt")?.textContent).toBe("Which project do you want to start with?");
    expect(lockup?.querySelector(".onboarding-brand-name")).toBeNull();
  } else {
    expect(lockup?.querySelector(".onboarding-brand-prompt")).toBeNull();
    expect(lockup?.querySelector(".onboarding-brand-name")?.textContent).toBe("Start with your files. Agent-ready.");
  }
  expect(lockup?.querySelectorAll("p")).toHaveLength(0);
  expect(lockup?.querySelector(".onboarding-brand-tagline")).toBeNull();
  expect(lockup?.querySelector(".onboarding-brand-version")).toBeNull();
  expect(container.querySelector(".onboarding-brand-context")).toBeNull();
}

function requireSurface(container: HTMLElement): HTMLElement {
  const surface = container.querySelector<HTMLElement>(".onboarding-homepage-shell");
  if (!surface) throw new Error("Project home surface is missing.");
  return surface;
}

function installFirstLaunchTelemetryBridge() {
  const initial: DesktopTelemetryState = {
    schemaVersion: 2,
    defaultLevel: "basic",
    level: "basic",
    effectiveLevel: "off",
    enabled: false,
    eligible: true,
    disabledReason: "notice-required",
    noticeVersion: 2,
    noticeSeenVersion: 0,
    noticeRequired: true,
    transportConfigured: true,
    queuedEventCount: 0,
  };
  const seen: DesktopTelemetryState = {
    ...initial,
    effectiveLevel: "basic",
    enabled: true,
    disabledReason: null,
    noticeSeenVersion: 2,
    noticeRequired: false,
  };
  const bridge = {
    getTelemetryState: vi.fn().mockResolvedValue(initial),
    markTelemetryNoticeSeen: vi.fn().mockResolvedValue(seen),
    onTelemetryStateChanged: vi.fn(() => vi.fn()),
    openExternalUrl: vi.fn().mockResolvedValue({ ok: true }),
  };
  Object.defineProperty(window, "puppyoneDesktop", {
    configurable: true,
    value: bridge,
  });
  return bridge;
}

function createDragEvent(type: string, dataTransfer: DataTransfer): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  return event;
}

function createTransfer(
  files: File[],
  entries: Array<{ isDirectory: boolean }>,
): DataTransfer {
  const fileList = Object.assign([...files], {
    item: (index: number) => files[index] ?? null,
  }) as unknown as FileList;
  const items = entries.map((entry) => ({
    kind: "file",
    webkitGetAsEntry: () => ({
      isDirectory: entry.isDirectory,
      isFile: !entry.isDirectory,
      name: "entry",
      fullPath: "/entry",
      filesystem: {},
      getParent: () => undefined,
    }),
  }));
  return {
    files: fileList,
    items,
    types: ["Files"],
    dropEffect: "none",
  } as unknown as DataTransfer;
}

function createTextTransfer(): DataTransfer {
  const values = new Map<string, string>();
  return {
    files: Object.assign([], { item: () => null }) as unknown as FileList,
    items: [],
    types: [],
    dropEffect: "none",
    effectAllowed: "none",
    getData: (type: string) => values.get(type) ?? "",
    setData: (type: string, value: string) => {
      values.set(type, value);
    },
  } as unknown as DataTransfer;
}

function setInputValue(input: HTMLInputElement | null, value: string) {
  if (!input) throw new Error("Project entry input is missing.");
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function createProjectResult(request: WorkspaceCreateProjectRequest): Promise<WorkspaceCreateProjectResult> {
  return {
    initialization: { operationId: request.operationId, outcome: "committed", name: request.name, path: "/projects/" + request.name, createdPaths: ["Getting Started.md"], initialOpenPath: "Getting Started.md", template: null },
    opening: { status: "opened", result: { status: "opened-current", workspaceId: "test", path: "/projects/" + request.name, workspace: null } },
  };
}
