/** @vitest-environment happy-dom */
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestLocalizationProvider } from "@puppyone/localization/testing";
import { mergeCatalogNamespaces } from "@puppyone/localization/core";
import { LocalAgentSetupSection } from "../../../../src/features/local-agents/ui/LocalAgentSetupSection";
import { installDesktopBridge } from "../../../support/electron/desktopBridge";
import type { LocalAgentSetupSnapshot, LocalAgentSetupRequest } from "../../../../shared/local-agent-installation/setup-types";
import type { LocalAgentInstallationSnapshot } from "../../../../shared/local-agent-installation/types";
import settings from "../../../../locales/renderer/en/settings.json";
import common from "../../../../locales/renderer/en/common.json";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const messages = mergeCatalogNamespaces({ settings, common });
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ""; delete (window as Window & { puppyoneDesktop?: unknown }).puppyoneDesktop; });

const preferences = { enabled: true, dismissedSetupIds: [], snoozedUntil: {} };
function setupSnapshot(generation = 1): LocalAgentSetupSnapshot {
  return { revision: `revision:${generation}`, installationGeneration: generation, entries: [
    { setupId: "codex", installationId: "codex", displayName: "Codex", strategy: "external-cli", status: "not-found", companionPresent: true, recommended: true },
    { setupId: "cursor", installationId: "cursor", displayName: "Cursor", strategy: "external-cli", status: "not-found", companionPresent: true, recommended: true },
  ] };
}
function installationSnapshot(generation = 1): LocalAgentInstallationSnapshot {
  return { schemaVersion: 1, generation, scanId: `scan:${generation}`, source: "scan", requestedAt: "2026-09-19T00:00:00Z", completedAt: "2026-09-19T00:00:00Z", results: [], availableAgentIds: [] };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function button(label: string) {
  const found = Array.from(document.querySelectorAll("button")).find((node) => node.textContent === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
async function click(label: string) { await act(async () => { button(label).click(); }); }
async function mount() {
  let response = setupSnapshot();
  const inspect = vi.fn(async (_request: LocalAgentSetupRequest) => response);
  const action = vi.fn(async () => ({ status: "guide-opened" as const }));
  const release = vi.fn(async () => {});
  const onPreferencesChange = vi.fn(); const onRefresh = vi.fn();
  const launcherButton = document.createElement("button");
  launcherButton.textContent = "Built-in Agent";
  document.body.append(launcherButton);
  installDesktopBridge({ localAgentSetup: { inspect, act: action, release } });
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  let props: ComponentProps<typeof LocalAgentSetupSection> = {
    enabled: true, surface: "chat", eligibleInstallationIds: ["codex", "cursor"], hiddenAgentIds: [], preferences,
    onPreferencesChange, onRefresh, onReturnToLauncher: () => launcherButton.focus(),
    discovery: { ids: [], phase: "ready", snapshot: installationSnapshot(), hasFailures: false, refreshing: false, progress: null },
  };
  const render = async (patch: Partial<typeof props> = {}) => {
    props = { ...props, ...patch };
    await act(async () => { root!.render(<TestLocalizationProvider messages={messages}><LocalAgentSetupSection {...props} /></TestLocalizationProvider>); });
  };
  await render();
  return { inspect, action, release, onPreferencesChange, onRefresh, render, getProps: () => props, setResponse(value: LocalAgentSetupSnapshot) { response = value; } };
}

describe("Local Agent activation guidance", () => {
  it("shows one stable recommendation, explains activation and only opens a trusted guide", async () => {
    const h = await mount();
    expect(document.querySelectorAll(".local-agent-setup-card")).toHaveLength(1);
    expect(document.body.textContent).not.toContain("Cursor app detected");
    expect(document.body.textContent).not.toContain("Set up Agents");
    expect(document.querySelector("details")?.open).toBe(false);
    await click("Activate Codex");
    expect(document.body.textContent).toContain("Install the official Codex CLI");
    expect(document.activeElement).toBe(document.querySelector("h3"));
    expect(h.action).not.toHaveBeenCalled();
    await click("Open official setup guide");
    expect(h.action).toHaveBeenCalledWith({ clientId: expect.any(String), revision: "revision:1", setupId: "codex", actionId: "open-guide", mode: "recommendation" });
    expect(document.querySelector("[role=status]")?.textContent).toContain("Official guide opened");
    expect(document.body.textContent).not.toContain("CLI detected");
    await click("Scan"); expect(h.onRefresh).toHaveBeenCalledOnce();
  });

  it("keeps focus while a found CLI invalidates a recommendation and never replaces it with another", async () => {
    const h = await mount(); const activate = button("Activate Codex");
    await act(async () => { activate.focus(); });
    const found = setupSnapshot(2); found.entries[0] = { ...found.entries[0], status: "found", recommended: false };
    h.setResponse(found);
    await h.render({ discovery: { ...h.getProps().discovery, ids: ["codex"], snapshot: installationSnapshot(2) } });
    expect(document.activeElement).toBe(activate);
    expect(activate.getAttribute("aria-disabled")).toBe("true");
    expect(document.body.textContent).toContain("suggestion for Codex has changed");
    await act(async () => { button("Built-in Agent").focus(); });
    expect(document.querySelector(".local-agent-setup-card")).toBeNull();
    expect(document.body.textContent).not.toContain("Activate Cursor");
  });

  it("converges an open setup view to detected without stealing focus or automatically launching", async () => {
    const h = await mount(); await click("Activate Codex");
    const guide = button("Open official setup guide"); guide.focus();
    const found = setupSnapshot(2); found.entries[0] = { ...found.entries[0], status: "found", recommended: false };
    h.setResponse(found);
    await h.render({ discovery: { ...h.getProps().discovery, ids: ["codex"], snapshot: installationSnapshot(2) } });
    expect(document.activeElement).toBe(guide);
    expect(guide.getAttribute("aria-disabled")).toBe("true");
    expect(document.body.textContent).toContain("CLI detected");
    await click("Open official setup guide"); expect(h.action).not.toHaveBeenCalled();
    await click("Close"); expect(document.activeElement).toBe(button("Built-in Agent"));
    expect(document.querySelector(".local-agent-setup")).toBeNull();
  });

  it("snoozes for seven days, returns to the launcher and leaves no setup directory", async () => {
    const h = await mount(); await click("Remind me in 7 days");
    const value = h.onPreferencesChange.mock.calls[0][0];
    expect(value.snoozedUntil.codex).toBeGreaterThan(Date.now() + 6.9 * 86_400_000);
    expect(document.querySelector(".local-agent-setup-card")).toBeNull();
    expect(document.querySelector(".local-agent-setup")).toBeNull();
    expect(document.activeElement).toBe(button("Built-in Agent"));
  });

  it("turns suggestions off without removing the manual directory or enabling passive scans", async () => {
    const h = await mount();
    await h.render({ preferences: { ...preferences, enabled: false }, presentation: "settings" });
    expect(document.querySelector(".local-agent-setup-card")).toBeNull();
    expect(h.inspect.mock.lastCall?.[0]).toMatchObject({ preferences: { enabled: false } });
    await click("Set up Agents"); await click("Codex"); await click("Open official setup guide");
    expect(h.action).toHaveBeenCalledOnce();
    await click("Close"); expect(document.activeElement).toBe(button("Set up Agents"));
  });

  it("renders nothing in the launcher when no recommendation is eligible", async () => {
    const h = await mount();
    await h.render({ preferences: { ...preferences, enabled: false } });
    expect(document.querySelector(".local-agent-setup")).toBeNull();
    const absent = setupSnapshot(2);
    absent.entries.forEach(entry => { entry.recommended = false; entry.companionPresent = false; });
    h.setResponse(absent);
    await h.render({ preferences, discovery: { ...h.getProps().discovery, snapshot: installationSnapshot(2) } });
    expect(document.querySelector(".local-agent-setup")).toBeNull();
  });

  it("restores the activation trigger on close and collapses options with Escape", async () => {
    await mount(); await click("Activate Codex"); await click("Close");
    expect(document.activeElement).toBe(button("Activate Codex"));
    const options = document.querySelector("details")!;
    const summary = options.querySelector("summary")!;
    await act(async () => {
      options.open = true;
      button("Remind me in 7 days").focus();
      options.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(options.open).toBe(false);
    expect(document.activeElement).toBe(summary);
    await click("Don’t suggest again");
    expect(document.activeElement).toBe(button("Built-in Agent"));
  });

  it("does not resurrect a closed view when an external action completes late", async () => {
    const h = await mount(); const gate = deferred<{ status: "guide-opened" }>(); h.action.mockReturnValueOnce(gate.promise);
    await click("Activate Codex"); await click("Open official setup guide"); await click("Close");
    await act(async () => { gate.resolve({ status: "guide-opened" }); });
    expect(document.querySelector(".local-agent-setup-detail")).toBeNull();
    expect(document.body.textContent).not.toContain("Official guide opened");
  });

  it("fences late stale snapshots and disables guidance during a refresh", async () => {
    const h = await mount(); await click("Activate Codex");
    const gate = deferred<LocalAgentSetupSnapshot>(); h.inspect.mockReturnValueOnce(gate.promise);
    await h.render({ discovery: { ...h.getProps().discovery, phase: "loading" } });
    expect(button("Open official setup guide").getAttribute("aria-disabled")).toBe("true");
    const found = setupSnapshot(3); found.entries[0] = { ...found.entries[0], status: "found", recommended: false };
    h.setResponse(found);
    await h.render({ discovery: { ...h.getProps().discovery, phase: "ready", ids: ["codex"], snapshot: installationSnapshot(3) } });
    await act(async () => { gate.resolve(setupSnapshot(2)); });
    expect(document.body.textContent).toContain("CLI detected");
    expect(document.body.textContent).not.toContain("Install the official Codex CLI");
  });
});
