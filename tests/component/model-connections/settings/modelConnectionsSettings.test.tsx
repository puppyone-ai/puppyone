/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ModelConnectionsSettings } from "../../../../src/features/model-connections";
import { ModelConnectionStore } from "../../../../src/features/model-connections/application/ModelConnectionStore";
import type { ModelConnectionClientPort } from "../../../../src/features/model-connections/application/ModelConnectionClientPort";
import type { ModelConnectionSnapshot } from "../../../../shared/model-connections/types";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => { if (root) act(() => root?.unmount()); root = null; document.body.replaceChildren(); });
function fixture(snapshot?: ModelConnectionSnapshot) {
  const empty: ModelConnectionSnapshot = { schemaVersion: 1, revision: 0, connections: [], catalogs: [], managed: { available: false, reason: "gateway-unavailable" } };
  const client: ModelConnectionClientPort = { read: vi.fn(async () => snapshot ?? empty), save: vi.fn(async () => snapshot ?? empty), remove: vi.fn(async () => empty), refresh: vi.fn(async () => empty), verify: vi.fn(async () => empty),
    discover: vi.fn<ModelConnectionClientPort["discover"]>(async () => [{ driver: "ollama", name: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" }]), subscribe: () => () => {} };
  return { client, store: new ModelConnectionStore(client) };
}
function button(label: string) {
  const element = [...document.querySelectorAll("button")].find((entry) => entry.textContent === label || entry.getAttribute("aria-label") === label || entry.querySelector("strong")?.textContent === label);
  if (!element) throw new Error(`Missing button: ${label}`); return element;
}
async function render(store: ModelConnectionStore) {
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root?.render(withTestLocalization(<ModelConnectionsSettings store={store} />)); });
}
it("allows logged-out discovery without saving or running a model, then reuses the manual form", async () => {
  const { client, store } = fixture(); await render(store);
  expect(document.body.textContent).toContain("No API connections yet.");
  expect(document.body.textContent).not.toContain("Verification calls");
  expect(document.body.textContent).not.toContain("managed inference gateway");
  await act(async () => button("Find local services").click());
  expect(client.discover).toHaveBeenCalledOnce(); expect(client.save).not.toHaveBeenCalled(); expect(client.verify).not.toHaveBeenCalled();
  act(() => button("Connect").click());
  expect((document.querySelector('input[type="url"]') as HTMLInputElement).value).toBe("http://127.0.0.1:11434/v1");
  await act(async () => document.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(client.save).toHaveBeenCalledWith(expect.objectContaining({ driver: "ollama", baseUrl: "http://127.0.0.1:11434/v1", auth: "none" }));
  expect(document.body.textContent).toContain("No local services connected.");
});
it("uses a password field for Key input and clears it when the editor closes", async () => {
  const { store } = fixture(); await render(store);
  act(() => button("Add API connection").click());
  expect(document.querySelector("details")?.open).toBe(false);
  const input = document.querySelector('input[type="password"]') as HTMLInputElement;
  expect(input.autocomplete).toBe("off");
  act(() => button("Cancel").click());
  expect(document.querySelector('input[type="password"]')).toBeNull();
  expect(JSON.stringify(store.getSnapshot())).not.toContain("apiKey");
});
it("starts an API connection with URL and write-only Key, without local discovery", async () => {
  const { client, store } = fixture();
  await render(store);
  act(() => button("Add API connection").click());
  expect(document.body.textContent).not.toContain("Find local services");
  expect(document.querySelector('select[id$="-driver"]')).toBeNull();
  expect((document.querySelector('input[type="url"]') as HTMLInputElement).value).toBe("");
  expect(document.querySelector('input[type="password"]')).not.toBeNull();
  await act(async () => document.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(client.save).toHaveBeenCalledWith(expect.objectContaining({ sourceKind: "api", auth: "bearer", driver: "openai-compatible" }));
  expect(client.discover).not.toHaveBeenCalled();
});

it("keeps discovery failure quiet and leaves both local actions usable", async () => {
  const { client, store } = fixture();
  vi.mocked(client.discover).mockRejectedValueOnce(new Error("DISCOVERY_FAILED"));
  await render(store);
  await act(async () => button("Find local services").click());
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(button("Find local services").disabled).toBe(false);
  act(() => button("Add local connection").click());
  expect((document.querySelector('input[type="url"]') as HTMLInputElement).value).toBe("http://127.0.0.1:11434/v1");
});

it("opens one connection at a time, preserves the saved Key on edit, and confirms removal", async () => {
  const snapshot: ModelConnectionSnapshot = {
    schemaVersion: 1, revision: 0, managed: { available: false, reason: "gateway-unavailable" },
    connections: ["Work API", "Personal API"].map((name, index) => ({
      id: String(index), name, sourceKind: "api", driver: "openai-compatible", baseUrl: "https://example.test/v1",
      auth: "bearer", credentialConfigured: true, configGeneration: 1, defaultModelId: null, manualModelId: null,
      manualContextWindow: 4096, serverToolsDisabled: false, transport: "remote", executionLocation: "unknown",
    })),
    catalogs: [{ connectionId: "0", configGeneration: 1, status: "ready", endpoint: "reachable", authentication: "valid",
      observedAt: null, complete: true, errorCode: null, models: [{ id: "work-model", name: "Work model", available: true, loaded: null,
        capabilities: { text: "supported", tools: "unknown", images: "unknown" }, contextWindow: 4096, maxContextWindow: null, evidence: "test" }] }],
  };
  const { client, store } = fixture(snapshot);
  await render(store);
  expect(document.body.textContent).not.toContain("Work model");
  act(() => button("Work API").click());
  expect(document.body.textContent).toContain("Work model");
  expect(document.body.textContent).not.toContain("Personal API");
  act(() => button("Edit connection").click());
  expect((document.querySelector('input[type="password"]') as HTMLInputElement).value).toBe("");
  await act(async () => document.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(client.save).toHaveBeenCalledWith(expect.objectContaining({ id: "0", expectedGeneration: 1, auth: "bearer" }));
  expect(vi.mocked(client.save).mock.calls[0][0]).not.toHaveProperty("apiKey");
  expect(document.querySelector('input[type="password"]')).toBeNull();
  act(() => button("Remove").click());
  expect(client.remove).not.toHaveBeenCalled();
  act(() => button("Cancel").click());
  expect(document.body.textContent).toContain("Work model");
  act(() => button("Remove").click());
  await act(async () => button("Remove and stop chats").click());
  expect(client.remove).toHaveBeenCalledWith({ id: "0", expectedGeneration: 1 });
  expect(document.body.textContent).toContain("No API connections yet.");
});
