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
afterEach(() => { if (root) act(() => root?.unmount()); root = null; document.body.replaceChildren(); });
const localId = "mc_11111111-1111-1111-1111-111111111111";
const apiId = "mc_22222222-2222-2222-2222-222222222222";
const models: AgentModel[] = [
  { id: `${localId}/llama`, model: `${localId}/llama`, displayName: "Local Llama", description: "Ollama", connectionId: localId, variants: [], isDefault: false },
  { id: `${apiId}/cloud-model`, model: `${apiId}/cloud-model`, displayName: "API model", description: "My API", connectionId: apiId, variants: [], isDefault: false },
];
function fixture(empty = false) {
  const snapshot: ModelConnectionSnapshot = { schemaVersion: 1, revision: 1, managed: { available: false, reason: "gateway-unavailable" },
    connections: empty ? [] : [
      { id: localId, sourceKind: "local", driver: "ollama", name: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", auth: "none", credentialConfigured: false, configGeneration: 1, defaultModelId: null, manualModelId: null, manualContextWindow: 4096, serverToolsDisabled: false, transport: "loopback", executionLocation: "unknown" },
      { id: apiId, sourceKind: "api", driver: "openai-compatible", name: "My API", baseUrl: "https://example.com/v1", auth: "bearer", credentialConfigured: true, configGeneration: 1, defaultModelId: null, manualModelId: null, manualContextWindow: 4096, serverToolsDisabled: false, transport: "remote", executionLocation: "unknown" },
    ], catalogs: empty ? [] : [localId, apiId].map((connectionId) => ({ connectionId, configGeneration: 1, status: "ready", endpoint: "reachable", authentication: "valid", observedAt: null, complete: true, models: [], errorCode: null })),
  };
  const client: ModelConnectionClientPort = { read: vi.fn(async () => snapshot), save: vi.fn(async () => snapshot), remove: vi.fn(async () => snapshot), refresh: vi.fn(async () => snapshot), verify: vi.fn(async () => snapshot), discover: vi.fn(async () => []), subscribe: () => () => {} };
  return { client, store: new ModelConnectionStore(client) };
}
function button(label: string) {
  const match = [...document.querySelectorAll("button")].find((entry) => entry.textContent === label
    || entry.querySelector("strong")?.textContent === label || entry.getAttribute("aria-label") === label);
  if (!match) throw new Error(`Missing button: ${label}`); return match;
}
async function render({ selectedModel = null as string | null, disabled = false, empty = false } = {}) {
  const { client, store } = fixture(empty);
  const onSelectModel = vi.fn(); const onReadyChange = vi.fn(); const onCatalogChange = vi.fn();
  const container = document.createElement("div"); container.className = "desktop-agent-boundary"; document.body.append(container); root = createRoot(container);
  await act(async () => root?.render(withTestLocalization(<BuiltInAgentCompute store={store} models={empty ? [] : models} selectedModel={selectedModel}
    disabled={disabled} onSelectModel={onSelectModel} onReadyChange={onReadyChange} onCatalogChange={onCatalogChange} />)));
  return { client, onSelectModel, onReadyChange, onCatalogChange };
}
it("defaults to quiet Puppyone Cloud without exposing setup choices or running a model", async () => {
  const { client, onReadyChange, onSelectModel } = await render();
  expect(document.querySelector('.desktop-agent-compute-summary')?.textContent).toContain("Puppyone Cloud");
  expect(document.querySelector('.desktop-agent-compute-options')).toBeNull();
  expect(document.querySelector('.desktop-agent-compute-editor')).toBeNull();
  expect(button("Bring your own API or your model").getAttribute("aria-expanded")).toBe("false");
  expect(document.body.textContent).toContain("Cloud inference is not available yet");
  expect(document.querySelector('button[aria-label="Agent model"]')).toBeNull();
  expect(onReadyChange).toHaveBeenLastCalledWith(false);
  expect(client.discover).not.toHaveBeenCalled(); expect(client.verify).not.toHaveBeenCalled(); expect(onSelectModel).not.toHaveBeenCalled();
});
it("only offers local models after choosing local, and only commits an explicit model choice", async () => {
  const { onSelectModel, onReadyChange } = await render();
  act(() => button("Bring your own API or your model").click());
  expect(document.body.textContent).toContain("How do you want to connect?");
  expect(document.querySelector('input[type="url"]')).toBeNull();
  act(() => button("Local models").click());
  act(() => button("Agent model").click());
  expect(document.body.textContent).toContain("Local Llama"); expect(document.body.textContent).not.toContain("API model");
  act(() => button("Local Llama").click());
  expect(onSelectModel).toHaveBeenCalledWith(models[0].model);
  expect(onReadyChange).toHaveBeenLastCalledWith(false); // Parent must commit/confirm the route first.
});
it("pauses sending while browsing another source and can return to the actual route", async () => {
  const { onReadyChange, onSelectModel } = await render({ selectedModel: models[0].model });
  expect(onReadyChange).toHaveBeenLastCalledWith(true);
  act(() => button("Bring your own API or your model").click());
  act(() => button("Back").click());
  act(() => button("Bring your API").click());
  expect(onReadyChange).toHaveBeenLastCalledWith(false);
  act(() => button("Agent model").click());
  expect(document.body.textContent).toContain("API model"); expect(document.body.textContent).not.toContain("Local Llama");
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  act(() => button("Close").click());
  expect(onReadyChange).toHaveBeenLastCalledWith(true); expect(onSelectModel).not.toHaveBeenCalled();
});
it("keeps official cloud visible but unavailable without falling back to a BYOK model", async () => {
  const { onReadyChange, onSelectModel, client } = await render({ selectedModel: models[0].model });
  act(() => button("Bring your own API or your model").click());
  act(() => button("Back").click());
  act(() => button("Use Puppyone Cloud").click());
  expect(document.body.textContent).toContain("Cloud inference is not available yet");
  expect(document.querySelector('.desktop-agent-compute-editor')).toBeNull();
  expect(document.querySelector('button[aria-label="Agent model"]')).toBeNull();
  expect(onReadyChange).toHaveBeenLastCalledWith(false); expect(onSelectModel).not.toHaveBeenCalled(); expect(client.save).not.toHaveBeenCalled();
});
it("opens a focused URL and Key form for a new API source", async () => {
  const { client } = await render({ empty: true });
  act(() => button("Bring your own API or your model").click());
  expect(document.body.textContent).toContain("How do you want to connect?");
  expect(document.body.textContent).not.toContain("No connections yet");
  act(() => button("Bring your API").click());
  expect(document.querySelector('input[type="password"]')).not.toBeNull();
  expect(document.querySelector('input[type="url"]')).not.toBeNull();
  expect(document.querySelector('select[id$="-driver"]')).toBeNull();
  expect(document.body.textContent).not.toContain("Find local services"); expect(client.discover).not.toHaveBeenCalled();
});
it("keeps local discovery explicit and offers a manual URL as the only alternative", async () => {
  const { client } = await render({ empty: true });
  act(() => button("Bring your own API or your model").click());
  act(() => button("Local models").click());
  expect(document.body.textContent).toContain("Find local services");
  expect(document.body.textContent).toContain("Enter local URL");
  expect(document.querySelector('input[type="url"]')).toBeNull();
  expect(client.discover).not.toHaveBeenCalled();
  await act(async () => button("Find local services").click());
  expect(client.discover).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).not.toContain("No connections yet");
  act(() => button("Enter local URL").click());
  expect(document.querySelector('input[type="url"]')).not.toBeNull();
  expect((document.querySelector('select[id$="-service"]') as HTMLSelectElement).value).toBe("ollama");
});
it("keeps source selection disabled during a turn", async () => {
  const { onSelectModel } = await render({ selectedModel: models[0].model, disabled: true });
  expect(button("Bring your own API or your model").disabled).toBe(true);
  expect(button("Agent model").disabled).toBe(true);
  expect(onSelectModel).not.toHaveBeenCalled();
});
it("restores the actual custom route when an uncommitted customization is closed", async () => {
  const { onReadyChange, onSelectModel } = await render({ selectedModel: models[0].model });
  expect(document.querySelector('.desktop-agent-compute-summary')?.textContent).toContain("Local models");
  act(() => button("Bring your own API or your model").click());
  act(() => button("Back").click());
  act(() => button("Bring your API").click());
  expect(onReadyChange).toHaveBeenLastCalledWith(false);
  act(() => button("Close").click());
  expect(onReadyChange).toHaveBeenLastCalledWith(true);
  expect(document.querySelector('.desktop-agent-compute-editor')).toBeNull();
  expect(document.querySelector('.desktop-agent-compute-summary')?.textContent).toContain("Local models");
  expect(onSelectModel).not.toHaveBeenCalled();
});
it("closes a new connection editor back to cloud and discards the write-only Key form", async () => {
  const { client, onReadyChange } = await render({ empty: true });
  act(() => button("Bring your own API or your model").click());
  act(() => button("Bring your API").click());
  expect(document.querySelector('input[type="password"]')).not.toBeNull();
  act(() => button("Close").click());
  expect(document.querySelector('input[type="password"]')).toBeNull();
  expect(document.querySelector('.desktop-agent-compute-summary')?.textContent).toContain("Puppyone Cloud");
  expect(onReadyChange).toHaveBeenLastCalledWith(false);
  expect(client.save).not.toHaveBeenCalled();
});
