import { initializeDesktopPreferences, desktopPreferencesStore as store } from "../../../../src/preferencesStore";
/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExperimentalSettingsView } from "../../../../src/features/settings/main/ExperimentalSettingsView";
import { DEFAULT_EXPERIMENTAL_SETTINGS } from "../../../../src/preferences";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => { localStorage.clear(); initializeDesktopPreferences(); });

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("Experimental settings", () => {
  it("persists exclusive location and chat placement choices independently and restores the original defaults", () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(withTestLocalization(<ExperimentalSettingsView />)));
    const locationGroup = host.querySelector('[role="group"][aria-label="Local / Cloud switch position"]')!;
    const chatGroup = host.querySelector('[role="group"][aria-label="Chat tabs position"]')!;
    const [menu, locationHeader] = [...locationGroup.querySelectorAll<HTMLButtonElement>("button")];
    const [sidebar, chatHeader] = [...chatGroup.querySelectorAll<HTMLButtonElement>("button")];
    expect([menu.textContent, locationHeader.textContent]).toEqual(["Menu", "Header"]);
    expect([sidebar.textContent, chatHeader.textContent]).toEqual(["Sidebar", "Header"]);
    expect(menu.getAttribute("aria-pressed")).toBe("true");
    expect(sidebar.getAttribute("aria-pressed")).toBe("true");
    expect(locationGroup.closest(".desktop-settings-subsection")?.querySelector("h3")?.textContent).toBe("Header & layout");
    act(() => locationHeader.click());
    expect(store.getState().experimentalSettings).toEqual({ ...DEFAULT_EXPERIMENTAL_SETTINGS, enableProjectLocationIconsInHeader: true });
    act(() => chatHeader.click());
    expect(store.getState().experimentalSettings).toEqual({ ...DEFAULT_EXPERIMENTAL_SETTINGS,
      enableProjectLocationIconsInHeader: true, enableWorkbenchTabsInHeader: true });
    act(() => initializeDesktopPreferences());
    expect(locationHeader.getAttribute("aria-pressed")).toBe("true");
    expect(menu.getAttribute("aria-pressed")).toBe("false");
    expect(chatHeader.getAttribute("aria-pressed")).toBe("true");
    expect(sidebar.getAttribute("aria-pressed")).toBe("false");
    act(() => menu.click());
    expect(chatHeader.getAttribute("aria-pressed")).toBe("true");
    act(() => sidebar.click());
    act(() => initializeDesktopPreferences());
    expect(store.getState().experimentalSettings).toEqual(DEFAULT_EXPERIMENTAL_SETTINGS);
  });
  it("keeps file navigation last in Header settings and preserves its pane/Header choice", () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(withTestLocalization(<ExperimentalSettingsView />)));
    const groups = [...host.querySelectorAll(".desktop-settings-subsection")];
    expect(groups.map((group) => group.querySelector("h3")?.textContent)).toEqual([
      "Header & layout", "Markdown", "Imports & plugins", "Cloud & automation", "Homepage",
    ]);
    const rows = [...groups[0]!.querySelectorAll(".desktop-settings-row")];
    const fileGroup = rows.at(-1)?.querySelector('[role="group"][aria-label="File navigation"]')!;
    const [panes, header] = [...fileGroup.querySelectorAll<HTMLButtonElement>("button")];
    expect([panes.textContent, header.textContent]).toEqual(["Panes", "Header tabs"]);
    expect(panes.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('input[aria-label="Git card in Header"]')).toBeNull();
    expect(host.querySelector('input[aria-label="Center project in Header"]')).toBeNull();
    expect(store.getState().experimentalSettings).toEqual(DEFAULT_EXPERIMENTAL_SETTINGS);
    act(() => header.click());
    act(() => initializeDesktopPreferences());
    expect(store.getState().experimentalSettings).toEqual({ ...DEFAULT_EXPERIMENTAL_SETTINGS, enableEditorTabsInHeader: true });
    expect(header.getAttribute("aria-pressed")).toBe("true");
    act(() => panes.click());
    expect(store.getState().experimentalSettings).toEqual(DEFAULT_EXPERIMENTAL_SETTINGS);
  });

  it("persists mutually exclusive Left / Center choices and defaults to Left", () => {
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    act(() => root?.render(withTestLocalization(<ExperimentalSettingsView />)));
    const group = host.querySelector('[role="group"][aria-label="Project header position"]')!;
    const [left, center] = [...group.querySelectorAll<HTMLButtonElement>("button")];
    expect(left.textContent).toBe("Left"); expect(center.textContent).toBe("Center");
    expect(left.getAttribute("aria-pressed")).toBe("true");
    act(() => center.click());
    expect(center.getAttribute("aria-pressed")).toBe("true"); expect(left.getAttribute("aria-pressed")).toBe("false");
    act(() => initializeDesktopPreferences());
    expect(store.getState().experimentalSettings.enableCenteredProjectInHeader).toBe(true);
    expect(store.getState().experimentalSettings.enableCloudWorkspace).toBe(false);
    act(() => left.click());
    expect(store.getState().experimentalSettings.enableCenteredProjectInHeader).toBe(false);
  });

  it("offers one default-off import experiment", () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    act(() => root?.render(withTestLocalization(
      <ExperimentalSettingsView />,
    )));

    const toggle = host.querySelector<HTMLInputElement>('input[aria-label="Import from other apps"]');
    expect(toggle?.checked).toBe(false);
    act(() => toggle?.click());
    expect(store.getState().experimentalSettings).toEqual({
      ...DEFAULT_EXPERIMENTAL_SETTINGS,
      enableOtherAppImports: true,
    });
  });

  it("keeps Cloud experimental while Built-in Agent is publicly available", () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(withTestLocalization(
      <ExperimentalSettingsView />,
    )));
    expect(host.querySelector('input[aria-label="Built-in Agent"]')).toBeNull();
    expect(DEFAULT_EXPERIMENTAL_SETTINGS.enableCloudWorkspace).toBe(false);
  });

  it("uses the Cloud switch for hosting and sharing", () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(withTestLocalization(
      <ExperimentalSettingsView />,
    )));

    const toggle = host.querySelector<HTMLInputElement>('input[aria-label="Puppyone Cloud"]');
    expect(toggle?.checked).toBe(false);
    act(() => toggle?.click());
    expect(store.getState().experimentalSettings).toEqual({
      ...DEFAULT_EXPERIMENTAL_SETTINGS,
      enableCloudWorkspace: true,
    });
    expect(host.querySelector('input[aria-label="Cloud agents in sidebar"]')).toBeNull();
    expect(host.querySelector('input[aria-label="Editor save status"]')).toBeNull();
  });

  it("keeps project sharing as an enabled-by-default feature switch", () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(withTestLocalization(
      <ExperimentalSettingsView />,
    )));

    const toggle = host.querySelector<HTMLInputElement>('input[aria-label="Project sharing"]');
    expect(toggle?.checked).toBe(true);
    act(() => toggle?.click());
    expect(store.getState().experimentalSettings).toEqual({
      ...DEFAULT_EXPERIMENTAL_SETTINGS,
      enableShareOnboarding: false,
    });
  });

  it("offers Header menu / Sidebar project switching choices and preserves the saved position", () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    act(() => root?.render(withTestLocalization(
      <ExperimentalSettingsView />,
    )));

    const group = host.querySelector('[role="group"][aria-label="Project switcher position"]')!;
    const [menu, sidebar] = [...group.querySelectorAll<HTMLButtonElement>("button")];
    expect([menu.textContent, sidebar.textContent]).toEqual(["Header menu", "Sidebar"]);
    expect(menu.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('input[aria-label="Agent Chat"]')).toBeNull();

    act(() => sidebar.click());
    act(() => initializeDesktopPreferences());
    expect(store.getState().experimentalSettings).toEqual({
      ...DEFAULT_EXPERIMENTAL_SETTINGS,
      enableProjectSwitcherRail: true,
    });
    expect(sidebar.getAttribute("aria-pressed")).toBe("true");
    expect(menu.getAttribute("aria-pressed")).toBe("false");
    act(() => menu.click());
    expect(store.getState().experimentalSettings).toEqual(DEFAULT_EXPERIMENTAL_SETTINGS);
  });

  it("offers an off-by-default multi-project Workspace opt-in", () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    act(() => root?.render(withTestLocalization(
      <ExperimentalSettingsView />,
    )));

    const toggle = host.querySelector<HTMLInputElement>(
      'input[aria-label="Multi-project workspaces"]',
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.checked).toBe(false);

    act(() => toggle?.click());
    expect(store.getState().experimentalSettings).toEqual({
      ...DEFAULT_EXPERIMENTAL_SETTINGS,
      enableMultiRootWorkspaces: true,
    });
  });

  it("offers Once / Repeat onboarding hints without disabling hints", () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    act(() => root?.render(withTestLocalization(
      <ExperimentalSettingsView />,
    )));

    const group = host.querySelector('[role="group"][aria-label="Onboarding hint frequency"]')!;
    const [once, repeat] = [...group.querySelectorAll<HTMLButtonElement>("button")];
    expect([once.textContent, repeat.textContent]).toEqual(["Once", "Repeat"]);
    expect(once.getAttribute("aria-pressed")).toBe("true");
    act(() => repeat.click());
    act(() => initializeDesktopPreferences());
    expect(store.getState().experimentalSettings).toEqual({
      ...DEFAULT_EXPERIMENTAL_SETTINGS,
      enableAlwaysShowOnboardingCoachmarks: true,
    });
    expect(repeat.getAttribute("aria-pressed")).toBe("true");
    expect(once.getAttribute("aria-pressed")).toBe("false");
    act(() => once.click());
    expect(store.getState().experimentalSettings).toEqual(DEFAULT_EXPERIMENTAL_SETTINGS);
  });

  it("restores List / Cards homepage choices at the end and lets saved card users return to List", () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => store.getState().setExperimentalSettings(s => ({ ...s, enableAssetLibraryHome: true })));

    act(() => root?.render(withTestLocalization(
      <ExperimentalSettingsView />,
    )));

    const lastSection = [...host.querySelectorAll(".desktop-settings-subsection")].at(-1)!;
    expect(lastSection.querySelector("h3")?.textContent).toBe("Homepage");
    const group = lastSection.querySelector('[role="group"][aria-label="Project homepage"]')!;
    const [list, cards] = [...group.querySelectorAll<HTMLButtonElement>("button")];
    expect([list.textContent, cards.textContent]).toEqual(["List", "Cards"]);
    expect(cards.getAttribute("aria-pressed")).toBe("true");
    expect(store.getState().experimentalSettings).toEqual({ ...DEFAULT_EXPERIMENTAL_SETTINGS, enableAssetLibraryHome: true });
    act(() => list.click());
    act(() => initializeDesktopPreferences());
    expect(list.getAttribute("aria-pressed")).toBe("true");
    expect(cards.getAttribute("aria-pressed")).toBe("false");
    expect(store.getState().experimentalSettings).toEqual(DEFAULT_EXPERIMENTAL_SETTINGS);
  });

  it("offers an off-by-default Automation opt-in", () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    act(() => root?.render(withTestLocalization(
      <ExperimentalSettingsView />,
    )));

    const toggle = host.querySelector<HTMLInputElement>('input[aria-label="Automation"]');
    expect(toggle).not.toBeNull();
    expect(toggle?.checked).toBe(false);

    act(() => toggle?.click());
    expect(store.getState().experimentalSettings).toEqual({
      ...DEFAULT_EXPERIMENTAL_SETTINGS,
      enableCloudAutomation: true,
    });
  });
});
