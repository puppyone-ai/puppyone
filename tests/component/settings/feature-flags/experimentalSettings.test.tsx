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
  it("keeps file tabs last in Header settings and uses alignment choices and retires the Git card switch", () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(withTestLocalization(<ExperimentalSettingsView />)));
    const groups = [...host.querySelectorAll(".desktop-settings-subsection")];
    expect(groups.map((group) => group.querySelector("h3")?.textContent)).toEqual([
      "Header & layout", "Markdown", "Imports & plugins", "Cloud & automation",
    ]);
    const toggles = [...groups[0]!.querySelectorAll("input")];
    expect(toggles.at(-1)?.getAttribute("aria-label")).toBe("File tabs in Header");
    expect(host.querySelector('input[aria-label="Git card in Header"]')).toBeNull();
    expect(host.querySelector('input[aria-label="Center project in Header"]')).toBeNull();
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

    const toggle = host.querySelector<HTMLInputElement>('input[aria-label="PuppyOne Cloud"]');
    expect(toggle?.checked).toBe(false);
    act(() => toggle?.click());
    expect(store.getState().experimentalSettings).toEqual({
      ...DEFAULT_EXPERIMENTAL_SETTINGS,
      enableCloudWorkspace: true,
    });
    expect(host.querySelector('input[aria-label="Cloud agents in sidebar"]')).toBeNull();
    expect(host.querySelector('input[aria-label="Editor save status"]')).toBeNull();
  });

  it("ships Share from the Header on, with its own switch to hide the Header entry", () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(withTestLocalization(
      <ExperimentalSettingsView />,
    )));

    const toggle = host.querySelector<HTMLInputElement>('input[aria-label="Share from the Header"]');
    expect(toggle?.checked).toBe(true);
    act(() => toggle?.click());
    expect(store.getState().experimentalSettings).toEqual({
      ...DEFAULT_EXPERIMENTAL_SETTINGS,
      enableShareOnboarding: false,
    });
  });

  it("offers an off-by-default cross-Project switcher rail", () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    act(() => root?.render(withTestLocalization(
      <ExperimentalSettingsView />,
    )));

    const toggle = host.querySelector<HTMLInputElement>(
      'input[aria-label="Project switcher rail"]',
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.checked).toBe(false);
    expect(host.querySelector('input[aria-label="Agent Chat"]')).toBeNull();

    act(() => toggle?.click());
    expect(store.getState().experimentalSettings).toEqual({
      ...DEFAULT_EXPERIMENTAL_SETTINGS,
      enableProjectSwitcherRail: true,
    });
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

  it("offers an off-by-default onboarding replay switch", () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    act(() => root?.render(withTestLocalization(
      <ExperimentalSettingsView />,
    )));

    const toggle = host.querySelector<HTMLInputElement>(
      'input[aria-label="Always show onboarding hints"]',
    );
    expect(toggle?.checked).toBe(false);
    act(() => toggle?.click());
    expect(store.getState().experimentalSettings).toEqual({
      ...DEFAULT_EXPERIMENTAL_SETTINGS,
      enableAlwaysShowOnboardingCoachmarks: true,
    });
  });

  it("offers an off-by-default first-project starting-point opt-in", () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    act(() => root?.render(withTestLocalization(
      <ExperimentalSettingsView />,
    )));

    const toggle = host.querySelector<HTMLInputElement>(
      'input[aria-label="First project starting point"]',
    );
    expect(toggle).toBeNull();
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
