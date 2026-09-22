/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { BuiltInAgentCompute } from "../../../../src/features/desktop-agent/ui/built-in-agent/BuiltInAgentCompute";
import { ModelConnectionStore } from "../../../../src/features/model-connections/application/ModelConnectionStore";
import type { ModelConnectionClientPort } from "../../../../src/features/model-connections/application/ModelConnectionClientPort";
import type { ModelConnectionSnapshot } from "../../../../shared/model-connections/types";
import type { AgentModel } from "../../../../shared/agent-contract/types";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

const localId = "mc_11111111-1111-1111-1111-111111111111";
const apiId = "mc_22222222-2222-2222-2222-222222222222";
const models: AgentModel[] = [
  { id: `${localId}/llama`, model: `${localId}/llama`, displayName: "Local Llama", description: "Ollama", connectionId: localId, variants: [], isDefault: false },
  { id: `${apiId}/cloud-model`, model: `${apiId}/cloud-model`, displayName: "API model", description: "My API", connectionId: apiId, variants: [], isDefault: false },
];

function fixture(empty = false, managed?: ModelConnectionSnapshot["managed"]) {
  const snapshot: ModelConnectionSnapshot = {
    schemaVersion: 1,
    revision: 1,
    managed: { available: false, reason: "gateway-unavailable" },
    connections: empty ? [] : [
      { id: localId, sourceKind: "local", driver: "ollama", name: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", auth: "none", credentialConfigured: false, configGeneration: 1, defaultModelId: null, manualModelId: null, manualContextWindow: 4096, serverToolsDisabled: false, transport: "loopback", executionLocation: "unknown" },
      { id: apiId, sourceKind: "api", driver: "openai-compatible", name: "My API", baseUrl: "https://example.com/v1", auth: "bearer", credentialConfigured: true, configGeneration: 1, defaultModelId: null, manualModelId: null, manualContextWindow: 4096, serverToolsDisabled: false, transport: "remote", executionLocation: "unknown" },
    ],
    catalogs: empty ? [] : [localId, apiId].map((connectionId) => ({
      connectionId,
      configGeneration: 1,
      status: "ready",
      endpoint: "reachable",
      authentication: "valid",
      observedAt: null,
      complete: true,
      models: [],
      errorCode: null,
    })),
  };
  if (managed) {
    snapshot.managed = managed;
    snapshot.connections = [{ id: apiId, sourceKind: "managed", readOnly: true, driver: "openai-compatible", name: "PuppyOne", baseUrl: "https://example.com/api/v1/ai", auth: "bearer", credentialConfigured: true, configGeneration: 1, defaultModelId: null, manualModelId: null, manualContextWindow: 4096, serverToolsDisabled: true, transport: "remote", executionLocation: "unknown" }];
    snapshot.catalogs = [{ connectionId: apiId, configGeneration: 1, status: "ready", endpoint: "reachable", authentication: "valid", observedAt: null, complete: true, models: [], errorCode: null }];
  }
  const client: ModelConnectionClientPort = {
    read: vi.fn(async () => snapshot),
    save: vi.fn(async () => snapshot),
    remove: vi.fn(async () => snapshot),
    refresh: vi.fn(async () => snapshot),
    verify: vi.fn(async () => snapshot),
    discover: vi.fn(async () => []),
    managed: vi.fn(async () => snapshot),
    subscribe: () => () => {},
  };
  return { client, store: new ModelConnectionStore(client) };
}

function button(label: string) {
  const match = [...document.querySelectorAll("button")].find((entry) => entry.textContent === label
    || entry.getAttribute("aria-label") === label);
  if (!match) throw new Error(`Missing button: ${label}`);
  return match as HTMLButtonElement;
}

async function render({ selectedModel = null as string | null, disabled = false, empty = false, accessPrompt = false, managed = undefined as ModelConnectionSnapshot["managed"] | undefined } = {}) {
  const { client, store } = fixture(empty, managed);
  const onSelectModel = vi.fn();
  const onReadyChange = vi.fn();
  const onCatalogChange = vi.fn();
  const onOpenAccount = vi.fn();
  const onOpenModelConnections = vi.fn();
  const container = document.createElement("div");
  container.className = "desktop-agent-boundary";
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(withTestLocalization(<BuiltInAgentCompute
    store={store}
    models={empty ? [] : models}
    selectedModel={selectedModel}
    disabled={disabled}
    accessPrompt={accessPrompt}
    onSelectModel={onSelectModel}
    onReadyChange={onReadyChange}
    onCatalogChange={onCatalogChange}
    onOpenAccount={onOpenAccount}
    onOpenModelConnections={onOpenModelConnections}
  />)));
  return { client, store, onSelectModel, onReadyChange, onCatalogChange, onOpenAccount, onOpenModelConnections };
}

