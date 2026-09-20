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
  await act(async () => root?.render(withTestLocalization(<AccountAICredits store={new ModelConnectionStore(client)} />)));
  expect(host.textContent).toContain("$0.75");
  expect(host.textContent).toContain("$1.00");
  expect(host.textContent).toContain("Sandbox");
  expect(host.textContent).toContain("$0.000047");
  expect(host.textContent).toContain("Input: 10 (cached: 4)");
  expect(host.textContent).toContain("Model prices per million tokens");
  expect(host.textContent).not.toMatch(/Pro|Team|\$15|\$30/);
  const topUp = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("$5.00"))!;
  expect(topUp).toBeDefined();
  act(() => topUp.click());
  expect(topUp.disabled).toBe(true);
  act(() => topUp.click());
  expect(managed.mock.calls.filter(([request]) => request.action === "checkout")).toEqual([[{ action: "checkout", packId: "starter" }]]);
  await act(async () => completeCheckout?.(snapshot));
  expect(topUp.disabled).toBe(false);
});
