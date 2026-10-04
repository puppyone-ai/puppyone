import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { createWorkspaceRootUri, createWorkspaceResourceUri, getWorkspaceResourcePath, canonicalizeResourceUri, isDocumentDataNode, withEditorDocumentOperations, type DataPort, type Workspace, type WorkspaceFolder } from "@puppyone/shared-ui";
import { DesktopCloudShell } from "../../../components/DesktopCloudShell";
import { DesktopOverlayPortal } from "../../app-shell/DesktopOverlayPortal";
import { DesktopWorkspaceSwitcher } from "../../app-shell/DesktopWorkspaceSwitcher";
import { DesktopWorkspaceLocationSurface } from "../../app-shell/DesktopWorkspaceLocationSurface";
import { useDesktopPreference, selectFileIconTheme, useDesktopPreferenceEffects, initializeDesktopPreferences } from "../../settings";
import { EditorHeaderTabs } from "../../editor-workbench/header/EditorHeaderTabs";
import { useCloudWorkspaceSwitch } from "./useCloudWorkspaceSwitch";
import { CloudWorkspaceSwitchDialog } from "./CloudWorkspaceSwitchDialog";
import { CloudSignedOutRoute } from "../auth/CloudSignedOutRoute";
import { useLocalization } from "@puppyone/localization/react";
import type { AppLanguagePreference } from "@puppyone/localization/core";
import type { DesktopCloudAuthState } from "../../../lib/cloudSession";
import { useNativeCloudWorkbench } from "./useNativeCloudWorkbench";
import { DesktopCloudFileWorkspace } from "./DesktopCloudFileWorkspace";
import { DesktopDataWorkspaceSurface, type DesktopDataWorkspaceSurfaceProps } from "../../app-shell/DesktopDataWorkspaceSurface";
import { resolveWorkspaceSurface } from "../../app-shell/workspace-surfaces/workspaceSurfaceRegistry";
import { useDesktopEditorWorkbench } from "../../editor-workbench/controller/useDesktopEditorWorkbench";
import { useDataNodeActions } from "../../data-workspace/useDataNodeActions";
import type { DesktopCloudSession } from "../../../lib/cloudApi";

initializeDesktopPreferences({ getItem: () => null, setItem: () => {}, removeItem: () => {} });

const API = "http://127.0.0.1:9090/api/v1";
const localRoot = createWorkspaceRootUri("cloud-switch-fixture-local");
const localPath = createWorkspaceResourceUri(localRoot, "readme.txt");
const localWorkspace: Workspace = { id: "cloud-switch-fixture", name: "Native workspace", path: "/Users/demo/native-workspace", status: "recording" };
const localFolder: WorkspaceFolder = { id: localWorkspace.id, name: localWorkspace.name, uri: localRoot,
  index: 0, capabilities: { read: true, write: true, watch: false, execute: true }, trustState: "trusted", workspace: localWorkspace };
const localNodes = [{ id: localPath, name: "readme.txt", path: localPath, type: "text" as const, source: "local" as const },
  { id: "local-only", name: "local-only.md", path: createWorkspaceResourceUri(localRoot, "local-only.md"), type: "markdown" as const, source: "local" as const }];
const resolveLocal = (path: string | null) => ({ folder: localFolder,
  providerPath: path ? getWorkspaceResourcePath(localRoot, canonicalizeResourceUri(path)) : "", resourceUri: path ? canonicalizeResourceUri(path) : localRoot });
const noop = () => undefined;
const fileSurface = resolveWorkspaceSurface({ capabilities: { cloudEnabled: true }, requestedId: "data",
  adapters: { data: () => ({ sidebar: null, main: null }), git: () => ({ sidebar: null, main: null }),
    cloud: () => ({ sidebar: null, main: null }), settings: () => ({ sidebar: null, main: null }) } });
const session: DesktopCloudSession = { api_base_url: API, user_id: "fixture-user", user_email: "user@example.com",
  session_generation: "fixture-session", status: "authenticated", expires_at: Date.now() + 3_600_000, expires_in: 3600 };
