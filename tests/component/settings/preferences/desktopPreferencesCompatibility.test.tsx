// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDesktopPreferences, type DesktopPreferencesController } from "../../../../src/features/app-shell/useDesktopPreferences";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let latest: DesktopPreferencesController;
function Harness() { latest = useDesktopPreferences(); return null; }
function stored() {
  return Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)]));
}
function mount() { act(() => root.render(<Harness />)); }
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

describe("desktop preference wire compatibility (locked before the store migration)", () => {
  it("writes every default using the original key and wire format", () => {
    mount(); expect(stored()).toMatchSnapshot();
    expect(latest.rightSidebarOpen).toBe(false);
  });
  it("normalizes corrupt persisted values without changing default output", () => {
    mount(); const keys = Object.keys(stored());
    act(() => root.unmount()); root = createRoot(host);
    keys.forEach(key => localStorage.setItem(key, "{broken"));
    mount(); expect(stored()).toMatchSnapshot();
  });
  it("migrates legacy agent routes, menu, tools and experiments", () => {
    localStorage.setItem("puppyone.desktop.agentPreferredRuntime", " codex ");
    localStorage.setItem("puppyone.desktop.agentPreferredModel", " gpt-5 ");
    localStorage.setItem("puppyone.desktop.localAgents", JSON.stringify({ hiddenTerminalAgentIds: ["workbuddy", "codex", "codex", "INVALID ID"], chatHistoryDiscoveryEnabled: true }));
    localStorage.setItem("puppyone.desktop.rightSidebarTools", JSON.stringify({ terminal: false }));
    localStorage.setItem("puppyone.desktop.experimentalSettings", JSON.stringify({ enableNotionImport: true, enableGitAutoCommit: true, enableShareOnboarding: false }));
    localStorage.setItem("puppyone.desktop.createNewMenu", JSON.stringify({ items: [{kind: "csv", enabled: true, placement: "main"}] }));
    localStorage.setItem("puppyone.desktop.explorerWidth", "1.9");
    localStorage.setItem("puppyone.desktop.rightSidebarWidth", "500.7");
    localStorage.setItem("puppyone.desktop.projectSwitcherWidth", "99999");
    localStorage.setItem("puppyone.desktop.externalApps", "retired");
    mount(); expect(stored()).toMatchSnapshot();
  });
  it("retains functional updater actions and round-trips all six domains", () => {
    mount();
    act(() => {
      latest.setPointerCursors(v => !v);
      latest.setLoadingAnimationPreset("ikun");
      latest.setExplorerWidth(v => v + 45);
      latest.setSidebarCollapsed(v => !v);
      latest.setProjectSwitcherExpanded(v => !v);
      latest.setProjectSwitcherWidth(v => v + 20);
      latest.setRightSidebarWidth(v => v + 50);
      latest.setRightSidebarSurface("history");
      latest.setRightSidebarOpen(true);
      latest.setDiffMarkers("symbols");
      latest.setGitDisplayMode("professional");
      latest.setGitSidebarLayout("dividers");
      latest.setAgentPreferredRuntime("codex");
      latest.setAgentFileActivityIndicatorsEnabled(v => !v);
      latest.setAiEditAssistEnabled(v => !v);
      latest.setFilesVisibilitySettings(v => ({ ...v, showHiddenFiles: true }));
      latest.setLocalAgentsSettings(v => ({ ...v, chatHistoryDiscoveryEnabled: true }));
      latest.setExperimentalSettings({ ...latest.experimentalSettings, enableCloudWorkspace: true });
    });
    act(() => latest.setAgentPreferredModel("gpt-5"));
    act(() => latest.setThemeMode("dark"));
    act(() => latest.setSubThemeId("default.newspaper"));
    const saved = stored(); expect(saved).toMatchSnapshot();
    act(() => root.unmount()); root = createRoot(host); mount();
    expect(stored()).toEqual(saved);
    expect(latest.rightSidebarOpen).toBe(false);
    expect(latest.agentPreferredRuntime).toBe("codex");
    expect(latest.agentPreferredModel).toBe("gpt-5");
    expect(document.documentElement.dataset.agentFileActivity).toBe("visible");
  });
  it("currently throws if legacy storage reads are unavailable", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new DOMException("Denied", "SecurityError"); });
    expect(mount).toThrow("Denied");
  });
});
