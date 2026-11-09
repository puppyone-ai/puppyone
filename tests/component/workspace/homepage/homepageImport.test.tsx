/**
 * @vitest-environment happy-dom
 */
import { desktopPreferencesStore as preferences } from "../../../../src/preferencesStore";
import { OnboardingImportDialog } from "../../../../src/components/OnboardingImportDialog";
import { renderWithTestLocalization } from "../../../support/react/localization";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { ALL_EXPERIMENTAL_IMPORTS, mountRoot, renderHome, setInputValue, setUpOnboardingHome } from "../../../support/react/onboardingHome";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
setUpOnboardingHome();

describe("importing from the Homepage", () => {
  it("hides experimental sources by default", async () => {
    const onImportSource = vi.fn(async () => true);
    const onChooseWorkspace = vi.fn(async () => undefined);
    const container = renderHome({ onImportSource, onChooseWorkspace });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-onboarding-action='import']")?.click();
    });
    const dialog = container.querySelector<HTMLElement>("[role='dialog']");
    expect(dialog?.getAttribute("aria-label")).toBe("Import");
    expect(dialog?.classList.contains("is-import")).toBe(true);
    // The intro sentence was redundant with the dialog title and removed (7d1f4b77).
    expect(container.querySelector(".onboarding-import-intro")).toBeNull();
    const sources = [...container.querySelectorAll<HTMLButtonElement>(".onboarding-import-source")];
    expect(sources.map((source) => source.dataset.importSource)).toEqual([
      "github",
      "gitlab",
    ]);
    expect(sources.map((source) => source.textContent)).toEqual([
      "GitHub",
      "GitLab",
    ]);
    expect(sources.map((source) => source.dataset.importMode)).toEqual([
      "repository",
      "repository",
    ]);
    expect(container.querySelector(".onboarding-entry-dialog input")).toBeNull();
    // The picker is just its labelled list of sources: no prose, nothing to describe.
    expect(dialog?.querySelectorAll("p")).toHaveLength(0);
    expect(dialog?.querySelector(".desktop-dialog-leading, .onboarding-import-source-chevron, .onboarding-import-source-copy")).toBeNull();
    expect(dialog?.hasAttribute("aria-describedby")).toBe(false);
    expect(dialog?.querySelectorAll(".onboarding-import-sources > li > button")).toHaveLength(2);
    expect(sources.every((source) => source.getAttribute("role") === null)).toBe(true);
    expect(sources.every((source) => source.children.length === 2)).toBe(true);
    expect(document.activeElement).toBe(sources[0]);
    // Rows show the real product marks, not generic glyphs.
    expect(sources.slice(0, 2).map((source) => (
      source.querySelector<HTMLImageElement>(".onboarding-import-source-icon img")?.dataset.importBrand
    ))).toEqual(["github", "gitlab"]);
    expect(sources.slice(2)).toHaveLength(0);
    expect(container.querySelector('.onboarding-import-source [data-product-icon="folder"]')).toBeNull();
    expect(onChooseWorkspace).not.toHaveBeenCalled();
    expect(onImportSource).not.toHaveBeenCalled();
  });

  it.each([
    ".onboarding-entry-import",
    ".onboarding-entry-import .po-button__icon",
    ".onboarding-entry-import-label",
    ".onboarding-entry-import [data-import-brand='github']",
    ".onboarding-entry-import [data-import-brand='obsidian']",
  ])("opens the common source picker from the import entry (%s)", async (selector) => {
    const onDefaultProjectLocation = vi.fn(async () => null);
    preferences.getState().setExperimentalSettings(ALL_EXPERIMENTAL_IMPORTS);
    const container = renderHome({
      onImportSource: vi.fn(async () => true),
      onChooseWorkspace: vi.fn(async () => undefined),
      onDefaultProjectLocation,
    });

    await act(async () => {
      container.querySelector<HTMLElement>(selector)?.click();
    });
    expect(container.querySelector("[role='dialog']")?.getAttribute("aria-label")).toBe("Import");
    expect(container.querySelectorAll(".onboarding-import-source")).toHaveLength(9);
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

  it("updates the production import preview and open picker from the import preference", async () => {
    const container = renderHome({ onImportSource: vi.fn(async () => true) });
    await act(async () => container.querySelector<HTMLButtonElement>(".onboarding-entry-import")?.click());
    expect(container.querySelector('[data-import-source="obsidian"]')).toBeNull();
    act(() => preferences.getState().setExperimentalSettings(current => ({ ...current, enableOtherAppImports: true })));
    expect(container.querySelector('[data-import-source="obsidian"]')).not.toBeNull();
    expect(container.querySelector(".onboarding-entry-import [data-import-brand='obsidian']")).not.toBeNull();
    expect(JSON.parse(localStorage.getItem("puppyone.desktop.experimental")!).enableOtherAppImports).toBe(true);
  });

  it("keeps remote providers unavailable until direct service adapters exist", async () => {
    const onImportSource = vi.fn(async () => true);
    preferences.getState().setExperimentalSettings(ALL_EXPERIMENTAL_IMPORTS);
    const container = renderHome({
      onImportSource,
    });
    await act(async () => container.querySelector<HTMLButtonElement>(".onboarding-entry-import")?.click());
    for (const source of ["notion", "google-drive", "airtable"]) {
      const button = container.querySelector<HTMLButtonElement>(`.onboarding-import-source[data-import-source='${source}']`);
      expect(button?.dataset.importMode).toBe("remote");
      expect(button?.disabled).toBe(true);
      expect(button?.textContent).toContain("Coming soon");
      await act(async () => button?.click());
    }
    expect(container.querySelector("[role='dialog']")?.getAttribute("aria-label")).toBe("Import");
    expect(onImportSource).not.toHaveBeenCalled();
  });

  it("uses the generic connection and resource picker for a registered SaaS source", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = mountRoot(container);
    const onClose = vi.fn();
    const onConnectSource = vi.fn(async () => ({ connectionId: "session-1" }));
    const onListResources = vi.fn(async () => ({
      items: [{ id: "page-1", name: "Team notes", kind: "document" as const }],
      nextCursor: null,
    }));
    const onImportSource = vi.fn(async () => true);
    act(() => renderWithTestLocalization(root, <OnboardingImportDialog
      onClose={onClose}
      onImportSource={onImportSource}
      onConnectSource={onConnectSource}
      onListResources={onListResources}
      onCancelImport={async () => ({ cancelled: true })}
      onImportProgress={() => () => undefined}
      visibleSources={[{ id: "sample-saas", label: "Sample SaaS", mode: "remote", availability: "experimental", operational: true, preview: false }]}
    />));
    await act(async () => container.querySelector<HTMLButtonElement>("[data-import-source='sample-saas']")?.click());
    expect(container.querySelector("[role='dialog']")?.getAttribute("aria-label")).toBe("Import from Sample SaaS");
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".desktop-dialog-body .desktop-dialog-button.primary")?.click();
      await Promise.resolve();
    });
    expect(onConnectSource).toHaveBeenCalledWith("sample-saas");
    expect(onListResources).toHaveBeenCalledWith({ provider: "sample-saas", connectionId: "session-1", parentId: null, cursor: null });
    await act(async () => container.querySelector<HTMLInputElement>("input[value='page-1']")?.click());
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".desktop-dialog-footer .desktop-dialog-button.primary")?.click();
      await Promise.resolve();
    });
    expect(onImportSource).toHaveBeenCalledWith({
      provider: "sample-saas",
      taskId: expect.any(String),
      selection: { connectionId: "session-1", resourceId: "page-1" },
      locationGrantId: null,
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("lists the folders Obsidian records and adds the chosen ones in place", async () => {
    const onImportSource = vi.fn(async () => true);
    const onListAppFolders = vi.fn(async (app: string) => app === "obsidian" ? [
      { path: "/Users/example/Notes", name: "Notes", lastUsedAt: 2, added: false },
      { path: "/Users/example/Journal", name: "Journal", lastUsedAt: 1, added: true },
    ] : []);
    const onAddAppFolders = vi.fn(async () => ({ added: 1 }));
    preferences.getState().setExperimentalSettings(ALL_EXPERIMENTAL_IMPORTS);
    const container = renderHome({ onImportSource, onListAppFolders, onAddAppFolders });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-onboarding-action='import']")?.click();
    });
    // Apps with nothing recorded on this computer cannot be chosen.
    expect(container.querySelector<HTMLButtonElement>(".onboarding-import-source[data-import-source='vscode']")?.disabled).toBe(true);
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".onboarding-import-source[data-import-source='obsidian']")?.click();
    });
    expect(container.querySelector("[role='dialog']")?.getAttribute("aria-label")).toBe("Add folders from Obsidian");
    const boxes = [...container.querySelectorAll<HTMLInputElement>(".onboarding-import-app-folder input")];
    expect(boxes.map((box) => [box.checked, box.disabled])).toEqual([[false, false], [true, true]]);
    const submit = container.querySelector<HTMLButtonElement>(".desktop-dialog-footer .desktop-dialog-button.primary");
    expect(submit?.disabled).toBe(true);
    await act(async () => boxes[0]?.click());
    expect(submit?.textContent).toBe("Add 1 folder");
    await act(async () => {
      submit?.click();
      await Promise.resolve();
    });
    expect(onAddAppFolders).toHaveBeenCalledWith({ app: "obsidian", paths: ["/Users/example/Notes"] });
    expect(onImportSource).not.toHaveBeenCalled();
    expect(container.querySelector(".onboarding-entry-dialog")).toBeNull();
  });

  it("imports a GitHub repository into the default location without a folder picker", async () => {
    const onImportSource = vi.fn(async () => true);
    const onDefaultProjectLocation = vi.fn(async () => ({
      grantId: "default-1",
      path: "/Users/example/Documents/PuppyOne",
    }));
    const container = renderHome({ onImportSource, onDefaultProjectLocation });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-onboarding-action='import']")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".onboarding-import-source[data-import-source='github']")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector("[role='dialog']")?.getAttribute("aria-label")).toBe("Import from GitHub");
    const providerMarks = Array.from(
      container.querySelectorAll<SVGElement>(".onboarding-clone-provider-marks svg"),
    );
    expect(providerMarks.map((mark) => mark.dataset.repositoryProvider)).toEqual(["github"]);
    expect(providerMarks.every((mark) => mark.getAttribute("fill") === "currentColor")).toBe(true);
    // No standing copy hint (7d1f4b77); a hint appears only for an unsupported URL.
    expect(container.querySelector(".onboarding-clone-hint")).toBeNull();
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
    expect(onImportSource).toHaveBeenCalledWith({
      provider: "github",
      selection: { repositoryUrl: "https://github.com/puppyone-ai/puppyone.git" },
      locationGrantId: "default-1",
      taskId: expect.any(String),
    });
    expect(container.querySelector(".onboarding-entry-dialog")).toBeNull();
  });

  it("auto-detects a GitLab URL and passes a null grant when no default location exists", async () => {
    const onImportSource = vi.fn(async () => true);
    const container = renderHome({ onImportSource });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-onboarding-action='import']")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".onboarding-import-source[data-import-source='gitlab']")?.click();
    });
    const repositoryUrl = container.querySelector<HTMLInputElement>(".onboarding-entry-dialog input");
    setInputValue(repositoryUrl, "git@gitlab.com:puppyone/data/knowledge-base.git");
    expect(container.querySelector<HTMLButtonElement>(".onboarding-entry-dialog button[type='submit']")?.disabled).toBe(false);
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".onboarding-entry-dialog button[type='submit']")?.click();
      await Promise.resolve();
    });
    expect(onImportSource).toHaveBeenCalledWith({
      provider: "gitlab",
      selection: { repositoryUrl: "git@gitlab.com:puppyone/data/knowledge-base.git" },
      locationGrantId: null,
      taskId: expect.any(String),
    });
  });

  it("explains unsupported repository URLs instead of silently disabling Import", async () => {
    const onImportSource = vi.fn(async () => true);
    const container = renderHome({ onImportSource });

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-onboarding-action='import']")?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(".onboarding-import-source[data-import-source='github']")?.click();
    });
    const repositoryUrl = container.querySelector<HTMLInputElement>(".onboarding-entry-dialog input");
    const submitButton = container.querySelector<HTMLButtonElement>(".onboarding-entry-dialog button[type='submit']");
    setInputValue(repositoryUrl, "https://example.com/owner/repository.git");

    expect(repositoryUrl?.getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector(".onboarding-clone-hint")?.textContent).toBe(
      "Enter a GitHub repository URL.",
    );
    expect(container.querySelector(".onboarding-clone-hint")?.getAttribute("role")).toBe("alert");
    expect(submitButton?.disabled).toBe(true);
    expect(onImportSource).not.toHaveBeenCalled();
  });
});