const context = { status: "resolved" as const, projectId: "fixture-project", projectName: "Native workspace",
  target: { kind: "project_root" as const, project_id: "fixture-project" }, capabilities: ["content.read", "content.write"] };
const cloudFiles = new Map([
  ["readme.txt", "CLOUD_FILE_BODY"], ["cloud-only.md", "# Cloud only"], ["records/sample.csv", "Name,Value\nCloud,42"],
]);
let head = 1;
const cloudWrites: Array<{ path: string; content: string }> = [];
const localWrites: Array<{ path: string; content: string }> = [];
const localSaveCompletions: Array<() => void> = [];
const requests: string[] = [];
const authStateListeners = new Set<(state: DesktopCloudAuthState) => void>();
const authErrorListeners = new Set<(payload: { message?: string }) => void>();
window.puppyoneDesktop = {
  ...window.puppyoneDesktop,
  startCloudOAuth: async () => {
    for (const listener of authStateListeners) listener({ status: "signing-in", session: null });
    return { ok: true };
  },
  onCloudAuthStateChanged: (listener) => { authStateListeners.add(listener); return () => { authStateListeners.delete(listener); }; },
  onCloudAuthError: (listener) => { authErrorListeners.add(listener); return () => { authErrorListeners.delete(listener); }; },
  requestCloudSessionApi: async (request) => {
    requests.push(request.path);
    const url = new URL(request.path, API);
    const operation = url.pathname.split("/").at(-1);
    const path = url.searchParams.get("path") ?? "";
    const body = request.body ? JSON.parse(request.body) : null;
    if (operation === "ls") {
      const names = new Set([...cloudFiles.keys()].filter((file) => !path || file.startsWith(`${path}/`))
        .map((file) => file.slice(path.length + (path ? 1 : 0)).split("/")[0]!));
      return { entries: [...names].map((name) => ({ path: [path, name].filter(Boolean).join("/"), name,
        type: cloudFiles.has([path, name].filter(Boolean).join("/")) ? "file" : "folder", children_count: 1 })), head_commit_id: `cloud-${head}` };
    }
    if (operation === "stat") return { path, name: path.split("/").at(-1), type: cloudFiles.has(path) ? "file" : "folder", exists: true };
    if (operation === "cat") return { content_text: cloudFiles.get(path), head_commit_id: `cloud-${head}` };
    if (operation === "write") {
      if (body.base_commit_id !== `cloud-${head}`) return { transport: "puppyone-cloud-ipc-v1", ok: false, error: { status: 409, message: "Fixture conflict" } };
      cloudFiles.set(body.path, body.content); cloudWrites.push({ path: body.path, content: body.content }); head++;
      return { path: body.path, commit_id: `cloud-${head}`, conflicts: [] };
    }
    throw new Error(`Unexpected fixture request: ${request.path}`);
  },
} as NonNullable<typeof window.puppyoneDesktop>;

declare global {
  interface Window { __nativeCloudWorkbenchSmoke?: {
    state: () => { location: string; cloudWrites: typeof cloudWrites; localWrites: typeof localWrites; requests: string[] };
    edit: (location: "local" | "cloud", text: string) => void;
    finishLocalSaves: () => void;
    setCloudSessionAvailable: (available: boolean) => void;
    setLoginAppearance: (theme: "light" | "dark", locale: AppLanguagePreference) => Promise<void>;
    resetLogin: () => void;
    failLogin: () => void;
  }; }
}

