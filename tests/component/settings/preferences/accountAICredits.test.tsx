/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AccountAICredits } from "../../../../src/features/settings/main/AccountAICredits";
import { ModelConnectionStore } from "../../../../src/features/model-connections/application/ModelConnectionStore";
import type { ModelConnectionClientPort } from "../../../../src/features/model-connections/application/ModelConnectionClientPort";
import type { ModelConnectionSnapshot } from "../../../../shared/model-connections/types";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); });

it("shows personal credit and one-time top-up without any hosting subscription", async () => {
  const snapshot: ModelConnectionSnapshot = {
    schemaVersion: 1, revision: 1, connections: [], catalogs: [],
    managed: { available: true, reason: "ready", signedIn: true, sandbox: true,
      availableMicroUsd: 750_000, reservedMicroUsd: 250_000, trialGrantedMicroUsd: 1_000_000,
      packs: [{ id: "starter", name: "AI credit", price_cents: 500, credit_micro_usd: 5_000_000 }],
      lastUsage: { reservationId: "receipt-1", modelId: "example-model", status: "settled", chargedMicroUsd: 47,
        priceBookId: "prices-1", inputTokens: 10, cachedTokens: 4, outputTokens: 20 },
      modelPrices: [{ modelId: "example-model", name: "Example Model", inputMicroUsdPerMillion: 1_000_000,
        cachedMicroUsdPerMillion: 100_000, outputMicroUsdPerMillion: 2_000_000 }],
    },
  };
  let completeCheckout: ((value: ModelConnectionSnapshot) => void) | undefined;
  const managed = vi.fn<NonNullable<ModelConnectionClientPort["managed"]>>(async (request) => {
    if (request.action === "checkout") return new Promise<ModelConnectionSnapshot>((resolve) => { completeCheckout = resolve; });
    return snapshot;
  });
  const client: ModelConnectionClientPort = {
    read: async () => snapshot, save: async () => snapshot, remove: async () => snapshot,
    refresh: async () => snapshot, verify: async () => snapshot, discover: async () => [],
    subscribe: () => () => {}, managed,
  };
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(withTestLocalization(<AccountAICredits signedIn store={new ModelConnectionStore(client)} />)));
  expect(host.textContent).toContain("$0.75");
  expect(host.textContent).toContain("$1.00");
  expect(host.textContent).toContain("Sandbox");
  expect(host.textContent).toContain("$0.000047");
  expect(host.textContent).toContain("Input: 10 (cached: 4)");
  expect(host.textContent).toContain("Model prices per million tokens");
  expect(host.textContent).not.toMatch(/Pro|Team|\$15|\$30/);
  expect(host.querySelectorAll(".desktop-settings-subsection")).toHaveLength(3);
  expect(host.querySelector(".desktop-settings-subsection-detail")?.textContent).toContain("no subscription");
  expect(host.querySelector("p:not(.desktop-settings-subsection-detail)")).toBeNull();
  const topUp = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("$5.00"))!;
  expect(topUp).toBeDefined();
  act(() => topUp.click());
  expect(topUp.disabled).toBe(true);
  act(() => topUp.click());
  expect(managed.mock.calls.filter(([request]) => request.action === "checkout")).toEqual([[{ action: "checkout", packId: "starter" }]]);
  await act(async () => completeCheckout?.(snapshot));
  expect(topUp.disabled).toBe(false);
});

it.each([false, true])("hides billing after logout even if the managed snapshot is still signed in: %s", async (managedSignedIn) => {
  const snapshot: ModelConnectionSnapshot = { schemaVersion: 1, revision: 1, connections: [], catalogs: [],
    managed: { available: managedSignedIn, reason: managedSignedIn ? "ready" : "sign-in-required",
      signedIn: managedSignedIn, trialCreditMicroUsd: 1_000_000,
      availableMicroUsd: 750_000, trialGrantedMicroUsd: 1_000_000,
      errorCode: "GATEWAY_UNAVAILABLE",
      packs: [{ id: "starter", name: "AI credit", price_cents: 500, credit_micro_usd: 5_000_000 }],
      lastUsage: { reservationId: "stale-receipt", modelId: "example-model", status: "settled", chargedMicroUsd: 47,
        priceBookId: "prices-1", inputTokens: 10, cachedTokens: 4, outputTokens: 20 },
      modelPrices: [{ modelId: "example-model", name: "Example Model", inputMicroUsdPerMillion: 1_000_000,
        cachedMicroUsdPerMillion: 100_000, outputMicroUsdPerMillion: 2_000_000 }] } };
  let finishRefresh: (value: ModelConnectionSnapshot) => void;
  const managed = vi.fn(() => new Promise<ModelConnectionSnapshot>((resolve) => { finishRefresh = resolve; }));
  const client: ModelConnectionClientPort = { read: async () => snapshot, save: async () => snapshot,
    remove: async () => snapshot, refresh: async () => snapshot, verify: async () => snapshot,
    discover: async () => [], subscribe: () => () => {}, managed };
  const onSignIn = vi.fn();
  const store = new ModelConnectionStore(client);
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(withTestLocalization(<AccountAICredits signedIn={managedSignedIn} store={store} onSignIn={onSignIn} />)));
  if (managedSignedIn) expect(host.textContent).toContain("$0.75");
  await act(async () => root?.render(withTestLocalization(<AccountAICredits signedIn={false} store={store} onSignIn={onSignIn} />)));
  expect(host.textContent).not.toContain("Trial credit");
  expect(host.textContent).not.toContain("$0.75");
  expect(host.textContent).not.toContain("$1.00");
  expect(host.textContent).not.toContain("$5.00");
  expect(host.textContent).not.toContain("$0.00");
  expect(host.textContent).not.toContain("Latest usage");
  expect(host.textContent).not.toContain("Model prices per million tokens");
  expect(host.textContent).not.toContain("Example Model");
  expect(host.querySelector(".desktop-settings-subsection-detail")).toBeNull();
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).not.toMatch(/Cloud hosting|Pro|Team|\$15|\$30/);
  const signIn = [...host.querySelectorAll("button")].find((button) => button.textContent === "Sign in")!;
  expect(store.getSnapshot().pending.managed).toBe(true);
  expect(signIn.disabled).toBe(false);
  await act(async () => signIn.click());
  expect(onSignIn).toHaveBeenCalledOnce();
  expect(managed).not.toHaveBeenCalledWith(expect.objectContaining({ action: "checkout" }));
  await act(async () => finishRefresh!(snapshot));
  expect(host.textContent).not.toContain("$0.75");
  expect(host.textContent).not.toContain("Example Model");
});

it("does not ask a signed-in account to log in again while its wallet is loading", async () => {
  const snapshot: ModelConnectionSnapshot = { schemaVersion: 1, revision: 1, connections: [], catalogs: [],
    managed: { available: false, reason: "sign-in-required", signedIn: false } };
  const client: ModelConnectionClientPort = { read: async () => snapshot, save: async () => snapshot,
    remove: async () => snapshot, refresh: async () => snapshot, verify: async () => snapshot,
    discover: async () => [], subscribe: () => () => {}, managed: async () => snapshot };
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(withTestLocalization(<AccountAICredits signedIn store={new ModelConnectionStore(client)} />)));
  expect(host.querySelector("button")).toBeNull();
  expect(host.textContent).not.toMatch(/\$|Sign in|Model prices/);
});
