/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OnboardingTelemetryDisclosure,
  shouldShowOnboardingTelemetryDisclosure,
} from "../../../../src/components/onboarding/OnboardingTelemetryDisclosure";
import type { DesktopTelemetryState } from "../../../../src/types/electron";

vi.mock("@puppyone/localization", () => ({
  useLocalization: () => ({
    t: (id: string) => ({
      "onboarding.telemetry.notice": "Anonymous usage data helps us improve puppyone.",
      "onboarding.telemetry.learnMore": "Learn more",
    }[id] ?? id),
  }),
}));

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
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("OnboardingTelemetryDisclosure", () => {
  it("is limited to eligible first-launch basic analytics", () => {
    expect(shouldShowOnboardingTelemetryDisclosure(null)).toBe(false);
    expect(shouldShowOnboardingTelemetryDisclosure(telemetryState({ eligible: false }))).toBe(false);
    expect(shouldShowOnboardingTelemetryDisclosure(telemetryState({ noticeRequired: false }))).toBe(false);
    expect(shouldShowOnboardingTelemetryDisclosure(telemetryState({ level: "off" }))).toBe(false);
    expect(shouldShowOnboardingTelemetryDisclosure(telemetryState({ transportConfigured: false }))).toBe(true);
    expect(shouldShowOnboardingTelemetryDisclosure(telemetryState())).toBe(true);
  });

  it("waits for the reveal, then persists the notice once and stays visible for this launch", async () => {
    const bridge = installTelemetryBridge();
    act(() => root?.render(<OnboardingTelemetryDisclosure ready={false} />));
    await act(async () => { await Promise.resolve(); });

    expect(container.querySelector("[data-onboarding-telemetry-disclosure]")).toBeNull();
    expect(bridge.markTelemetryNoticeSeen).not.toHaveBeenCalled();

    act(() => root?.render(<OnboardingTelemetryDisclosure ready />));

    await vi.waitFor(() => expect(bridge.markTelemetryNoticeSeen).toHaveBeenCalledOnce());
    expect(container.textContent).toContain("Anonymous usage data helps us improve puppyone");
    expect(container.querySelector("svg")).toBeNull();
  });

  it("does not return on a later launch after this notice version was seen", async () => {
    installTelemetryBridge(telemetryState({
      enabled: true,
      disabledReason: null,
      noticeRequired: false,
      noticeSeenVersion: 2,
    }));
    act(() => root?.render(<OnboardingTelemetryDisclosure ready />));
    await act(async () => { await Promise.resolve(); });

    expect(container.querySelector("[data-onboarding-telemetry-disclosure]")).toBeNull();
  });

  it("opens the public disclosure outside the app", async () => {
    const bridge = installTelemetryBridge();
    act(() => root?.render(<OnboardingTelemetryDisclosure ready />));
    await vi.waitFor(() => expect(container.textContent).toContain("Learn more"));

    const disclosure = container.querySelector<HTMLAnchorElement>(".onboarding-telemetry-disclosure a");
    expect(disclosure?.href).toBe(
      "https://github.com/puppyone-ai/puppyone/blob/main/README.md#privacy",
    );
    await act(async () => disclosure?.click());

    expect(bridge.openExternalUrl).toHaveBeenCalledWith(
      "https://github.com/puppyone-ai/puppyone/blob/main/README.md#privacy",
    );
  });
});

function installTelemetryBridge(initial = telemetryState()) {
  const listeners = new Set<(state: DesktopTelemetryState) => void>();
  const seen = telemetryState({
    enabled: initial.transportConfigured,
    disabledReason: initial.transportConfigured ? null : "transport-unconfigured",
    noticeRequired: false,
      noticeSeenVersion: 2,
  });
  const bridge = {
    getTelemetryState: vi.fn().mockResolvedValue(initial),
    markTelemetryNoticeSeen: vi.fn(async () => {
      listeners.forEach((listener) => listener(seen));
      return seen;
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
    effectiveLevel: "off",
    enabled: false,
    eligible: true,
    disabledReason: "notice-required",
    noticeVersion: 2,
    noticeSeenVersion: 0,
    noticeRequired: true,
    transportConfigured: true,
    queuedEventCount: 0,
    ...overrides,
  };
}