/** No network or real workspace bytes: exercises production file and editor hosts. */
export function NativeCloudWorkbenchSmokeHarness() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const { setLanguagePreference } = useLocalization();
  const [cloudSelected, setCloudSelected] = useState(false);
  const [cloudSessionAvailable, setCloudSessionAvailable] = useState(true);
  const location = cloudSelected && cloudSessionAvailable ? "cloud" : "local";
  useEffect(() => { if (!cloudSessionAvailable) setCloudSelected(false); }, [cloudSessionAvailable]);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useDesktopPreferenceEffects();
  const explorerWidth = useDesktopPreference(s => s.explorerWidth);
  const fileIconTheme = useDesktopPreference(selectFileIconTheme);
  const filesVisibilitySettings = useDesktopPreference(s => s.filesVisibilitySettings);
  const setSidebarCollapsed = useDesktopPreference(s => s.setSidebarCollapsed);
  const sidebarCollapsed = useDesktopPreference(s => s.sidebarCollapsed);
  const workbench = useNativeCloudWorkbench({ context, session: cloudSessionAvailable ? session : null, apiBaseUrl: API,
    active: location === "cloud", filesVisibilitySettings: filesVisibilitySettings });
  const commitCloud = useCallback(() => setCloudSelected(true), []);
  const controller = useCloudWorkspaceSwitch({ enabled: true, scope: localWorkspace.id,
    session: cloudSessionAvailable ? session : null, service: workbench.service,
    providerError: workbench.error, initializationPending: false, onCommit: commitCloud });
  const localPort = useMemo<DataPort>(() => withEditorDocumentOperations({
    listChildren: async () => localNodes,
    resolveNode: async (path) => localNodes.find((node) => node.path === path) ?? null,
    readFile: async (path) => ({ path, name: "readme.txt", type: "text", content: "LOCAL_FILE_BODY", version: "local-1" }),
    documentPersistence: { kind: "local-fs", storageIdentity: "fixture-local-files", persist: (request) => {
      localWrites.push({ path: request.path, content: request.content });
      return new Promise((resolve) => localSaveCompletions.push(() => resolve({ ok: true, version: "local-2" })));
    } },
  }), []);
  const localWorkbench = useDesktopEditorWorkbench(localWorkspace, localPort.resolveNode!, localRoot,
    (path) => ({ rootUri: localRoot, resourcePath: getWorkspaceResourcePath(localRoot, canonicalizeResourceUri(path)), hostPath: path }), localWorkspace.id);
  const localActions = useDataNodeActions({ dataPort: localPort, workspace: localWorkspace,
    setActiveExplorerNode: noop, onEnterDataView: noop, onLocalWorkspaceContentChanged: noop, onWorkspaceContentChanged: noop,
    onActivateNode: (node) => { if (isDocumentDataNode(node)) localWorkbench.openDocument(node); }, onResourceMoved: localWorkbench.rebaseResource, onResourceDeleted: localWorkbench.closeUnderResource });
  const openedLocal = useRef(false);
  useEffect(() => { if (!openedLocal.current) { openedLocal.current = true; localWorkbench.openDocument(localNodes[0]!); } }, [localWorkbench]);
  const commonSurfaceProps: DesktopDataWorkspaceSurfaceProps = {
    activeAiEditRequest: null, activeDocumentPath: localWorkbench.activePath, activeExplorerPath: localWorkbench.activePath,
    dataPort: localPort, editorWorkbench: localWorkbench, externalOpen: { open: noop },
    showSaveStatus: false,
    fileClipboardController: localActions.fileClipboardController, fileOperationNotice: null,
    navigation: { activeView: "data", availableSurfaceIds: ["data", "settings"], gitEnabled: true,
      gitIncomingCount: 0, gitOperationLoading: null, gitStatus: null, workspaceChangeCount: 0,
      onNavigate: noop, onOpenPlugins: noop, onOpenSettings: noop, pluginsOpen: false, settingsOpen: false,
      showPlugins: false, showSettings: true, showWorkspaceNavigation: true },
    onActiveDataPathChange: async (path, node) => {
      const target = node ?? (path ? await localPort.resolveNode!(path) : null);
      if (target && isDocumentDataNode(target)) localWorkbench.openDocument(target);
    }, onActiveDataNodeChange: noop, onResourceMove: localWorkbench.rebaseResource, onRemoveProject: noop,
    onCreateEntryMenu: noop, onDismissCreateEntryMenu: noop, onNodeActionMenu: noop,
    openCreateEntryParentPath: undefined, openNodeActionPath: null, resolvedSurface: fileSurface,
    viewerExtensionAdapter: undefined, workspace: localWorkspace, workspaceFolders: [localFolder],
    resolveWorkspaceResource: resolveLocal, workspaceRefreshToken: { sequence: 0, entries: [] },
    workspaceAtomicRefreshToken: 0, workspaceSurfaceError: null, sidebarCreateMenuOpen: false,
  };
  const visibleWorkbench = location === "cloud" ? workbench.editorWorkbench : localWorkbench;
  useEffect(() => {
    window.__nativeCloudWorkbenchSmoke = {
      state: () => ({ location, cloudWrites, localWrites, requests }),
      edit: (target, text) => {
        const element = document.querySelector(`[data-workspace-location="${target}"] .cm-editor`);
        const view = element ? EditorView.findFromDOM(element as HTMLElement) : null;
        if (!view) throw new Error(`No ${target} CodeMirror view`);
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      },
      setCloudSessionAvailable,
      setLoginAppearance: async (nextTheme, locale) => { setTheme(nextTheme); await setLanguagePreference(locale); },
      resetLogin: () => { for (const listener of authStateListeners) listener({ status: "signed-out", session: null }); },
      failLogin: () => { for (const listener of authErrorListeners) listener({ message: "Fixture browser sign-in failed. Try again." }); },
      finishLocalSaves: () => { localSaveCompletions.splice(0).forEach((finish) => finish()); },
    };
    return () => { delete window.__nativeCloudWorkbenchSmoke; };
  }, [location, setLanguagePreference]);
  return <div className={`app-shell${theme === "dark" ? " dark" : ""}`} data-po-appearance-root="true" data-native-cloud-smoke-ready="true">
    <DesktopOverlayPortal theme={theme}>{null}</DesktopOverlayPortal>
    <DesktopCloudShell workspaceLocation={location} leftSidebarCollapsed={sidebarCollapsed} leftSidebarWidth={explorerWidth}
      onLeftSidebarExpand={() => setSidebarCollapsed(false)}
      titlebarCenteredSlot={<DesktopWorkspaceSwitcher open={menuOpen} refObject={menuRef} titlebarLabel={localWorkspace.name}
        workspace={localWorkspace} workspaceFolders={[]} multiRootWorkspacesEnabled={false}
        projectLocation={{ current: location, localAvailable: true, cloudState: "available" }} cloudProject={{ id: context.projectId }}
        onClose={() => setMenuOpen(false)} onToggle={() => setMenuOpen((current) => !current)}
        onViewLocal={() => { controller.cancel(); setCloudSelected(false); setMenuOpen(false); }} onViewCloud={() => { controller.request(); setMenuOpen(false); }} />}
      titlebarTabs={<EditorHeaderTabs activeEditorId={visibleWorkbench.activeEditorId}
        editors={visibleWorkbench.state.editors} fileIconTheme={fileIconTheme}
        storageIdentity={location === "cloud" ? workbench.dataPort?.documentPersistence?.storageIdentity ?? null : localPort.documentPersistence!.storageIdentity}
        onActivate={visibleWorkbench.activate} onClose={location === "cloud" ? workbench.closeEditor : visibleWorkbench.close}
        onMove={visibleWorkbench.moveTab} />}>
      <DesktopWorkspaceLocationSurface location={location}
        local={<DesktopDataWorkspaceSurface {...commonSurfaceProps} />}
        cloud={<DesktopCloudFileWorkspace workbench={workbench} surfaceProps={commonSurfaceProps}
          providerStateContent={null} />} />
    </DesktopCloudShell>
    <CloudWorkspaceSwitchDialog controller={controller} authenticationRequired={!cloudSessionAvailable}
      gate={<CloudSignedOutRoute compact activeSection="contents" apiBaseUrl={API}
        authState={{ status: "signed-out", apiBaseUrl: API }} loadingLabel="Restoring Cloud session…" />} />
  </div>;
}
