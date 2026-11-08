/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs";
import { PUPPY_BRAND_MARK_ASSETS } from "../../../../src/components/brand/PuppyBrandMark";
import { EMPTY_STATE_INTRO_FALLBACK_TIMEOUT_MS } from "../../../../src/components/onboarding/emptyStateIntro";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createProjectResult, expectBrandLockup, installFirstLaunchTelemetryBridge, renderHome, requireSurface, setUpOnboardingHome } from "../../../support/react/onboardingHome";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
setUpOnboardingHome();

const agentReadyMessages = {
  de: "Deine Dateien. Für Agents bereit.",
  en: "Start with your files. Agent-ready.",
  es: "Tus archivos. Listos para Agents.",
  fr: "Vos fichiers. Prêts pour les Agents.",
  ja: "自分のファイルから。Agent 対応。",
  ko: "내 파일로 시작. Agent 지원.",
  "pt-BR": "Seus arquivos. Prontos para Agents.",
  "zh-Hans": "从你的文件开始。为 Agent 就绪。",
} as const;

describe("project folder home", () => {
  it("uses the App-owned entry flow without subscribing a second template consumer", async () => {
    const readTemplateImportIntent = vi.fn().mockResolvedValue(null);
    window.puppyoneDesktop = { readTemplateImportIntent } as unknown as NonNullable<typeof window.puppyoneDesktop>;
    const openCreate = vi.fn();
    const projectEntryController = { step: null, templateUrl: null, openCreate,
      openLauncher: vi.fn(), openImport: vi.fn(), openTemplate: vi.fn(), close: vi.fn() };
    const container = renderHome({ projectEntryController,
      onChooseProjectLocation: vi.fn(async () => null), onCreateProject: vi.fn(createProjectResult) });
    await act(async () => container.querySelector<HTMLButtonElement>("[data-onboarding-action='create']")?.click());
    expect(openCreate).toHaveBeenCalledOnce();
    expect(readTemplateImportIntent).not.toHaveBeenCalled();
    expect(document.querySelector(".onboarding-project-dialog")).toBeNull();
  });

  it("localizes the agent-ready brand promise in every renderer locale", () => {
    for (const [locale, expected] of Object.entries(agentReadyMessages)) {
      const messages = JSON.parse(
        readFileSync(`locales/renderer/${locale}/onboarding.json`, "utf8"),
      ) as Record<string, string>;
      expect(messages["brand.agentReadyMessage"], locale).toBe(expected);
    }
  });

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

    const surface = requireSurface(container);
    const homepage = container.querySelector(".onboarding-homepage");
    const actions = container.querySelector(".onboarding-entry-actions");
    const disclosure = container.querySelector("[data-onboarding-telemetry-disclosure]");
    expect(disclosure).not.toBeNull();
    expect(disclosure?.parentElement).toBe(surface);
    expect(homepage!.compareDocumentPosition(disclosure as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(actions?.contains(disclosure)).toBe(false);
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
    expect(container.textContent).not.toContain("Which project do you want to start with?");
    expect(container.textContent).not.toContain("Local Projects");
    expect(container.textContent).not.toContain("Other options");
    expect(container.textContent).not.toContain("Get started with puppyone");
    expectBrandLockup(container, "projects");
    // One quiet New at the page's head, a neutral button rather than a call in colour.
    const projectActions = [...container.querySelectorAll<HTMLButtonElement>(".onboarding-brand-lockup .onboarding-entry-action")];
    expect(projectActions.map((action) => action.textContent)).toEqual(["New project"]);
    expect(projectActions[0]?.classList.contains("po-button--primary")).toBe(false);
    expect(container.querySelector(".onboarding-project-group-head [data-onboarding-action]")).toBeNull();
    act(() => container.querySelector<HTMLButtonElement>("[data-onboarding-action='more']")?.click());
    expect([...container.querySelectorAll(".onboarding-entry-menu [role='menuitem']")].map((item) => item.textContent)).toEqual([
      "Open a folder",
      "Import",
    ]);
    expect(container.querySelector(".onboarding-entry-action-divider")).toBeNull();
    const brand = container.querySelector(".onboarding-brand-lockup");
    const primary = container.querySelector(".onboarding-home-primary");
    const actions = container.querySelector(".onboarding-entry-actions");
    expect(requireSurface(container).dataset.onboardingState).toBe("projects");
    expect(primary?.getAttribute("data-onboarding-primary")).toBe("projects");
    expect(primary?.children).toHaveLength(1);
    expect(container.querySelector(".onboarding-project-list")?.children).toHaveLength(1);
    expect(brand!.compareDocumentPosition(primary as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(actions).toBeNull();
  });

  it("uses Puppy Lite only when the resolved theme is light", () => {
    const container = renderHome({}, { themeMode: "light" });

    expectBrandLockup(
      container,
      "empty",
      PUPPY_BRAND_MARK_ASSETS.lite,
    );
  });

  it("names the product in the Header in words alone", () => {
    const container = renderHome({ projectItems: [{ id: "notes", label: "Notes", localPath: "/Users/example/Notes", lastOpenedAt: null }] });
    const brand = container.querySelector(".desktop-titlebar .onboarding-header-brand");
    expect(brand?.textContent).toBe("puppyone");
    expect(brand?.querySelector("img, svg")).toBeNull();
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
    const list = container.querySelector<HTMLElement>(".onboarding-project-list");
    expect(list?.dataset.poScrollbar).toBe("menu");
    expect(list?.dataset.poScrollbarVisibility).toBe("always");
    expect(list?.tagName).toBe("UL");
    expect(list?.getAttribute("aria-label")).toBe("Projects");
    expect(list?.hasAttribute("tabindex")).toBe(false);
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
    const panel = container.querySelector(".onboarding-home-primary");
    expect(panel?.getAttribute("data-onboarding-primary")).toBe("projects");
    expect(panel?.lastElementChild?.classList.contains("onboarding-project-groups")).toBe(true);
    expect(panel?.lastElementChild?.querySelector('[data-project-group="local-only"] .onboarding-project-list')).not.toBeNull();
    const projectPlace = container.querySelector('[data-project-location="local"] .onboarding-project-row .project-folder-glyph');
    expect(projectPlace).not.toBeNull();
    expect(container.querySelector(".desktop-menu-item-label")?.textContent).toBe("Notes");
    expect(container.querySelector(".desktop-menu-item-detail")?.textContent).toBe("~/Desktop");
    // Opening history is not a project modification timestamp.
    expect(container.querySelector(".desktop-menu-item-trailing")?.textContent ?? "").toBe("");

    await act(async () => container.querySelector<HTMLButtonElement>("[data-onboarding-action='more']")?.click());
    await act(async () => document.body.querySelector<HTMLButtonElement>("[data-onboarding-action='open']")?.click());
    expect(onChooseWorkspace).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector(".onboarding-project-group-menu-surface")).toBeNull();
  });
});
