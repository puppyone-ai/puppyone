/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCloudEnabled, useComputerModeEnabled } from "../../../../src/features/flags";
import { ExperimentalSettingsView } from "../../../../src/features/settings/main/ExperimentalSettingsView";
import { DEFAULT_EXPERIMENTAL_SETTINGS } from "../../../../src/preferences";
import { desktopPreferencesStore as store, initializeDesktopPreferences } from "../../../../src/preferencesStore";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function FlagProbe() {
  const computerMode = useComputerModeEnabled();
  const cloudEnabled = useCloudEnabled();
  return (
    <output
      data-computer-mode={String(computerMode)}
      data-cloud-enabled={String(cloudEnabled)}
    />
  );
}

beforeEach(() => {
  localStorage.clear();
  initializeDesktopPreferences();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  delete (window as { puppyoneDesktop?: unknown }).puppyoneDesktop;
});

describe("Computer Mode experimental setting", () => {
  it("defaults off, activates Computer Mode and Cloud Computer access on toggle, and notifies Main on opt-out", () => {
    const setExperimentalOptIn = vi.fn(async () => ({
      experimentalEnabled: false,
      runtime: { available: true, engine: "lima" as const, limactlPath: "/opt/mock/limactl", architecture: "arm64", platform: "darwin" },
      computers: [],
    }));
    (window as { puppyoneDesktop?: unknown }).puppyoneDesktop = {
      localComputers: {
        getSnapshot: vi.fn(async () => ({
          experimentalEnabled: false,
          runtime: { available: true, engine: "lima" as const, limactlPath: "/opt/mock/limactl", architecture: "arm64", platform: "darwin" },
          computers: [],
        })),
        setExperimentalOptIn,
        register: vi.fn(),
        wake: vi.fn(),
        sleep: vi.fn(),
        provisionDesktop: vi.fn(),
        remove: vi.fn(),
        connectScreen: vi.fn(),
        onChanged: () => () => {},
      },
    };

    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    act(() => {
      root?.render(withTestLocalization(
        <>
          <ExperimentalSettingsView />
          <FlagProbe />
        </>,
      ));
    });

    expect(DEFAULT_EXPERIMENTAL_SETTINGS.enableComputerMode).toBe(false);
    const probe = host.querySelector("output")!;
    expect(probe.getAttribute("data-computer-mode")).toBe("false");
    expect(probe.getAttribute("data-cloud-enabled")).toBe("false");

    const toggle = host.querySelector<HTMLInputElement>('input[aria-label="Computer mode"]');
    expect(toggle).not.toBeNull();
    expect(toggle?.checked).toBe(false);

    act(() => {
      toggle?.click();
    });

    expect(store.getState().experimentalSettings.enableComputerMode).toBe(true);
    expect(probe.getAttribute("data-computer-mode")).toBe("true");
    expect(probe.getAttribute("data-cloud-enabled")).toBe("true");
    expect(setExperimentalOptIn).toHaveBeenLastCalledWith({ enabled: true });

    act(() => {
      toggle?.click();
    });

    expect(store.getState().experimentalSettings.enableComputerMode).toBe(false);
    expect(probe.getAttribute("data-computer-mode")).toBe("false");
    expect(setExperimentalOptIn).toHaveBeenLastCalledWith({ enabled: false });
  });
});
