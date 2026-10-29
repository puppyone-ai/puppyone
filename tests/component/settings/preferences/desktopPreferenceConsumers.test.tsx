// @vitest-environment happy-dom
import { act, Profiler, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { DataWorkspace, type Workspace } from "@puppyone/shared-ui";
import { initializeDesktopPreferences, desktopPreferencesStore as store, useDesktopPreference } from "../../../../src/preferencesStore";
import { createSettingsWorkspaceSurface, type SettingsWorkspaceSurfaceProps } from "../../../../src/features/settings/SettingsWorkspaceSurface";
import { BUILTIN_SUB_THEME_CATALOG } from "../../../../src/features/settings/appearanceSlice";
import { DesktopTitlebarActions } from "../../../../src/features/app-shell/DesktopTitlebarActions";
import { DesktopDataWorkspaceSurface } from "../../../../src/features/app-shell/DesktopDataWorkspaceSurface";
import { DesktopPaneLayoutProvider } from "../../../../src/features/app-shell/layout/DesktopPaneLayoutContext";
import { resolveDesktopPaneLayout } from "../../../../src/lib/desktopPaneLayout";
import { resolveWorkspaceSurface } from "../../../../src/features/app-shell/workspace-surfaces/workspaceSurfaceRegistry";
import { useDesktopEditorWorkbench } from "../../../../src/features/editor-workbench/controller/useDesktopEditorWorkbench";
import { withTestLocalization } from "../../../support/react/localization";
import { PLUGIN_FILE_ICON_THEME_ID } from "../../../support/appearance/pluginFileIconTheme";

// Only the default theme ships; installing a test plug-in theme brings back the
// File icons choice so its ordering and persistence stay covered.
vi.mock("../../../../packages/shared-ui/src/file/icon-themes/registry", async (original) => {
  const { withPluginFileIconTheme } = await import("../../../support/appearance/pluginFileIconTheme");
  return withPluginFileIconTheme(await original());
});

vi.mock("@puppyone/shared-ui", async (original) => ({
  ...await original<typeof import("@puppyone/shared-ui")>(),
  DataWorkspace: (props: ComponentProps<typeof DataWorkspace>) => <div data-width={props.explorerWidth} data-collapsed={String(props.explorerCollapsed)} data-icons={props.fileIconTheme} data-block-drag={String(props.editorInteractionPreferences?.markdownBlockDragEnabled)} data-heading-outline={String(props.editorInteractionPreferences?.markdownHeadingOutlineEnabled)}>
    <button onClick={() => props.onExplorerWidthChange?.(410)}>Resize Explorer</button>
    <button onClick={() => props.onExplorerCollapsedChange?.(!props.explorerCollapsed)}>Toggle Explorer</button>
  </div>,
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const noop = () => {};
const workspace: Workspace = { id: "preferences", name: "Fixture", path: "/fixture/preferences", status: "recording" };
const settings: SettingsWorkspaceSurfaceProps = {
  workspace, activeSection: "appearance", onSelectSection: noop, onOpenImport: noop,
  onFilesVisibilityChange: noop,
  subThemeCatalog: { snapshot: BUILTIN_SUB_THEME_CATALOG, status: "ready", error: null,
    openDirectory: async () => ({ opened: false }), createTheme: async () => ({ created: false }) },
  git: { status: null, loading: false, error: null, refresh: noop },
  cloud: { enabled: false, session: null, sessionRestoring: false, apiBaseUrl: null, onSessionChange: noop },
  workspaceConfig: { value: null, loading: false, saving: false, error: null, change: async value => value, unlink: async () => {} },
  updates: { state: { status: "idle", currentVersion: "0.0.0", channel: "dev", automaticallyDownloadUpdates: false,
    availableVersion: null, updateInfo: null, progress: null, blockers: [], error: null, reason: null, lastCheckedAt: null, updatedAt: "" },
    check: noop, install: noop, automaticDownloadPreferenceAvailable: false, automaticDownloadPreferenceSaving: false,
    automaticDownloadPreferenceError: false, setAutomaticallyDownloadUpdates: noop },
};
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear(); initializeDesktopPreferences();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); localStorage.clear(); });
function renderSettings(section: SettingsWorkspaceSurfaceProps["activeSection"]) {
  const surface = createSettingsWorkspaceSurface({ ...settings, activeSection: section });
  act(() => root.render(withTestLocalization(<>{surface.sidebar}{surface.main}</>)));
}
function click(selector: string) {
  const target = host.querySelector<HTMLInputElement>(selector); expect(target).not.toBeNull(); act(() => target!.click());
}
function DataSurface({ collapsed }: { collapsed: boolean }) {
  const editorWorkbench = useDesktopEditorWorkbench(null, null);
  const pane = resolveDesktopPaneLayout({ availableWidth: 1000, explorer: { present: true, collapsed, preferredWidth: 275 },
    rightSidebar: { present: false, open: false, preferredWidth: 560 } });
  const resolvedSurface = resolveWorkspaceSurface({ capabilities: { cloudEnabled: false }, requestedId: "data",
    adapters: { data: () => ({ sidebar: null, main: null }), git: () => ({ sidebar: null, main: null }),
      cloud: () => ({ sidebar: null, main: null }), settings: () => ({ sidebar: null, main: null }) } });
  return <DesktopPaneLayoutProvider value={pane}><DesktopDataWorkspaceSurface
    workspace={workspace} workspaceFolders={[]} resolveWorkspaceResource={() => null} editorWorkbench={editorWorkbench}
    activeAiEditRequest={null} activeDocumentPath={null} activeExplorerPath={null}
    dataPort={{ listChildren: async () => [] }} externalOpen={{ open: noop }} showSaveStatus={false}
    fileClipboardController={{ clipboard: null, cutPaths: new Set(), operation: null, notice: null, dismissNotice: noop, canCopy: false, canCut: false,
      canDuplicate: false, copyNodes: noop, cutNodes: noop, pasteNodes: async () => {}, duplicateNodes: async () => {}, canPasteInto: () => false }}
    fileOperationNotice={null} viewerExtensionAdapter={null} resolvedSurface={resolvedSurface}
    navigation={{ activeView: "data", availableSurfaceIds: ["data"], gitEnabled: false, gitIncomingCount: 0,
      gitOperationLoading: null, gitStatus: null, workspaceChangeCount: 0, onNavigate: noop, onOpenPlugins: noop,
      onOpenSettings: noop, pluginsOpen: false, settingsOpen: false, showPlugins: false, showSettings: false, showWorkspaceNavigation: false }}
    onActiveDataPathChange={noop} onActiveDataNodeChange={noop} onResourceMove={noop} onRemoveProject={noop}
    openCreateEntryParentPath={undefined} openNodeActionPath={null} onCreateEntryMenu={noop} onDismissCreateEntryMenu={noop} onNodeActionMenu={noop}
    workspaceRefreshToken={{ sequence: 0, entries: [] }} workspaceAtomicRefreshToken={0} workspaceSurfaceError={null} sidebarCreateMenuOpen={false}
  /></DesktopPaneLayoutProvider>;
}

describe("mounted desktop preference consumers", () => {
  it("does not render the production Account section when unrelated preferences change", async () => {
    const commits = vi.fn();
    const { main } = createSettingsWorkspaceSurface({ ...settings, activeSection: "account",
      cloud: { ...settings.cloud, enabled: true, apiBaseUrl: "http://fixture.invalid/api/v1" } });
    await act(async () => root.render(withTestLocalization(<Profiler id="account" onRender={commits}>{main}</Profiler>)));
    expect(host.textContent).toContain("Account");
    const mountedCommits = commits.mock.calls.length;
    act(() => store.getState().setPointerCursors(true));
    expect(commits).toHaveBeenCalledTimes(mountedCommits);
    act(() => store.getState().setGitDisplayMode("professional"));
    expect(commits).toHaveBeenCalledTimes(mountedCommits);
    act(() => {
      store.getState().setLocalAgentsSettings(current => ({ ...current, chatHistoryDiscoveryEnabled: true }));
      store.getState().setExperimentalSettings(current => ({ ...current, enableOtherAppImports: true }));
      store.getState().setTypographyPreferences(current => ({ ...current, scale: "large" }));
    });
    expect(commits).toHaveBeenCalledTimes(mountedCommits);
  });
  it("updates pointer cursors from real settings without notifying unrelated layout/editor/agent selectors", () => {
    const counts = { pointer: 0, layout: 0, editor: 0, agent: 0 };
    function Pointer() { useDesktopPreference(s => s.pointerCursors); counts.pointer++; return null; }
    function Layout() { useDesktopPreference(s => s.explorerWidth); counts.layout++; return null; }
    function Editor() { useDesktopPreference(s => s.aiEditAssistEnabled); counts.editor++; return null; }
    function Agent() { useDesktopPreference(s => s.localAgentsSettings); counts.agent++; return null; }
    const { main } = createSettingsWorkspaceSurface(settings);
    act(() => root.render(withTestLocalization(<>{main}<Pointer /><Layout /><Editor /><Agent /></>)));
    const before = { ...counts };
    click('input[aria-labelledby="desktop-pointer-cursors-label"]');
    expect(store.getState().pointerCursors).toBe(true);
    expect(counts).toEqual({ ...before, pointer: before.pointer + 1 });
    expect(host.querySelector<HTMLInputElement>('input[aria-labelledby="desktop-pointer-cursors-label"]')?.checked).toBe(true);
  });
  it("hides file icons from the real setting without notifying unrelated layout/editor/agent selectors", () => {
    const counts = { fileIcons: 0, layout: 0, editor: 0, agent: 0 };
    function FileIcons() { useDesktopPreference(s => s.showFileIcons); counts.fileIcons++; return null; }
    function Layout() { useDesktopPreference(s => s.explorerWidth); counts.layout++; return null; }
    function Editor() { useDesktopPreference(s => s.aiEditAssistEnabled); counts.editor++; return null; }
    function Agent() { useDesktopPreference(s => s.localAgentsSettings); counts.agent++; return null; }
    const { main } = createSettingsWorkspaceSurface(settings);
    act(() => root.render(withTestLocalization(<>{main}<FileIcons /><Layout /><Editor /><Agent /></>)));
    const before = { ...counts };
    const selector = 'input[aria-labelledby="desktop-show-file-icons-label"]';
    expect(host.querySelector<HTMLInputElement>(selector)?.checked).toBe(true);
    click(selector);
    expect(store.getState().showFileIcons).toBe(false);
    expect(counts).toEqual({ ...before, fileIcons: before.fileIcons + 1 });
    expect(host.querySelector<HTMLInputElement>(selector)?.checked).toBe(false);
  });
  it("keeps the production appearance controls ordered", () => {
    renderSettings("appearance");
    const list = host.querySelector(".desktop-settings-lead-list")!;
    expect(list.children[0].classList.contains("desktop-theme-mode-row")).toBe(true);
    expect(list.children[1].classList.contains("desktop-theme-settings-section")).toBe(true);
    expect(list.lastElementChild?.querySelector(".desktop-interface-style-segment")).not.toBeNull();
    expect(list.lastElementChild?.previousElementSibling?.querySelector("#desktop-pointer-cursors-label")).not.toBeNull();
    expect(list.querySelectorAll(".desktop-theme-segment.desktop-appearance-option-segment")).toHaveLength(1);
    expect(list.querySelectorAll(".desktop-appearance-hug-segment")).toHaveLength(0);
    // The retired animation presets have no control of their own.
    expect(list.querySelector("[data-pulse-grid-point]")).toBeNull();
    // The retired Git sidebar layout comparison has no control either.
    expect(list.querySelector('[aria-label="Git sidebar layout"]')).toBeNull();
  });
  it("offers no loading style choice while only the rounded style is offered", () => {
    const appearance = JSON.parse(localStorage.getItem("puppyone.desktop.appearance") ?? "null");
    act(() => root.unmount());
    root = createRoot(host);
    // A stored dither choice from before dither was withdrawn reads as rounded.
    localStorage.setItem("puppyone.desktop.appearance", JSON.stringify({
      ...appearance, shared: { ...appearance?.shared, loadingPlaceholderStyle: "dither" },
    }));
    initializeDesktopPreferences();
    renderSettings("appearance");
    expect(host.querySelector('[aria-label="Loading style"]')).toBeNull();
    expect(store.getState().loadingPlaceholderStyle).toBe("rounded");
  });
  it("preserves icon selection when switching root themes and hides fixed color-mode controls", () => {
    renderSettings("appearance");
    const icons = host.querySelectorAll<HTMLButtonElement>(".desktop-theme-segment.desktop-appearance-option-segment")[0];
    const options = icons.querySelectorAll<HTMLButtonElement>("button");
    act(() => options[1].click());
    expect(store.getState().fileIconTheme).not.toBe("default");
    const requested = store.getState().fileIconTheme;
    act(() => store.getState().setInterfaceStyle("windows-xp"));
    expect(options[1].getAttribute("aria-pressed")).toBe("true");
    expect(store.getState().fileIconTheme).toBe(requested);
    expect(host.querySelector(".desktop-theme-mode-row")).toBeNull();
  });
  it("updates the mounted titlebar directly from the Header controls and retains action callbacks", () => {
    const terminal = vi.fn();
    const { main } = createSettingsWorkspaceSurface(settings);
    act(() => root.render(withTestLocalization(<>{main}<DesktopTitlebarActions terminalSidebarOpen={false}
      terminalToolEnabled gitChangesAvailable onToggleTerminal={terminal} /></>)));
    click(".desktop-titlebar-terminal");
    expect(terminal).toHaveBeenCalledOnce();
    const toggles = host.querySelectorAll<HTMLInputElement>(".desktop-settings-tool-item input");
    act(() => toggles[1].click());
    expect(store.getState().titlebarActionsSettings.enabled.terminal).toBe(false);
    expect(store.getState().rightSidebarToolsSettings.enabled.terminal).toBe(false);
    expect(host.querySelector(".desktop-titlebar-terminal")).toBeNull();
    expect(host.querySelector(".desktop-titlebar-changes")).not.toBeNull();
    expect(JSON.parse(localStorage.getItem("puppyone.desktop.titlebarActions")!).enabled.terminal).toBe(false);
    expect(JSON.parse(localStorage.getItem("puppyone.desktop.rightSidebarTools")!).enabled.terminal).toBe(false);
    act(() => toggles[1].click());
    expect(host.querySelector(".desktop-titlebar-terminal")).not.toBeNull();
    expect(store.getState().rightSidebarToolsSettings.enabled.terminal).toBe(true);
  });
  it("updates file visibility in its control and notifies the workspace refresh owner", () => {
    const refresh = vi.fn();
    const { main } = createSettingsWorkspaceSurface({ ...settings, activeSection: "files", onFilesVisibilityChange: refresh });
    act(() => root.render(withTestLocalization(main)));
    click('input[type="checkbox"]');
    expect(store.getState().filesVisibilitySettings.showHiddenFiles).toBe(true);
    expect(JSON.parse(localStorage.getItem("puppyone.desktop.filesVisibility")!).showHiddenFiles).toBe(true);
    expect(refresh).toHaveBeenCalledOnce();
  });
  it("wires the real Sub Theme picker to per-root persisted preferences", () => {
    renderSettings("appearance");
    const select = host.querySelector<HTMLSelectElement>(".desktop-theme-pack-select"); expect(select).not.toBeNull();
    act(() => { select!.value = "default.github"; select!.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(store.getState().byRootTheme.default.requestedSubThemeIds.light).toBe("default.github");
    expect(select!.value).toBe("default.github");
    expect(JSON.parse(localStorage.getItem("puppyone.desktop.appearance")!).byRootTheme.default.requestedSubThemeIds.light).toBe("default.github");
  });
  it("updates only the requested experiment from mounted settings and persists after remount", () => {
    renderSettings("experimental"); const before = store.getState().experimentalSettings;
    click('[role="group"][aria-label="Project switcher position"] button:last-child');
    expect(store.getState().experimentalSettings).toEqual({ ...before, enableProjectSwitcherRail: true });
    act(() => initializeDesktopPreferences());
    expect(host.querySelector('[role="group"][aria-label="Project switcher position"] button:last-child')?.getAttribute("aria-pressed")).toBe("true");
  });
  it("retains expanded preference width while the shell track is collapsed and observes live resize/icon changes", () => {
    store.getState().setExplorerWidth(390);
    act(() => root.render(withTestLocalization(<DataSurface collapsed />)));
    expect(host.querySelector("[data-width]")?.getAttribute("data-width")).toBe("390");
    expect(host.querySelector("[data-collapsed]")?.getAttribute("data-collapsed")).toBe("true");
    click("[data-width] button");
    expect(store.getState().explorerWidth).toBe(410);
    expect(host.querySelector("[data-width]")?.getAttribute("data-width")).toBe("410");
    act(() => store.getState().setFileIconTheme(PLUGIN_FILE_ICON_THEME_ID));
    expect(host.querySelector("[data-icons]")?.getAttribute("data-icons")).toBe(PLUGIN_FILE_ICON_THEME_ID);
    act(() => store.getState().setExperimentalSettings(s => ({ ...s, enableMarkdownBlockDrag: true, enableMarkdownHeadingOutline: true })));
    expect(host.querySelector("[data-block-drag]")?.getAttribute("data-block-drag")).toBe("true");
    expect(host.querySelector("[data-heading-outline]")?.getAttribute("data-heading-outline")).toBe("true");
    act(() => root.render(withTestLocalization(<DataSurface collapsed={false} />)));
    expect(host.querySelector("[data-width]")?.getAttribute("data-width")).toBe("275");
    click("[data-width] button + button");
    expect(store.getState().sidebarCollapsed).toBe(true);
  });
});
