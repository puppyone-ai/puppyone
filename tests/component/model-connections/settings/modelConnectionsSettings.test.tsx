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
function fixture() {
  const empty: ModelConnectionSnapshot = { schemaVersion: 1, revision: 0, connections: [], catalogs: [], managed: { available: false, reason: "gateway-unavailable" } };
  const client: ModelConnectionClientPort = { read: vi.fn(async () => empty), save: vi.fn(async () => empty), remove: vi.fn(async () => empty), refresh: vi.fn(async () => empty), verify: vi.fn(async () => empty),
    discover: vi.fn<ModelConnectionClientPort["discover"]>(async () => [{ driver: "ollama", name: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" }]), subscribe: () => () => {} };
  return { client, store: new ModelConnectionStore(client) };
}
function button(label: string) {
  const element = [...document.querySelectorAll("button")].find((entry) => entry.textContent === label);
  if (!element) throw new Error(`Missing button: ${label}`); return element;
}
async function render(store: ModelConnectionStore) {
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root?.render(withTestLocalization(<ModelConnectionsSettings store={store} />)); });
}
it("allows logged-out discovery without saving or running a model, then reuses the manual form", async () => {
  const { client, store } = fixture(); await render(store);
  expect(document.body.textContent).toContain("No connections yet.");
  await act(async () => button("Find local services").click());
  expect(client.discover).toHaveBeenCalledOnce(); expect(client.save).not.toHaveBeenCalled(); expect(client.verify).not.toHaveBeenCalled();
  act(() => button("Connect").click());
  expect((document.querySelector('input[type="url"]') as HTMLInputElement).value).toBe("http://127.0.0.1:11434/v1");
  await act(async () => document.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(client.save).toHaveBeenCalledWith(expect.objectContaining({ driver: "ollama", baseUrl: "http://127.0.0.1:11434/v1", auth: "none" }));
  expect(document.body.textContent).toContain("Not available in this build.");
});
it("uses a password field for Key input and clears it when the editor closes", async () => {
  const { store } = fixture(); await render(store);
  act(() => button("Add connection").click());
  const auth = document.querySelector('select[id$="-auth"]') as HTMLSelectElement;
  act(() => { auth.value = "bearer"; auth.dispatchEvent(new Event("change", { bubbles: true })); });
  const input = document.querySelector('input[type="password"]') as HTMLInputElement;
  expect(input.autocomplete).toBe("off");
  act(() => button("Cancel").click());
  expect(document.querySelector('input[type="password"]')).toBeNull();
  expect(JSON.stringify(store.getSnapshot())).not.toContain("apiKey");
});
it("starts an API connection with URL and write-only Key, without local discovery", async () => {
  const { client, store } = fixture();
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root?.render(withTestLocalization(<ModelConnectionsSettings embedded sourceKind="api" store={store} />)));
  expect(document.body.textContent).not.toContain("Find local services");
  act(() => button("Add connection").click());
  expect((document.querySelector('select[id$="-driver"]') as HTMLSelectElement).value).toBe("openai-compatible");
  expect((document.querySelector('input[type="url"]') as HTMLInputElement).value).toBe("");
  expect(document.querySelector('input[type="password"]')).not.toBeNull();
  await act(async () => document.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(client.save).toHaveBeenCalledWith(expect.objectContaining({ sourceKind: "api", auth: "bearer", driver: "openai-compatible" }));
  expect(client.discover).not.toHaveBeenCalled();
});
