/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs";
import { EMPTY_STATE_INTRO_FALLBACK_TIMEOUT_MS } from "../../../../src/components/onboarding/emptyStateIntro";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createProjectResult, expectBrandLockup, installFirstLaunchTelemetryBridge, renderHome, requireSurface, setUpOnboardingHome } from "../../../support/react/onboardingHome";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
setUpOnboardingHome();

const valueTitles = {
  de: "Was deine Agents erstellen,\ngehört dir",
  en: "What your Agents make\nis yours to keep",
  es: "Lo que crean tus Agents\nes tuyo",
  fr: "Ce que vos Agents créent\nvous appartient",
  ja: "Agent が作ったものは、\nあなたの資産です",
  ko: "Agent가 만든 것은\n모두 내 자산입니다",
  "pt-BR": "O que seus Agents criam\né seu",
  "zh-Hans": "Agent 做的东西，\n都是你的资产",
} as const;

describe("project folder home", () => {
  it("uses the App-owned entry flow without subscribing a second template consumer", async () => {
    const readTemplateImportIntent = vi.fn().mockResolvedValue(null);
    window.puppyoneDesktop = { readTemplateImportIntent } as unknown as NonNullable<typeof window.puppyoneDesktop>;
    const openCreate = vi.fn();
    const projectEntryController = { step: null, templateUrl: null, templateCopied: false, agentRuntimeId: null, openCreate,
      openAgentStart: vi.fn(), openLauncher: vi.fn(), openImport: vi.fn(), openTemplate: vi.fn(), close: vi.fn() };
    const container = renderHome({ projectEntryController,
      onChooseProjectLocation: vi.fn(async () => null), onCreateProject: vi.fn(createProjectResult) });
    await act(async () => container.querySelector<HTMLButtonElement>("[data-onboarding-action='create']")?.click());
    expect(openCreate).toHaveBeenCalledOnce();
    expect(readTemplateImportIntent).not.toHaveBeenCalled();
    expect(document.querySelector(".onboarding-project-dialog")).toBeNull();
  });

  it("localizes the first-run value promise in every renderer locale", () => {
    const english = JSON.parse(readFileSync("locales/renderer/en/onboarding.json", "utf8")) as Record<string, string>;
    const valueKeys = Object.keys(english).filter((key) => key.startsWith("value.")).sort();
    for (const [locale, expected] of Object.entries(valueTitles)) {
      const messages = JSON.parse(
        readFileSync(`locales/renderer/${locale}/onboarding.json`, "utf8"),
      ) as Record<string, string>;
      expect(messages["value.assets.title"], locale).toBe(expected);
      expect(Object.keys(messages).filter((key) => key.startsWith("value.")).sort(), locale).toEqual(valueKeys);
      // The picture shows the files and the Agents; the line under each title stays one breath long.
      for (const moment of ["assets", "edit", "forward"]) {
        expect(messages[`value.${moment}.body`]?.length, `${locale} ${moment}`).toBeLessThanOrEqual(130);
      }
      expect(messages, locale).not.toHaveProperty("brand.agentReadyMessage");
    }
  });

  it("pictures every kind of file among the Agents on first run only", () => {
    const empty = renderHome({ projectItems: [] });
    const carousel = empty.querySelector(".onboarding-home-value > .onboarding-value-carousel");
    expect(carousel?.nextElementSibling?.classList.contains("onboarding-launcher")).toBe(true);
    expect(carousel!.querySelector(".onboarding-value-stage")?.getAttribute("aria-hidden")).toBe("true");
    const hub = carousel!.querySelector(".onboarding-value-slide.is-active .onboarding-value-hub")!;
    // One pile, back to front: the folder last, the page itself first.
    expect([...hub.querySelectorAll(".onboarding-value-card > b")].map((tag) => tag.textContent))
      .toEqual(["Folder", "CSV", "MD", "HTML"]);
    // An odd number of Agents, so the ring never reads as a symmetric diagram.
    expect(hub.querySelectorAll(".onboarding-value-agent")).toHaveLength(7);
    expect(hub.querySelector(".onboarding-value-hub-label")?.textContent).toBe("Your project");
  });

  it("plays the three moments in their order, by its dots or when a moment is over", () => {
    const container = renderHome({ projectItems: [] });
    const moment = () => ({
      picture: container.querySelector(".onboarding-value-slide.is-active")?.getAttribute("data-value-slide"),
      title: container.querySelector(".onboarding-brand-copy.is-active .onboarding-brand-name")?.textContent,
      hidden: [...container.querySelectorAll(".onboarding-brand-copy")].map((copy) => copy.getAttribute("aria-hidden")),
      current: [...container.querySelectorAll(".onboarding-value-dot")].map((dot) => dot.getAttribute("aria-current")),
    });
    const dots = [...container.querySelectorAll<HTMLButtonElement>(".onboarding-value-dot")];
    expect(dots.map((dot) => dot.getAttribute("aria-label"))).toEqual(["Your assets", "Circle to edit", "Hand to an Agent"]);
    expect(moment()).toEqual({ picture: "assets", title: "What your Agents make\nis yours to keep",
      hidden: [null, "true", "true"], current: ["true", null, null] });

    act(() => dots[2]!.click());
    expect(moment()).toEqual({ picture: "forward", title: "Hand the link to an Agent\nand it takes over",
      hidden: ["true", "true", null], current: [null, null, "true"] });

    // The open dot's fill ending is what moves the story on, and the last moment leads back to the first.
    const finish = () => act(() => {
      container.querySelector(".onboarding-value-dot.is-active > i")!.dispatchEvent(new Event("animationend", { bubbles: true }));
    });
    finish();
    expect(moment().picture).toBe("assets");
    finish();
    expect(moment()).toMatchObject({ picture: "edit", title: "Circle it, say it,\nand it’s done" });
  });

  it("leaves the moments out once there are projects", () => {
    const container = renderHome({ projectItems: [{ id: "notes", label: "Notes", localPath: "/example/Notes" }] });
    expect(container.querySelector(".onboarding-value-carousel")).toBeNull();
    expect(container.querySelector(".onboarding-brand-moments")).toBeNull();
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
    // Three visible place actions sit on the left of the head, without an arrow menu.
    const projectActions = [...container.querySelectorAll<HTMLButtonElement>(".onboarding-brand-lockup .onboarding-entry-action")];
    expect(projectActions.map((action) => action.textContent)).toEqual(["New project", "Open a folder", "Import"]);
    expect(projectActions[0]?.classList.contains("po-button--primary")).toBe(false);
    expect(container.querySelector(".onboarding-project-group-head [data-onboarding-action]")).toBeNull();
    expect(container.querySelector("[data-onboarding-action='more']")).toBeNull();
    expect(container.querySelector(".onboarding-entry-action-divider")).toBeNull();
    const brand = container.querySelector(".onboarding-brand-lockup");
    const primary = container.querySelector(".onboarding-home-primary");
    const actions = container.querySelector(".onboarding-entry-actions");
    expect(requireSurface(container).dataset.onboardingState).toBe("projects");
    expect(primary?.getAttribute("data-onboarding-primary")).toBe("projects");
    expect([...primary!.children].map((child) => child.className)).toEqual([
      "onboarding-projects-head",
      "onboarding-project-groups",
    ]);
    expect(container.querySelector(".onboarding-project-list")?.children).toHaveLength(1);
    expect(brand!.compareDocumentPosition(primary as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(actions).toBeNull();
  });

  it("tells first run's story without a mark in either theme", () => {
    expectBrandLockup(renderHome({}, { themeMode: "light" }));
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

    await act(async () => container.querySelector<HTMLButtonElement>("[data-onboarding-action='open']")?.click());
    expect(onChooseWorkspace).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector(".onboarding-project-group-menu-surface")).toBeNull();
  });
});
