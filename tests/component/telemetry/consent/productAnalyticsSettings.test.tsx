/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductAnalyticsSettingsRow } from "../../../../src/features/settings/main/ProductAnalyticsSettingsRow";
import { PrivacySettingsView } from "../../../../src/features/settings/main/PrivacySettingsView";
import type { DesktopTelemetryState } from "../src/types/electron";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root?.unmount());
  root = null;
  await act(async () => { await Promise.resolve(); });
  delete window.puppyoneDesktop;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("Product analytics setting", () => {
  it("uses the standard one-line Settings row and defaults on", async () => {
    const bridge = installTelemetryBridge(telemetryState());
    await renderProductAnalyticsSetting();

    const row = container.querySelector(".desktop-settings-row.desktop-settings-row-control");
    const toggle = findToggle();
    expect(row).not.toBeNull();
    expect(container.querySelector(".desktop-settings-section-header")).toBeNull();
    expect(toggle.checked).toBe(true);
    expect(toggle.disabled).toBe(false);

    await act(async () => toggle.click());
    expect(bridge.setTelemetryLevel).toHaveBeenLastCalledWith({ level: "off" });
    await vi.waitFor(() => expect(toggle.checked).toBe(false));

    await act(async () => toggle.click());
    expect(bridge.setTelemetryLevel).toHaveBeenLastCalledWith({ level: "basic" });
    await vi.waitFor(() => expect(toggle.checked).toBe(true));
  });

  it("lets development builds save the preference without making them eligible to upload", async () => {
    const bridge = installTelemetryBridge(telemetryState({
      eligible: false,
      level: "off",
      effectiveLevel: "off",
      enabled: false,
      disabledReason: "unpackaged-build",
    }));
    await renderProductAnalyticsSetting();

    const toggle = findToggle();
    expect(toggle.checked).toBe(false);
    expect(toggle.disabled).toBe(false);

    await act(async () => toggle.click());
    expect(bridge.setTelemetryLevel).toHaveBeenLastCalledWith({ level: "basic" });
    await vi.waitFor(() => expect(toggle.checked).toBe(true));
  });

  it("presents an outdated privacy notice as off until the user explicitly enables it", async () => {
    const bridge = installTelemetryBridge(telemetryState({
      effectiveLevel: "off",
      enabled: false,
      disabledReason: "notice-required",
      noticeSeenVersion: 1,
      noticeRequired: true,
    }));
    await renderProductAnalyticsSetting();

    const toggle = findToggle();
    expect(toggle.checked).toBe(false);
    await act(async () => toggle.click());
    expect(bridge.setTelemetryLevel).toHaveBeenCalledWith({ level: "basic" });
    await vi.waitFor(() => expect(toggle.checked).toBe(true));
  });

  it("surfaces a quiet inline error without changing the saved choice", async () => {
    const bridge = installTelemetryBridge(telemetryState());
    bridge.setTelemetryLevel.mockRejectedValueOnce(new Error("failed"));
    await renderProductAnalyticsSetting();

    const toggle = findToggle();
    await act(async () => toggle.click());

    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
    expect(toggle.checked).toBe(true);
    expect(container.textContent).toContain("could not be updated");
  });

  it("uses the standard Settings page structure and opens the public disclosure", async () => {
    const bridge = installTelemetryBridge(telemetryState());
    await act(async () => {
      root?.render(withTestLocalization(<PrivacySettingsView />));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector(".desktop-settings-section-header")?.textContent)
      .toContain("Privacy");
    expect(container.querySelector(".desktop-settings-subsection-title")).toBeNull();
    expect(container.querySelectorAll(".desktop-settings-list > .desktop-settings-row"))
      .toHaveLength(1);

    const learnMore = Array.from(container.querySelectorAll("a"))
      .find((link) => link.textContent?.includes("Learn More"));
    await act(async () => learnMore?.click());
    expect(bridge.openExternalUrl).toHaveBeenCalledWith(
      "https://github.com/puppyone-ai/puppyone-desktop/blob/main/README.md#privacy",
    );
  });
});

async function renderProductAnalyticsSetting(): Promise<void> {
  await act(async () => {
    root?.render(withTestLocalization(<ProductAnalyticsSettingsRow />));
    await Promise.resolve();
    await Promise.resolve();
  });
}

function findToggle(): HTMLInputElement {
  return container.querySelector<HTMLInputElement>('input[aria-label="Product Analyze"]')!;
}

function installTelemetryBridge(initial: DesktopTelemetryState) {
  let current = initial;
  const listeners = new Set<(state: DesktopTelemetryState) => void>();
  const bridge = {
    getTelemetryState: vi.fn(async () => current),
    setTelemetryLevel: vi.fn(async ({ level }: { level: "basic" | "off" }) => {
      current = telemetryState({
        ...current,
        level,
        effectiveLevel: current.eligible && level === "basic" ? "basic" : "off",
        enabled: current.eligible && level === "basic",
        disabledReason: current.eligible
          ? (level === "off" ? "level-off" : null)
          : current.disabledReason,
        noticeSeenVersion: level === "basic" ? current.noticeVersion : current.noticeSeenVersion,
        noticeRequired: false,
      });
      listeners.forEach((listener) => listener(current));
      return current;
    }),
    onTelemetryStateChanged: vi.fn((listener: (state: DesktopTelemetryState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    openExternalUrl: vi.fn().mockResolvedValue({ ok: true }),
  };
  Object.defineProperty(window, "puppyoneDesktop", {
    configurable: true,
    value: bridge,
  });
  return bridge;
}

function telemetryState(overrides: Partial<DesktopTelemetryState> = {}): DesktopTelemetryState {
  return {
    schemaVersion: 2,
    defaultLevel: "basic",
    level: "basic",
    effectiveLevel: "basic",
    enabled: true,
    eligible: true,
    disabledReason: null,
    noticeVersion: 2,
    noticeSeenVersion: 2,
    noticeRequired: false,
    transportConfigured: true,
    queuedEventCount: 0,
    ...overrides,
  };
}
