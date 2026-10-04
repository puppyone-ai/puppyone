import { installDesktopBridge } from "../../../support/electron/desktopBridge";
import type { GitAutoCommitSnapshot } from "../../../../src/types/electron";
// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { desktopPreferencesStore as store, initializeDesktopPreferences, useDesktopPreference } from "../../../../src/preferencesStore";
import { useDesktopAppearance } from "../../../../src/features/settings/useDesktopAppearance";
import { useDesktopPreferenceEffects } from "../../../../src/features/settings/useDesktopPreferenceEffects";
import { getInterfaceStyleFirstPaint } from "../../../../src/features/appearance/interfaceStyles";
import { resolveDesktopAppearance } from "../../../../src/features/settings/appearanceSlice";
import { selectAgentPreferredRoute } from "../../../../src/features/settings/agentSlice";
import { CREATE_NEW_MENU_STORAGE_KEY, LOCAL_AGENTS_STORAGE_KEY } from "../../../../src/preferences";
import { APPEARANCE_PREFERENCES_STORAGE_KEY } from "../../../../src/features/appearance/appearancePreferences";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let dark: boolean;
let mediaListeners: Set<() => void>;
const background = vi.fn();
const chrome = vi.fn(async () => ({ applied: true }));
function Effects() { useDesktopPreferenceEffects(); return null; }
function Appearance() {
  const { resolvedAppearance } = useDesktopAppearance();
  return <output>{resolvedAppearance.effectiveColorMode}:{resolvedAppearance.subThemeId}</output>;
}
function fireStorage(key: string | null, newValue: string | null) {
  act(() => window.dispatchEvent(new StorageEvent("storage", { key, newValue })));
}
beforeEach(() => {
  localStorage.clear(); dark = false; mediaListeners = new Set(); background.mockClear(); chrome.mockClear();
  vi.stubGlobal("matchMedia", () => ({ get matches() { return dark; },
    addEventListener: (_: string, fn: () => void) => mediaListeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => mediaListeners.delete(fn) }));
  installDesktopBridge({ setWindowBackground: background, setWindowChromeProfile: chrome });
  initializeDesktopPreferences();
  host = document.createElement("div"); host.innerHTML = '<div class="desktop-titlebar" style="background-color: rgb(11, 22, 33)"></div>';
  document.body.append(host); root = createRoot(document.createElement("div"));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete window.puppyoneDesktop; });

