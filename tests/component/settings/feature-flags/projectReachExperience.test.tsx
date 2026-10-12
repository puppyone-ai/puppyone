/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useProjectReachExperience } from "../../../../src/features/project-reach";
import { ExperimentalSettingsView } from "../../../../src/features/settings/main/ExperimentalSettingsView";
import { DEFAULT_EXPERIMENTAL_SETTINGS } from "../../../../src/preferences";
import { desktopPreferencesStore as store, initializeDesktopPreferences } from "../../../../src/preferencesStore";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const label = "Who can reach this project";

let root: Root | null = null;

beforeEach(() => { localStorage.clear(); initializeDesktopPreferences(); });

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

function render(node: React.ReactNode): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(withTestLocalization(node)));
  return host;
}

/** Surfaces fork on the hook, so the probe stands in for a render entry. */
function ReachProbe() {
  return <span data-testid="path">{useProjectReachExperience() ? "project reach" : "existing"}</span>;
}

describe("project reach experiment", () => {
  it("offers one default-off switch in Header settings and keeps every other experiment where it was", () => {
    const host = render(<ExperimentalSettingsView />);
    const toggle = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    const group = toggle.closest(".desktop-settings-subsection");

    expect(group?.querySelector("h3")?.textContent).toBe("Header & layout");
    expect(toggle.checked).toBe(false);
    expect(toggle.getAttribute("aria-description")).toBe(
      "Show who and which Agents can reach the current project in the Header, invite a person or connect"
      + " an Agent from one screen, and keep changes made elsewhere waiting for your review.",
    );

    act(() => toggle.click());
    expect(store.getState().experimentalSettings).toEqual({ ...DEFAULT_EXPERIMENTAL_SETTINGS, enableProjectReach: true });

    act(() => toggle.click());
    expect(store.getState().experimentalSettings).toEqual(DEFAULT_EXPERIMENTAL_SETTINGS);
  });

  it("restores explicit consent from the existing experimental key without a migration", () => {
    const host = render(<ExperimentalSettingsView />);
    const toggle = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;

    act(() => toggle.click());
    act(() => initializeDesktopPreferences());

    expect(JSON.parse(localStorage.getItem("puppyone.desktop.experimental")!).enableProjectReach).toBe(true);
    expect(toggle.checked).toBe(true);
  });

  it("gives every render entry the same decision through the single consumption point", () => {
    const host = render(<><ExperimentalSettingsView /><ReachProbe /></>);
    const toggle = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    const path = () => host.querySelector('[data-testid="path"]')?.textContent;

    expect(path()).toBe("existing");

    act(() => toggle.click());
    expect(path()).toBe("project reach");

    act(() => store.getState().setExperimentalSettings(settings => ({ ...settings, enableProjectReach: false })));
    expect(path()).toBe("existing");
    expect(toggle.checked).toBe(false);
  });
});
