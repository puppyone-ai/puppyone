/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureFlagsProvider, useHostDevicesEnabled } from "../../../../src/features/flags";
import { ExperimentalSettingsView } from "../../../../src/features/settings/main/ExperimentalSettingsView";
import { desktopPreferencesStore as store, initializeDesktopPreferences } from "../../../../src/preferencesStore";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rollout = vi.hoisted(() => ({ available: true }));
vi.mock("../../../../shared/host-contract/rollout.mjs", () => ({
  get HOST_DEVICES_AVAILABLE() { return rollout.available; },
}));
let root: Root | null = null;
beforeEach(() => { rollout.available = true; vi.stubEnv("VITE_HOST_DEVICES_ENABLED", "false"); localStorage.clear(); initializeDesktopPreferences(); });
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  localStorage.clear();
  vi.unstubAllEnvs();
});

function HostDevicesProbe() {
  return <output data-testid="other-computers">{String(useHostDevicesEnabled())}</output>;
}

function render(accounts = true) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(withTestLocalization(
    <FeatureFlagsProvider value={{ cloudWorkspace: accounts, cloudBilling: false }}>
      <ExperimentalSettingsView /><HostDevicesProbe />
    </FeatureFlagsProvider>,
  )));
  return container;
}

describe("Other computers experiment", () => {
  it("hides the experiment and ignores an old enabled preference outside the rollout", () => {
    rollout.available = false;
    vi.stubEnv("VITE_HOST_DEVICES_ENABLED", "true");
    localStorage.setItem("puppyone.desktop.experimental", JSON.stringify({ enableHostDevices: true }));
    initializeDesktopPreferences();
    const container = render();
    expect(container.querySelector('input[aria-label="Other computers"]')).toBeNull();
    expect(container.querySelector('[data-testid="other-computers"]')?.textContent).toBe("false");
    expect(store.getState().experimentalSettings.enableHostDevices).toBe(true);
  });

  it("is off by default, switches immediately without Cloud, and restores both saved choices", () => {
    const container = render();
    const toggle = container.querySelector<HTMLInputElement>('input[aria-label="Other computers"]')!;
    const enabled = () => container.querySelector('[data-testid="other-computers"]')?.textContent;
    expect(toggle.checked).toBe(false);
    expect(enabled()).toBe("false");
    expect(store.getState().experimentalSettings.enableCloudWorkspace).toBe(false);
    act(() => toggle.click());
    expect(enabled()).toBe("true");
    expect(store.getState().experimentalSettings.enableCloudWorkspace).toBe(false);
    act(() => initializeDesktopPreferences());
    expect(toggle.checked).toBe(true);
    expect(enabled()).toBe("true");
    act(() => toggle.click());
    act(() => initializeDesktopPreferences());
    expect(toggle.checked).toBe(false);
    expect(enabled()).toBe("false");
  });

  it("uses the old environment flag only until the user saves a choice", () => {
    vi.stubEnv("VITE_HOST_DEVICES_ENABLED", "true");
    // An older preferences document has no choice for this experiment yet.
    localStorage.setItem("puppyone.desktop.experimental", JSON.stringify({ enableCloudWorkspace: false }));
    initializeDesktopPreferences();
    const container = render();
    const toggle = container.querySelector<HTMLInputElement>('input[aria-label="Other computers"]')!;
    expect(toggle.checked).toBe(true);
    act(() => toggle.click());
    act(() => initializeDesktopPreferences());
    expect(toggle.checked).toBe(false);
    expect(container.querySelector('[data-testid="other-computers"]')?.textContent).toBe("false");
  });

  it("does not offer or activate account features in a build without accounts", () => {
    store.getState().setExperimentalSettings(settings => ({ ...settings, enableHostDevices: true }));
    const container = render(false);
    expect(container.querySelector('input[aria-label="Other computers"]')).toBeNull();
    expect(container.querySelector('[data-testid="other-computers"]')?.textContent).toBe("false");
  });
});
