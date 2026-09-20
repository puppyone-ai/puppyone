/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ModelConnectionStore } from "../../../../src/features/model-connections/application/ModelConnectionStore";
import type { ModelConnectionClientPort } from "../../../../src/features/model-connections/application/ModelConnectionClientPort";
import { ModelConnectionQuickSetup } from "../../../../src/features/model-connections/ui/ModelConnectionQuickSetup";
import type { ModelConnectionSnapshot } from "../../../../shared/model-connections/types";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => { if (root) act(() => root?.unmount()); root = null; document.body.replaceChildren(); });

const connectionId = "mc_11111111-1111-1111-1111-111111111111";
const baseSnapshot: ModelConnectionSnapshot = {
  schemaVersion: 1,
  revision: 1,
  managed: { available: false, reason: "gateway-unavailable" },
  connections: [{ id: connectionId, sourceKind: "api", driver: "openai-compatible", name: "API", baseUrl: "https://example.com/v1",
    auth: "bearer", credentialConfigured: true, configGeneration: 1, defaultModelId: null, manualModelId: null,
    manualContextWindow: 4096, serverToolsDisabled: false, transport: "remote", executionLocation: "unknown" }],
  catalogs: [{ connectionId, configGeneration: 1, status: "ready", endpoint: "reachable", authentication: "valid", observedAt: null,
    complete: true, errorCode: null, models: [{ id: "model-1", name: "Model 1", available: true, loaded: null, contextWindow: 4096,
      maxContextWindow: null, capabilities: { text: "supported", tools: "unknown", images: "unknown" }, evidence: "catalog" }] }],
};

function client(snapshot = baseSnapshot): ModelConnectionClientPort {
  return {
    read: vi.fn(async () => snapshot),
    save: vi.fn(async () => snapshot),
    remove: vi.fn(async () => snapshot),
    refresh: vi.fn(async () => snapshot),
    verify: vi.fn(async () => ({ ...snapshot, revision: snapshot.revision + 1 })),
    discover: vi.fn(async () => []),
    subscribe: () => () => {},
  };
}

async function render(sourceKind: "api" | "local", api = client()) {
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root?.render(withTestLocalization(<ModelConnectionQuickSetup sourceKind={sourceKind} store={new ModelConnectionStore(api)} />)));
  return api;
}

it("turns an existing unverified connection into one clear verification step", async () => {
  const api = await render("api");
  expect(document.querySelector('input[type="url"]')).toBeNull();
  expect(document.body.textContent).toContain("Model 1");
  const verify = [...document.querySelectorAll("button")].find((entry) => entry.textContent === "Verify Agent support")!;
  await act(async () => verify.click());
  expect(api.verify).toHaveBeenCalledWith({ id: connectionId, expectedGeneration: 1, modelId: "model-1" });
  act(() => [...document.querySelectorAll("button")].find((entry) => entry.textContent === "Add another connection")?.click());
  expect(document.querySelector('input[type="url"]')).not.toBeNull();
  act(() => [...document.querySelectorAll("button")].find((entry) => entry.textContent === "Cancel")?.click());
  expect(document.body.textContent).toContain("Model 1");
});

it("keeps an unsuccessful local discovery quiet and leaves both user actions available", async () => {
  const empty: ModelConnectionSnapshot = { ...baseSnapshot, connections: [], catalogs: [] };
  const api = client(empty);
  api.discover = vi.fn(async () => { throw new Error("OPERATION_FAILED"); });
  await render("local", api);
  const discover = [...document.querySelectorAll("button")].find((entry) => entry.textContent === "Find local services")!;
  await act(async () => discover.click());
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(document.body.textContent).toContain("Find local services");
  expect(document.body.textContent).toContain("Enter local URL");
});
