/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePaymentsExperience } from "../../../../src/features/payments";
import { ExperimentalSettingsView } from "../../../../src/features/settings/main/ExperimentalSettingsView";
import { AccountAICredits } from "../../../../src/features/settings/main/AccountAICredits";
import { BuiltInAgentCompute } from "../../../../src/features/desktop-agent/ui/built-in-agent/BuiltInAgentCompute";
import { modelConnectionsApi } from "../../../../src/features/model-connections/modelConnectionsApi";
import { DEFAULT_EXPERIMENTAL_SETTINGS } from "../../../../src/preferences";
import { desktopPreferencesStore as store, initializeDesktopPreferences } from "../../../../src/preferencesStore";
import type { ModelConnectionSnapshot } from "../../../../shared/model-connections/types";
import { withTestLocalization } from "../../../support/react/localization";

vi.mock("../../../../src/features/model-connections/modelConnectionsApi");

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const label = "Pay for PuppyOne compute";
const paidSnapshot: ModelConnectionSnapshot = {
  schemaVersion: 1, revision: 1, connections: [], catalogs: [],
  managed: { available: true, reason: "ready", signedIn: true, availableMicroUsd: 750_000,
    trialCreditMicroUsd: 1_000_000, trialGrantedMicroUsd: 1_000_000,
    packs: [{ id: "starter", name: "AI credit", price_cents: 500, credit_micro_usd: 5_000_000 }] },
};

let root: Root | null = null;
let managed: ReturnType<typeof vi.fn<NonNullable<typeof modelConnectionsApi.managed>>>;

beforeEach(() => {
  localStorage.clear();
  initializeDesktopPreferences();
  managed = vi.fn<NonNullable<typeof modelConnectionsApi.managed>>(async () => paidSnapshot);
  Object.assign(modelConnectionsApi, {
    read: async () => paidSnapshot, save: async () => paidSnapshot, remove: async () => paidSnapshot,
    refresh: async () => paidSnapshot, verify: async () => paidSnapshot, discover: async () => [],
    subscribe: () => () => {}, managed,
  } satisfies typeof modelConnectionsApi);
});

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
function PaymentProbe() {
  return <span data-testid="path">{usePaymentsExperience() ? "paid" : "own compute"}</span>;
}

describe("payments experiment", () => {
  it("offers one default-off switch next to the other account experiments", () => {
    const host = render(<ExperimentalSettingsView />);
    const toggle = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;

    expect(toggle.closest(".desktop-settings-subsection")?.querySelector("h3")?.textContent).toBe("Cloud & automation");
    expect(toggle.checked).toBe(false);
    expect(toggle.getAttribute("aria-description")).toBe(
      "Use Puppyone's token and pay for what you use, with no subscription."
      + " Off keeps the Agent on your own API or model and never shows a balance or a price.",
    );

    act(() => toggle.click());
    expect(store.getState().experimentalSettings).toEqual({ ...DEFAULT_EXPERIMENTAL_SETTINGS, enablePayments: true });

    act(() => initializeDesktopPreferences());
    expect(JSON.parse(localStorage.getItem("puppyone.desktop.experimental")!).enablePayments).toBe(true);
    expect(toggle.checked).toBe(true);

    act(() => toggle.click());
    expect(store.getState().experimentalSettings).toEqual(DEFAULT_EXPERIMENTAL_SETTINGS);
  });

  it("gives every render entry the same decision through the single consumption point", () => {
    const host = render(<><ExperimentalSettingsView /><PaymentProbe /></>);
    const toggle = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    const path = () => host.querySelector('[data-testid="path"]')?.textContent;

    expect(path()).toBe("own compute");

    act(() => toggle.click());
    expect(path()).toBe("paid");

    act(() => store.getState().setExperimentalSettings(settings => ({ ...settings, enablePayments: false })));
    expect(path()).toBe("own compute");
    expect(toggle.checked).toBe(false);
  });

  it("keeps Settings on account sign-in alone and never reads the wallet", async () => {
    const host = render(<AccountAICredits payments={false} signedIn />);
    await act(async () => undefined);

    expect(host.textContent).toBe("");
    expect(host.querySelector("button")).toBeNull();
    expect(managed).not.toHaveBeenCalled();

    const signedOut = render(<AccountAICredits payments={false} signedIn={false} onSignIn={() => undefined} />);
    expect([...signedOut.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Sign in"]);
    expect(signedOut.textContent).not.toMatch(/\$|balance|Add|Refresh/);
    expect(managed).not.toHaveBeenCalled();
  });

  it("asks a signed-in account to top up only while the experiment is on", async () => {
    const host = render(<AccountAICredits payments signedIn />);
    await act(async () => undefined);

    expect(host.textContent).toContain("Available balance");
    expect([...host.querySelectorAll("button")].map((button) => button.textContent))
      .toEqual([`Add ${money(5)}`, "Refresh balance"]);
    expect(managed).toHaveBeenCalledWith({ action: "refresh" });
  });

  it("drops paid compute out of Chat and points at the user's own connection instead", async () => {
    const onOpenAccount = vi.fn();
    const onOpenModelConnections = vi.fn();
    const onAccessRequiredChange = vi.fn();
    const container = document.createElement("div");
    container.className = "desktop-agent-boundary";
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(withTestLocalization(<BuiltInAgentCompute
      models={[]} payments={false} selectedModel={null} disabled={false} accessPrompt
      onSelectModel={vi.fn()} onCatalogChange={vi.fn()} onOpenAccount={onOpenAccount}
      onOpenModelConnections={onOpenModelConnections} onReadyChange={vi.fn()}
      onAccessRequiredChange={onAccessRequiredChange}
    />)));

    expect(container.textContent).toContain("Compute source");
    expect(container.textContent).toContain("Connect your own API or a model you already run.");
    expect(container.textContent).not.toMatch(/Puppyone's token|Sign in to start|AI credit|balance|Add credit/);
    expect(onAccessRequiredChange).toHaveBeenLastCalledWith("compute-setup-required");
    expect(managed).not.toHaveBeenCalled();

    const connect = [...container.querySelectorAll("button")].find((button) => button.textContent === "Your API or local model")!;
    act(() => connect.click());
    expect(onOpenModelConnections).toHaveBeenCalledTimes(1);
    expect(onOpenAccount).not.toHaveBeenCalled();
  });
});

function money(usd: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 6 }).format(usd);
}
