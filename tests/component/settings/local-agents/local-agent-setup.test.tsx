/** @vitest-environment happy-dom */
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestLocalizationProvider } from "@puppyone/localization/testing";
import { mergeCatalogNamespaces } from "@puppyone/localization/core";
import { LocalAgentSetupSection } from "../../../../src/features/local-agents/ui/LocalAgentSetupSection";
import { LocalAgentActivationStore } from "../../../../src/features/local-agents/activation/LocalAgentActivationStore";
import { installDesktopBridge } from "../../../support/electron/desktopBridge";
import type { LocalAgentSetupSnapshot } from "../../../../shared/local-agent-installation/setup-types";
import type { ActivationOperation, ActivationSnapshot, LocalAgentActivationBridge } from "../../../../shared/local-agent-activation/types";
import settings from "../../../../locales/renderer/en/settings.json";
import common from "../../../../locales/renderer/en/common.json";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const messages = mergeCatalogNamespaces({ settings, common });
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; delete (window as Window & { puppyoneDesktop?: unknown }).puppyoneDesktop; });
const preferences = { enabled: true, dismissedSetupIds: [], snoozedUntil: {} };
function operation(status: ActivationOperation["status"] = "installing"): ActivationOperation {
  return { operationId: "operation:codex", setupId: "codex", displayName: "Codex", status, installed: false, errorCode: null, updatedAt: 1,
    steps: [{ id: "prepare", status: "complete" }, { id: "install", status: "running" }, { id: "login", status: "pending" }, { id: "verify", status: "pending" }] };
}
function button(label: string) {
  const found = Array.from(document.querySelectorAll("button")).find(node => node.getAttribute("aria-label") === label || node.textContent === label || node.title === label);
  if (!found) throw new Error(`Missing button: ${label}. ${document.body.textContent}`); return found;
}
async function click(label: string) { await act(async () => { button(label).click(); }); }
async function mount({ existing, guided = false }: { existing?: ActivationOperation; guided?: boolean } = {}) {
  let value: ActivationSnapshot = { epoch: "fixture", revision: 1, operations: existing ? [existing] : [] };
  let listener: ((snapshot: ActivationSnapshot) => void) | undefined;
  const plan = vi.fn<LocalAgentActivationBridge["plan"]>(async ({ setupId, surface }) => ({ planId: `plan:${setupId}`, setupId, displayName: setupId,
    mode: guided ? "guided" : "automatic", version: guided ? null : "fixture", publisher: "Fixture", surface }));
  const start = vi.fn<LocalAgentActivationBridge["start"]>(async () => { value = { ...value, revision: value.revision + 1, operations: [operation()] }; listener?.(value); return value; });
  const action = vi.fn<LocalAgentActivationBridge["act"]>(async ({ action }) => {
    value = { ...value, revision: value.revision + 1, operations: action === "dismiss" ? [] : value.operations.map(item => ({ ...item, status: action === "cancel" ? "cancelled" : "authenticating" })) };
    listener?.(value); return value;
  });
  const bridge: LocalAgentActivationBridge = { read: async () => value, plan, start, act: action, openGuide: async () => {}, subscribe: callback => { listener = callback; return () => { listener = undefined; }; } };
  const setup: LocalAgentSetupSnapshot = { revision: "setup:1", installationGeneration: 1, entries: (["codex", "cursor"] as const).map(id => ({
    setupId: id, installationId: id, displayName: id === "codex" ? "Codex" : "Cursor", strategy: "external-cli", status: "not-found", companionPresent: true, recommended: true,
  })) };
  const inspect = vi.fn(async () => setup);
  installDesktopBridge({ localAgentSetup: { inspect, act: async () => ({ status: "guide-opened" }), release: async () => {} }, localAgentActivation: bridge });
  const builtin = document.createElement("button"); builtin.textContent = "Built-in Agent"; document.body.append(builtin);
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  let props: ComponentProps<typeof LocalAgentSetupSection> = {
    enabled: true, surface: "chat", eligibleInstallationIds: ["codex", "cursor"], hiddenAgentIds: [], preferences,
    onPreferencesChange: vi.fn(), onRefresh: vi.fn(), onReturnToLauncher: () => builtin.focus(),
    discovery: { ids: [], phase: "ready", hasFailures: false, refreshing: false, progress: null,
      snapshot: { schemaVersion: 1, generation: 1, scanId: "scan:1", source: "scan", results: [], availableAgentIds: [], requestedAt: "2026-09-20T00:00:00Z", completedAt: "2026-09-20T00:00:00Z" } },
  };
  const render = async (patch: Partial<typeof props> = {}) => {
    props = { ...props, ...patch };
    await act(async () => root!.render(<TestLocalizationProvider messages={messages}><LocalAgentSetupSection {...props} /></TestLocalizationProvider>));
  };
  await render();
  return { plan, start, action, inspect, bridge, render, getProps: () => props,
    publish: async (entries: ActivationOperation[]) => { await act(async () => { value = { ...value, revision: value.revision + 1, operations: entries }; listener?.(value); }); } };
}