it("keeps the initial managed summary free of account and billing details", async () => {
  const { client, onOpenAccount, onOpenModelConnections, onReadyChange, onSelectModel } = await render({ empty: true });
  expect(document.querySelector(".desktop-agent-compute-summary")?.textContent).toContain("Puppyone's token");
  expect(document.body.textContent).not.toContain("Uses your account balance");
  expect(document.body.textContent).not.toContain("Available:");
  expect(document.body.textContent).not.toContain("Sandbox");
  expect(document.body.textContent).not.toContain("Refresh balance");
  expect(document.body.textContent).not.toContain("Your API or local model");
  expect(document.querySelector(".desktop-agent-compute-editor, input, select")).toBeNull();
  expect(document.querySelector('button[aria-label="Agent model"]')).toBeNull();

  expect(onReadyChange).toHaveBeenLastCalledWith(false);
  expect(onOpenAccount).not.toHaveBeenCalled();
  expect(onOpenModelConnections).not.toHaveBeenCalled();
  expect(client.discover).not.toHaveBeenCalled();
  expect(client.save).not.toHaveBeenCalled();
  expect(client.verify).not.toHaveBeenCalled();
  expect(onSelectModel).not.toHaveBeenCalled();
  expect(document.querySelector(".desktop-agent-access-prompt")).toBeNull();
});

it("offers every ready configured model without configuring connections in Chat", async () => {
  const { onSelectModel, onReadyChange } = await render();
  act(() => button("Agent model").click());
  expect(document.body.textContent).toContain("Local Llama");
  expect(document.body.textContent).toContain("API model");

  act(() => button("API model").click());
  expect(onSelectModel).toHaveBeenCalledWith(models[1].model);
  expect(onReadyChange).toHaveBeenLastCalledWith(false);
  expect(document.querySelector(".desktop-agent-compute-editor, input, select")).toBeNull();
});

it("restores a ready custom route while keeping management in Settings", async () => {
  const { onOpenModelConnections, onReadyChange } = await render({ selectedModel: models[0].model });
  expect(document.querySelector(".desktop-agent-compute-summary")?.textContent).toContain("Local models");
  expect(document.querySelector(".desktop-agent-compute-summary")?.textContent).toContain("Local Llama");
  expect(document.body.textContent).not.toContain("Uses your account balance");
  expect(onReadyChange).toHaveBeenLastCalledWith(true);
  expect(document.body.textContent).not.toContain("Your API or local model");
  expect(onOpenModelConnections).not.toHaveBeenCalled();
  expect(onReadyChange).toHaveBeenLastCalledWith(true);
});

it("disables model selection during a turn", async () => {
  const { onOpenModelConnections, onSelectModel } = await render({ selectedModel: models[0].model, disabled: true });
  expect(button("Agent model").disabled).toBe(true);
  expect(onOpenModelConnections).not.toHaveBeenCalled();
  expect(onSelectModel).not.toHaveBeenCalled();
});

it("asks the controller to refresh when the shared connection catalog arrives", async () => {
  const { onCatalogChange } = await render();
  expect(onCatalogChange).toHaveBeenCalledTimes(1);
});

it("opens email sign-in without selecting a paid model or sending a turn", async () => {
  const { client, onOpenModelConnections, onSelectModel, onReadyChange } = await render({ empty: true, accessPrompt: true });
  await act(async () => button("Sign in to start").click());
  expect(client.managed).toHaveBeenCalledWith({ action: "sign-in" });
  act(() => button("Your API or local model").click());
  expect(onOpenModelConnections).toHaveBeenCalledTimes(1);
  expect(onReadyChange).toHaveBeenLastCalledWith(false);
  expect(onSelectModel).not.toHaveBeenCalled();
});

it("labels a failed browser handoff as a sign-in problem", async () => {
  const { client } = await render({ empty: true, accessPrompt: true });
  vi.mocked(client.managed!).mockRejectedValueOnce(new Error("AUTHENTICATION_FAILED"));
  await act(async () => button("Sign in to start").click());
  expect(document.querySelector('[role="alert"]')?.textContent)
    .toBe("Could not open the sign-in page. Please retry.");
  expect(document.body.textContent).not.toContain("Could not refresh Agent credits");
});

