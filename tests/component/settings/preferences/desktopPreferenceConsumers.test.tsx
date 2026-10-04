// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { DataWorkspace, type Workspace } from "@puppyone/shared-ui";
import { initializeDesktopPreferences, desktopPreferencesStore as store, useDesktopPreference } from "../../../../src/preferencesStore";
import { createSettingsWorkspaceSurface, type SettingsWorkspaceSurfaceProps } from "../../../../src/features/settings/SettingsWorkspaceSurface";
import { BUILTIN_SUB_THEME_CATALOG } from "../../../../src/features/settings/appearanceSlice";
import { DesktopDataWorkspaceSurface } from "../../../../src/features/app-shell/DesktopDataWorkspaceSurface";
import { DesktopPaneLayoutProvider } from "../../../../src/features/app-shell/layout/DesktopPaneLayoutContext";
import { resolveDesktopPaneLayout } from "../../../../src/features/app-shell/layout/desktopPaneLayout";
import { resolveWorkspaceSurface } from "../../../../src/features/app-shell/workspace-surfaces/workspaceSurfaceRegistry";
import { useDesktopEditorWorkbench } from "../../../../src/features/editor-workbench/controller/useDesktopEditorWorkbench";
import { withTestLocalization } from "../../../support/react/localization";

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
  onFilesVisibilitySettingsChange: value => store.getState().setFilesVisibilitySettings(value),
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
    fileClipboardController={{ clipboard: null, cutPaths: new Set(), operation: null, notice: null, canCopy: false, canCut: false,
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
    click('input[aria-label="Git card in Header"]');
    expect(store.getState().experimentalSettings).toEqual({ ...before, enableGitCardInHeader: true });
    act(() => initializeDesktopPreferences());
    expect(host.querySelector<HTMLInputElement>('input[aria-label="Git card in Header"]')?.checked).toBe(true);
  });
  it("retains expanded preference width while the shell track is collapsed and observes live resize/icon changes", () => {
    store.getState().setExplorerWidth(390);
    act(() => root.render(withTestLocalization(<DataSurface collapsed />)));
    expect(host.querySelector("[data-width]")?.getAttribute("data-width")).toBe("390");
    expect(host.querySelector("[data-collapsed]")?.getAttribute("data-collapsed")).toBe("true");
    click("[data-width] button");
    expect(store.getState().explorerWidth).toBe(410);
    expect(host.querySelector("[data-width]")?.getAttribute("data-width")).toBe("410");
    act(() => store.getState().setFileIconTheme("semantic"));
    expect(host.querySelector("[data-icons]")?.getAttribute("data-icons")).toBe("semantic");
    act(() => store.getState().setExperimentalSettings(s => ({ ...s, enableMarkdownBlockDrag: true, enableMarkdownHeadingOutline: true })));
    expect(host.querySelector("[data-block-drag]")?.getAttribute("data-block-drag")).toBe("true");
    expect(host.querySelector("[data-heading-outline]")?.getAttribute("data-heading-outline")).toBe("true");
    act(() => root.render(withTestLocalization(<DataSurface collapsed={false} />)));
    expect(host.querySelector("[data-width]")?.getAttribute("data-width")).toBe("275");
    click("[data-width] button + button");
    expect(store.getState().sidebarCollapsed).toBe(true);
  });
});