describe("desktop preference effects and subscriptions", () => {
  it("applies the generated native first paint, titlebar color and chrome profile for each theme", () => {
    act(() => root.render(<><Effects /><Appearance /></>));
    for (const style of ["default", "windows-xp"] as const) {
      for (const mode of ["light", "dark", "system"] as const) {
        act(() => { store.getState().setInterfaceStyle(style); store.getState().setThemeMode(mode); });
        const resolved = resolveDesktopAppearance(store.getState());
        const paint = getInterfaceStyleFirstPaint(style, resolved.effectiveColorMode, resolved.subTheme);
        expect(background).toHaveBeenLastCalledWith({ background: paint.background, titlebarBackground: "rgb(11, 22, 33)",
          themeSource: resolved.themeMode === "system" ? "system" : paint.colorScheme });
        expect(chrome).toHaveBeenLastCalledWith({ titlebar: resolved.composition.titlebar });
        expect(document.documentElement.dataset.interfaceStyle).toBe(style);
        expect(document.documentElement.dataset.navigationComposition).toBe(resolved.composition.navigation);
        expect(document.documentElement.style.getPropertyValue("--initial-shell-background")).toBe(paint.background);
      }
    }
  });
  it("responds to OS color mode and agent indicators with StrictMode cleanup", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    act(() => root.render(<StrictMode><Effects /><Appearance /></StrictMode>));
    expect(mediaListeners.size).toBe(1);
    act(() => { dark = true; mediaListeners.forEach(fn => fn()); store.getState().setAgentFileActivityIndicatorsEnabled(true); });
    expect(document.documentElement.dataset.initialTheme).toBe("dark");
    expect(document.documentElement.dataset.agentFileActivity).toBe("visible");
    act(() => root.unmount()); root = createRoot(document.createElement("div"));
    expect(mediaListeners.size).toBe(0);
    const added = add.mock.calls.filter(c => c[0] === "storage").map(c => c[1]);
    const removed = remove.mock.calls.filter(c => c[0] === "storage").map(c => c[1]);
    expect(added).toHaveLength(2); expect(removed).toEqual(added);
    const before = store.getState();
    fireStorage(LOCAL_AGENTS_STORAGE_KEY, '{"chatHistoryDiscoveryEnabled":true}');
    expect(store.getState()).toBe(before);
  });
  it("only notifies selected fields, including stable empty routes and shallow appearance inputs", () => {
    const renders = { pointer: 0, width: 0, agent: 0, appearance: 0 };
    function Pointer() { useDesktopPreference(s => s.pointerCursors); renders.pointer++; return null; }
    function Width() { useDesktopPreference(s => s.explorerWidth); renders.width++; return null; }
    function Agent() { useDesktopPreference(selectAgentPreferredRoute); renders.agent++; return null; }
    function Theme() { useDesktopAppearance(); renders.appearance++; return null; }
    act(() => root.render(<><Pointer /><Width /><Agent /><Theme /></>));
    expect(renders).toEqual({ pointer: 1, width: 1, agent: 1, appearance: 1 });
    act(() => { store.getState().setPointerCursors(true); store.getState().setPointerCursors(true); });
    expect(renders).toEqual({ pointer: 2, width: 1, agent: 1, appearance: 1 });
    act(() => store.getState().setExplorerWidth(v => v + 1));
    expect(renders).toEqual({ pointer: 2, width: 2, agent: 1, appearance: 1 });
    act(() => { store.getState().setAgentPreferredRuntime("codex"); store.getState().setAgentPreferredModel("gpt-5"); });
    expect(renders).toEqual({ pointer: 2, width: 2, agent: 2, appearance: 1 });
  });
  it("synchronizes only the legacy cross-window channels and resets menu/agents on clear", () => {
    act(() => root.render(<Effects />));
    fireStorage(LOCAL_AGENTS_STORAGE_KEY, '{"hiddenTerminalAgentIds":["codex"],"chatHistoryDiscoveryEnabled":true}');
    expect(store.getState().localAgentsSettings.hiddenTerminalAgentIds).toEqual(["codex"]);
    fireStorage(CREATE_NEW_MENU_STORAGE_KEY, '{"version":5,"main":["csv"],"submenu":[],"hidden":[]}');
    expect(store.getState().createNewMenuSettings.main).toEqual(["csv", "customFiles"]);
    const before = store.getState();
    fireStorage("unrelated", "true");
    fireStorage(APPEARANCE_PREFERENCES_STORAGE_KEY, '{"schemaVersion":99}');
    expect(store.getState()).toBe(before);
    fireStorage(null, null);
    expect(store.getState().localAgentsSettings.hiddenTerminalAgentIds).toEqual([]);
    expect(store.getState().createNewMenuSettings.main).toContain("markdown");
  });
  it("hydrates main-owned consent, sends opt-in, excludes it from storage and ignores late snapshots after cleanup", async () => {
    let listener: ((s: GitAutoCommitSnapshot) => void) | undefined;
    let resolveFetch!: (s: GitAutoCommitSnapshot) => void;
    const stop = vi.fn();
    const setOptIn = vi.fn(async ({ enabled }: { enabled: boolean }) => snapshot(enabled));
    installDesktopBridge({ ...window.puppyoneDesktop,
      getGitAutoCommitSettings: () => new Promise(resolve => { resolveFetch = resolve; }),
      onGitAutoCommitStateChanged: fn => { listener = fn; return stop; },
      setGitAutoCommitExperimentalOptIn: setOptIn,
    });
    act(() => root.render(<Effects />));
    await act(async () => { resolveFetch(snapshot(true)); });
    expect(store.getState().experimentalSettings.enableGitAutoCommit).toBe(true);
    await act(async () => store.getState().setExperimentalSettings(s => ({ ...s, enableGitAutoCommit: false, enableCloudWorkspace: true })));
    expect(setOptIn).toHaveBeenCalledWith({ enabled: false });
    expect(store.getState().experimentalSettings.enableGitAutoCommit).toBe(false);
    expect(JSON.parse(localStorage.getItem("puppyone.desktop.experimental")!)).not.toHaveProperty("enableGitAutoCommit");
    act(() => root.unmount()); root = createRoot(document.createElement("div"));
    expect(stop).toHaveBeenCalledOnce(); listener?.(snapshot(true));
    expect(store.getState().experimentalSettings.enableGitAutoCommit).toBe(false);
  });
  it("keeps in-memory edits usable and legacy routing inputs recoverable after failed writes", () => {
    const values = new Map([["puppyone.desktop.agentPreferredRuntime", "codex"], ["puppyone.desktop.agentPreferredModel", "gpt-5"]]);
    const remove = vi.fn((key: string) => { values.delete(key); });
    initializeDesktopPreferences({ getItem: key => values.get(key) ?? null, setItem: () => { throw new Error("quota"); }, removeItem: remove });
    store.getState().setSidebarCollapsed(true);
    expect(store.getState().sidebarCollapsed).toBe(true);
    expect(values.get("puppyone.desktop.agentPreferredModel")).toBe("gpt-5");
    expect(remove).not.toHaveBeenCalledWith("puppyone.desktop.agentPreferredModel");
    expect(store.getState()).not.toHaveProperty("terminalSessionLayout");
  });
  it("does not overwrite unreadable preference data with fallback defaults", () => {
    localStorage.setItem("puppyone.desktop.gitDisplayMode", "professional");
    const get = vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("read denied"); });
    const write = vi.spyOn(localStorage, "setItem");
    initializeDesktopPreferences();
    store.getState().setPointerCursors(true);
    expect(write).not.toHaveBeenCalled();
    get.mockRestore();
    expect(localStorage.getItem("puppyone.desktop.gitDisplayMode")).toBe("professional");
  });
  it("survives a denied localStorage getter and denied writes/removals", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("Denied", "SecurityError"); });
    expect(() => initializeDesktopPreferences()).not.toThrow();
    act(() => root.render(<Effects />));
    act(() => store.getState().setAiEditAssistEnabled(true));
    expect(store.getState().aiEditAssistEnabled).toBe(true);
  });
});

function snapshot(experimentalOptIn: boolean): GitAutoCommitSnapshot {
  return { available: true, experimentalOptIn, repository: false, workspacePolicy: null, effectiveEnabled: false, runtime: null };
}