it.each(["loading", "ready"] as const)("shows preparation instead of a billing error while %s is awaiting a model", async (reason) => {
  const { onReadyChange } = await render({ empty: true, accessPrompt: true,
    managed: { signedIn: true, reason, available: reason === "ready" } });
  expect(document.querySelector('[role="status"]')?.textContent).toBe("Connecting to compute…");
  expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(document.querySelector(".desktop-agent-access-primary")).toBeNull();
  expect(document.body.textContent).not.toMatch(/Could not|Refresh balance|Add credit/);
  expect(onReadyChange).toHaveBeenLastCalledWith(false);
});

it("offers retry after a confirmed failure and shows progress while retrying", async () => {
  const { client, store } = await render({ empty: true, accessPrompt: true,
    managed: { signedIn: true, reason: "gateway-unavailable", available: false, errorCode: "GATEWAY_UNAVAILABLE" } });
  expect(document.body.textContent).toContain("Compute service is temporarily unavailable.");
  expect(document.body.textContent).not.toContain("Refresh balance");
  let finish: (snapshot: ModelConnectionSnapshot) => void;
  vi.mocked(client.managed!).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  act(() => button("Retry").click());
  expect(document.body.textContent).toContain("Connecting to compute…");
  expect(document.body.textContent).not.toContain("Compute service is temporarily unavailable.");
  expect(client.managed).toHaveBeenCalledWith({ action: "refresh" });
  await act(async () => finish!(store.getSnapshot().snapshot!));
  expect(button("Retry").disabled).toBe(false);
});

it("blocks a selected managed model when the personal balance is empty", async () => {
  const { client, onOpenAccount, onReadyChange, onSelectModel } = await render({ selectedModel: models[1].model, accessPrompt: true,
    managed: { available: false, reason: "insufficient-credit", signedIn: true, sandbox: true, availableMicroUsd: 0,
      packs: [{ id: "test-pack", name: "Sandbox credit", price_cents: 500, credit_micro_usd: 5_000_000 }] } });
  expect(document.body.textContent).toContain("Add credit to use this model.");
  expect(document.body.textContent).not.toContain("Add $5");
  expect(onReadyChange).toHaveBeenLastCalledWith(false);
  act(() => button("Manage AI balance").click());
  expect(onOpenAccount).toHaveBeenCalledTimes(1);
  expect(client.managed).not.toHaveBeenCalledWith(expect.objectContaining({ action: "checkout" }));
  expect(onSelectModel).not.toHaveBeenCalled();
  expect(onReadyChange).toHaveBeenLastCalledWith(false);
});

it("offers the server-configured trial only after the first send attempt", async () => {
  const { client } = await render({ empty: true, accessPrompt: true,
    managed: { available: false, reason: "sign-in-required", signedIn: false, trialCreditMicroUsd: 1_000_000 } });
  expect(document.querySelector(".desktop-agent-compute-summary")).toBeNull();
  expect([...document.querySelectorAll("button")].some((entry) => entry.textContent === "Refresh balance")).toBe(false);
  expect(document.body.textContent).toContain("One-time $1 AI credit per account");
  await act(async () => button("Sign in to start").click());
  expect(client.managed).toHaveBeenCalledWith({ action: "sign-in" });
  expect(client.managed).not.toHaveBeenCalledWith(expect.objectContaining({ action: "checkout" }));
});

it.each([null, models[1].model])("hides the managed model and picker while retaining its readiness: %s", async (selectedModel) => {
  const { client, onReadyChange, onSelectModel } = await render({ selectedModel,
    managed: { available: true, reason: "ready", signedIn: true, sandbox: true, availableMicroUsd: 4_990_000, reservedMicroUsd: 10_000 } });
  expect(document.querySelector(".desktop-agent-compute-summary")?.textContent).toContain("Puppyone's token");
  expect(document.body.textContent).not.toContain("$4.99");
  expect(document.body.textContent).not.toContain("Sandbox");
  expect(document.body.textContent).not.toContain("Refresh balance");
  expect(document.body.textContent).not.toContain("One-time trial credit");
  expect(document.body.textContent).not.toContain("Ready. Press Send");
  expect(document.body.textContent).not.toContain("Your API or local model");
  expect(document.body.textContent).not.toContain("API model");
  expect(document.querySelector('button[aria-label="Agent model"]')).toBeNull();
  expect(onReadyChange).toHaveBeenLastCalledWith(Boolean(selectedModel));
  expect(client.managed).not.toHaveBeenCalled();
  expect(onSelectModel).not.toHaveBeenCalled();
});