describe("Local Agent activation interaction", () => {
  it("registers every detected desktop as a simple row without recommendation cards or negative credential copy", async () => {
    const h = await mount();
    expect(document.querySelectorAll(".local-agent-setup-row")).toHaveLength(2);
    expect(button("Activate Codex")).toBeTruthy(); expect(button("Activate Cursor")).toBeTruthy();
    expect(document.querySelector(".local-agent-setup-card")).toBeNull();
    expect(document.body.textContent).not.toMatch(/app detected|No callable|Set up Agents/);
    expect(h.plan).not.toHaveBeenCalled(); expect(h.start).not.toHaveBeenCalled();
  });
  it("explains changes before consent; only confirmation starts installation", async () => {
    const h = await mount(); await click("Activate Codex");
    expect(h.plan).toHaveBeenCalledWith({ setupId: "codex", surface: "chat" });
    expect(document.body.textContent).toContain("install the Codex CLI in the background");
    expect(document.querySelectorAll(".local-agent-activation-steps li")).toHaveLength(4);
    expect(h.start).not.toHaveBeenCalled(); await click("Install and activate");
    expect(h.start).toHaveBeenCalledWith({ planId: "plan:codex" });
    expect(document.querySelector("[aria-current=step]")?.textContent).toContain("Install CLI");
  });
  it("closing the view does not cancel; re-opening keeps the same operation and can stop it", async () => {
    const h = await mount(); await click("Activate Codex"); await click("Install and activate");
    await click("Continue in background"); expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(h.action).not.toHaveBeenCalled(); expect(button("Stop activating Codex").disabled).toBe(false);
    await click("View Codex activation"); expect(h.plan).toHaveBeenCalledOnce();
    await click("Stop activation"); expect(h.action).toHaveBeenCalledWith({ operationId: "operation:codex", action: "cancel" });
    expect(document.querySelector("[role=status]")?.textContent).toBe("Stopped");
  });
  it("does not tie stopping to a pending login request or disable the close button", async () => {
    const h = await mount({ existing: operation("authentication-required") }); await click("View Codex activation");
    h.action.mockImplementationOnce(() => new Promise(() => {}));
    await click("Sign in with browser"); expect(button("Stop activation").disabled).toBe(false);
    expect(button("Close").disabled).toBe(false); await click("Stop activation");
    expect(h.action).toHaveBeenLastCalledWith({ operationId: "operation:codex", action: "cancel" });
  });
  it("does not hide an ongoing task when suggestions are disabled or installation discovery catches up", async () => {
    const h = await mount({ existing: operation() });
    await h.render({ preferences: { ...preferences, enabled: false }, discovery: { ...h.getProps().discovery, ids: ["codex"] } });
    expect(button("View Codex activation")).toBeTruthy(); expect(button("Stop activating Codex")).toBeTruthy();
    expect(document.querySelectorAll(".local-agent-setup-row")).toHaveLength(1);
  });
  it("shows retained installation after cancellation and requires new consent to retry", async () => {
    const h = await mount({ existing: { ...operation("cancelled"), installed: true } }); await click("View Codex activation");
    expect(document.body.textContent).toContain("installed CLI has been kept"); await click("Try again");
    expect(h.plan).toHaveBeenCalledOnce(); expect(h.start).not.toHaveBeenCalled();
  });
  it("guided providers do not promise automatic installation", async () => {
    const h = await mount({ guided: true }); await click("Activate Codex");
    expect(document.body.textContent).toContain("uses its official setup flow");
    expect(document.body.textContent).not.toContain("install the Codex CLI in the background");
    await click("Continue setup"); expect(h.start).toHaveBeenCalledOnce();
  });
  it("removes a ready task row without auto-launching or leaving the modal stuck", async () => {
    const h = await mount({ existing: operation() }); await click("View Codex activation");
    await h.render({ discovery: { ...h.getProps().discovery, ids: ["codex"] } });
    await h.publish([{ ...operation("ready"), installed: true }]);
    expect(document.querySelector("[role=status]")?.textContent).toBe("Activated");
    expect(document.querySelector("[aria-label='Stop activating Codex']")).toBeNull();
    expect(h.action).not.toHaveBeenCalled(); await click("Close"); expect(document.querySelector("[role=dialog]")).toBeNull();
  });
  it("preserves progress when receiving stale snapshots", () => {
    const store = new LocalAgentActivationStore(undefined);
    store.accept({ epoch: "one", revision: 5, operations: [operation("cancelled")] });
    store.accept({ epoch: "one", revision: 4, operations: [operation()] });
    expect(store.getSnapshot().snapshot.operations[0].status).toBe("cancelled");
    store.accept({ epoch: "two", revision: 0, operations: [] });
    store.accept({ epoch: "one", revision: 6, operations: [operation()] });
    expect(store.getSnapshot().snapshot.epoch).toBe("two");
  });
});
