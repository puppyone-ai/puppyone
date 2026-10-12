/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExperimentalSettingsView } from "../../../../src/features/settings/main/ExperimentalSettingsView";
import { useProjectReachExperience } from "../../../../src/features/project-reach/useProjectReachExperience";
import { DEFAULT_EXPERIMENTAL_SETTINGS, parseExperimentalSettings } from "../../../../src/preferences";
import {
  desktopPreferencesStore as store,
  initializeDesktopPreferences,
} from "../../../../src/preferencesStore";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

beforeEach(() => {
  localStorage.clear();
  initializeDesktopPreferences();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

function ReachProbe() {
  return <span className="reach-probe">{useProjectReachExperience() ? "on" : "off"}</span>;
}

function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(withTestLocalization(node)));
  return host;
}

describe("Project Reach experience switch", () => {
  it("stays off until the user opts in and never migrates stored preferences", () => {
    expect(DEFAULT_EXPERIMENTAL_SETTINGS.enableProjectReach).toBe(false);
    expect(parseExperimentalSettings(null).enableProjectReach).toBe(false);
    expect(parseExperimentalSettings("not-json").enableProjectReach).toBe(false);
    expect(parseExperimentalSettings(JSON.stringify({})).enableProjectReach).toBe(false);
    expect(parseExperimentalSettings(JSON.stringify({ enableProjectReach: "true" })).enableProjectReach)
      .toBe(false);
    expect(parseExperimentalSettings(JSON.stringify({ enableProjectReach: true })).enableProjectReach)
      .toBe(true);
  });

  it("describes the consequence in one Header & layout row and persists the opt-in", () => {
    const host = render(<ExperimentalSettingsView />);
    const toggle = host.querySelector<HTMLInputElement>('input[aria-label="Project reach"]');

    expect(toggle?.checked).toBe(false);
    expect(toggle?.closest(".desktop-settings-subsection")?.querySelector("h3")?.textContent)
      .toBe("Header & layout");
    expect(toggle?.getAttribute("aria-description"))
      .toBe(
        "Show who can reach this project, invite people and agents from one screen, "
        + "and keep changes made elsewhere waiting for your review.",
      );

    act(() => toggle?.click());

    expect(store.getState().experimentalSettings).toEqual({
      ...DEFAULT_EXPERIMENTAL_SETTINGS,
      enableProjectReach: true,
    });

    act(() => initializeDesktopPreferences());
    expect(store.getState().experimentalSettings.enableProjectReach).toBe(true);
  });

  it("resolves every fork through one decision point", () => {
    const host = render(<ReachProbe />);
    expect(host.querySelector(".reach-probe")?.textContent).toBe("off");

    act(() => store.getState().setExperimentalSettings({
      ...store.getState().experimentalSettings,
      enableProjectReach: true,
    }));

    expect(host.querySelector(".reach-probe")?.textContent).toBe("on");
  });
});
