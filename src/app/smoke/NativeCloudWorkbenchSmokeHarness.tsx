import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AuxiliaryWorkbenchPanel } from "../../features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchPanel";
import { EditorView } from "@codemirror/view";
import { createWorkspaceRootUri, createWorkspaceResourceUri, getWorkspaceResourcePath, canonicalizeResourceUri, isDocumentDataNode, withEditorDocumentOperations, type DataPort, type Workspace, type WorkspaceFolder } from "@puppyone/shared-ui";
import { DesktopCloudShell } from "../../components/DesktopCloudShell";
import { resetDesktopPlatformCapabilitiesForTests } from "../../platform";
import { DesktopOverlayPortal } from "../../components/DesktopOverlayPortal";
import { DesktopTitlebarContext } from "../../features/app-shell/DesktopTitlebarContext";
import { DesktopTitlebarActions } from "../../features/app-shell/DesktopTitlebarActions";
import { CloudWorkspaceHeaderTools } from "../../features/cloud/workbench/CloudWorkspaceHeaderTools";
import { captureCloudWorkspaceShareResource } from "../../features/cloud/share/cloudWorkspaceShareResource";
import { DesktopWorkspaceLocationSurface } from "../../features/app-shell/DesktopWorkspaceLocationSurface";
import { useDesktopPreference, useDesktopPreferenceEffects, initializeDesktopPreferences } from "../../features/settings";
import { CloudDialog } from "../../features/cloud/CloudDialog";
import { CloudSignedOutRoute } from "../../features/cloud/auth/CloudSignedOutRoute";
import { LocalFolderCloudNotice } from "../../features/cloud/project/LocalFolderCloudNotice";
import { resolveLocalFolderCloudEntry, resolveLocalFolderCloudNotice } from "../../features/cloud/project/localFolderCloudNoticeState";
import { MissingCloudProjectReplacement } from "../../features/cloud/project/MissingCloudProjectReplacement";
import { CloudLocalOnlyWorkspace } from "../../features/cloud/initialization/CloudInitializationView";
import type { ProjectHomeItem } from "../../lib/workspaceHomeModel";
import { cloudMessage } from "../../features/cloud/cloudPresentation";
import type { ProjectCloudContext } from "../../features/cloud/project/context/projectCloudContext";
import { useLocalization } from "@puppyone/localization/react";
import type { AppLanguagePreference } from "@puppyone/localization/core";
import type { DesktopCloudAuthState } from "../../lib/cloudSession";
import { useNativeCloudWorkbench, type NativeCloudWorkbench } from "../../features/cloud/workbench/useNativeCloudWorkbench";
import { DesktopCloudFileWorkspace } from "../../features/cloud/workbench/DesktopCloudFileWorkspace";
import { DesktopDataWorkspaceSurface, type DesktopDataWorkspaceSurfaceProps } from "../../features/app-shell/DesktopDataWorkspaceSurface";
import { resolveWorkspaceSurface } from "../../features/app-shell/workspace-surfaces/workspaceSurfaceRegistry";
import { useDesktopEditorWorkbench } from "../../features/editor-workbench/controller/useDesktopEditorWorkbench";
import { useDataNodeActions } from "../../features/data-workspace/useDataNodeActions";
import type { DesktopCloudSession } from "../../lib/cloudApi";
import { createCloudAgentSmokeFixture, editCloudAgentPrompt } from "../../features/cloud/agent/CloudAgentSmokeFixture";
import { useCloudAgentWorkspace } from "../../features/cloud/agent/useCloudAgentWorkspace";
import { CloudWorkspaceSidebar } from "../../features/cloud/workbench/CloudWorkspaceSidebar";
import { useCloudWorkspaceSidebar, type CloudWorkspaceSidebarController } from "../../features/cloud/workbench/useCloudWorkspaceSidebar";
import { cloudHistorySmokeFixture } from "../../features/cloud/workbench/cloudRepositorySmokeFixture";

initializeDesktopPreferences({ getItem: () => null, setItem: () => {}, removeItem: () => {} });

const API = "https://cloud-fixture.puppyone.ai/api/v1";
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
const context = { status: "resolved" as const, projectId: "11111111-1111-4111-8111-111111111111", projectName: "Native workspace",
  target: { kind: "project_root" as const, project_id: "11111111-1111-4111-8111-111111111111" }, capabilities: ["content.read", "content.write", "access_surface.manage"] };
/** The local folder's own association, resolved the way the app resolves it. */
function resolveSmokeRepositoryContext(localOnly: boolean, wrongHost: boolean, missing: boolean, signedIn: boolean): ProjectCloudContext {
  if (localOnly) return { status: "local-only", projectId: null };
  if (wrongHost) return { status: "wrong-host", projectId: context.projectId,
    message: cloudMessage("remote-wrong-host", { origin: "http://api.puppyone.ai" }) };
  if (!signedIn) return { status: "wrong-account", projectId: context.projectId, message: cloudMessage("remote-sign-in") };
  if (missing) return { status: "not-found", projectId: context.projectId, message: cloudMessage("remote-not-found") };
  return context;
}
const cloudRemote = `${API.replace("/api/v1", "")}/git/${context.projectId}.git`;
const cloudFiles = new Map([
  ["readme.txt", "CLOUD_FILE_BODY"], ["cloud-only.md", "# Cloud only"], ["records/sample.csv", "Name,Value\nCloud,42"],
  ["notes.md", "# Cloud note\n\n![Cloud diagram](/assets/diagram.svg)"],
  ["assets/diagram.svg", "fixture-image"], ["report.xlsx", "fixture-binary"],
  ["settings.json", '{"cloud":true}'], ["page.html", "<!doctype html><html><head><title>Cloud page</title></head><body><h1>Cloud HTML</h1></body></html>"],
]);
const cloudBytes = new Map<string, Uint8Array>();
const workspaceListeners = new Set<(event: { id: string; type: "change"; generation: string }) => void>();
const workspaceWatches = new Map<string, string>();
function notifyWorkspace() {
  for (const [id, generation] of workspaceWatches) for (const listener of workspaceListeners) listener({ id, type: "change", generation });
}
const agentFixture = createCloudAgentSmokeFixture(() => { cloudFiles.set("readme.txt", "AGENT_PUBLISHED_CLOUD_BODY"); notifyWorkspace(); });
function fixtureBytes(path: string) { return cloudBytes.get(path) ?? new TextEncoder().encode(cloudFiles.get(path) ?? ""); }
function listFixtureDirectory(path: string) {
  const names = new Set([...cloudFiles.keys()].filter((file) => !path || file.startsWith(`${path}/`))
    .map((file) => file.slice(path.length + (path ? 1 : 0)).split("/")[0]!));
  return { entries: [...names].map((name) => {
    const file = [path, name].filter(Boolean).join("/");
    return { name, kind: cloudFiles.has(file) ? "file" : "directory", size: fixtureBytes(file).length, modified_ns: "1" };
  }) };
}
async function fixtureFile(path: string) {
  const bytes = fixtureBytes(path);
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return { name: path.split("/").at(-1), kind: "file", size: bytes.length, modified_ns: "1", content_base64: btoa(binary),
    revision: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("") };
}
const cloudWrites: Array<{ path: string; content: string }> = [];
const localWrites: Array<{ path: string; content: string }> = [];
const localSaveCompletions: Array<() => void> = [];
const requests: string[] = [];
const publishRequests: Array<string | undefined> = [];
let cloudToolsAvailable = false;
let cloudProjectMissing = false;
const detachRequests: string[][] = [];
let cloudReadBarrier: Promise<void> | null = null;
let finishCloudRead: (() => void) | null = null;
const authStateListeners = new Set<(state: DesktopCloudAuthState) => void>();
const authErrorListeners = new Set<(payload: { message?: string }) => void>();
window.puppyoneDesktop = {
  ...window.puppyoneDesktop,
  ...window.__nativeCloudChromeBridge,
  ...window.__nativeCloudPreviewBridge,
  watchCloudWorkspace: async ({ id, generation }) => { workspaceWatches.set(id, generation); return { id }; },
  stopCloudWorkspaceWatch: async ({ id }) => { workspaceWatches.delete(id); },
  onCloudWorkspaceEvent: (listener) => { workspaceListeners.add(listener); return () => { workspaceListeners.delete(listener); }; },
  startCloudOAuth: async () => {
    for (const listener of authStateListeners) listener({ status: "signing-in", session: null });
    return { ok: true };
  },
  onCloudAuthStateChanged: (listener) => { authStateListeners.add(listener); return () => { authStateListeners.delete(listener); }; },
  onCloudAuthError: (listener) => { authErrorListeners.add(listener); return () => { authErrorListeners.delete(listener); }; },
  requestCloudSessionApi: agentFixture.wrap(async (request) => {
    requests.push(request.path);
    const url = new URL(request.path, API);
    const operation = url.pathname.split("/").at(-1);
    const path = url.searchParams.get("path") ?? "";
    const body = request.body ? JSON.parse(request.body) : null;
    if (operation === "repository-context") return cloudProjectMissing
      ? { transport: "puppyone-cloud-ipc-v1", ok: false, error: { status: 404, message: "Project not found" } }
      : { project: { id: context.projectId }, target: context.target };
    if (url.pathname === "/projects/11111111-1111-4111-8111-111111111111") return { id: context.projectId,
      name: context.projectName, capabilities: context.capabilities };
    const metadata = cloudMetadataFixture(operation);
    if (metadata !== undefined) return metadata;
    if (operation === "files") {
      if (cloudReadBarrier) await cloudReadBarrier;
      return listFixtureDirectory(path);
    }
    if (operation === "file" && request.method === "PUT") {
      const previous = cloudFiles.has(body.path) ? (await fixtureFile(body.path)).revision : null;
      if (body.expected_revision !== previous) return { transport: "puppyone-cloud-ipc-v1", ok: false, error: { status: 409, message: "Fixture conflict" } };
      const bytes = Uint8Array.from(atob(body.content_base64), character => character.charCodeAt(0));
      const content = new TextDecoder().decode(bytes);
      cloudBytes.delete(body.path); cloudFiles.set(body.path, content); cloudWrites.push({ path: body.path, content });
      const file = await fixtureFile(body.path);
      notifyWorkspace(); return { revision: file.revision, size: file.size };
    }
    if (operation === "file") {
      if (cloudReadBarrier) await cloudReadBarrier;
      if (!cloudFiles.has(path)) return { transport: "puppyone-cloud-ipc-v1", ok: false, error: { status: 404, message: "Missing fixture" } };
      return fixtureFile(path);
    }
    throw new Error(`Unexpected fixture request: ${request.path}`);
  }),
} as NonNullable<typeof window.puppyoneDesktop>;
// Bootstrap may have cached the no-bridge snapshot before this lazy fixture loaded.
if (window.__nativeCloudChromeBridge) resetDesktopPlatformCapabilitiesForTests();

declare global {
  interface Window {
    __nativeCloudPreviewBridge?: Pick<NonNullable<Window["puppyoneDesktop"]>,
      "createSandboxedPreviewDocument" | "revokeSandboxedPreviewDocument" | "openCloudDatabasePreview"
      | "readCloudDatabasePreviewPage" | "closeCloudNativePreview" | "convertCloudOfficeDocument" | "retainCloudPreviewResource" | "revokeCloudPreviewResource">;
    __nativeCloudChromeBridge?: Pick<NonNullable<Window["puppyoneDesktop"]>,
      "getPlatformCapabilities" | "getWindowChromeState" | "onWindowChromeStateChanged">;
    __nativeCloudWorkbenchSmoke?: {
    state: () => { location: string; cloudWrites: typeof cloudWrites; localWrites: typeof localWrites; requests: string[]; publishRequests: typeof publishRequests; detachRequests: typeof detachRequests; agent: ReturnType<typeof agentFixture.state> };
    editAgent: typeof editCloudAgentPrompt;
    selectLocation: (location: "local" | "cloud") => void;
    requestCloud: () => void;
    edit: (location: "local" | "cloud", text: string) => void;
    openCloudFile: (path: string) => Promise<void>;
    addCloudFixtures: (entries: Array<{ path: string; mimeType: string; content?: string; content_base64?: string }>) => void;
    agentWrite: (path: string, content: string) => void;
    finishLocalSaves: () => void;
    holdCloudRead: () => void;
    finishCloudRead: () => void;
    setCloudToolsAvailable: (available: boolean) => void;
    setCloudSessionAvailable: (available: boolean) => void;
    setRepositoryLocalOnly: (localOnly: boolean) => void;
    setRepositoryWrongHost: (wrongHost: boolean) => void;
    setRepositoryMissing: (missing: boolean) => void;
    finishPublish: () => void;
    setSidebarCollapsed: (collapsed: boolean) => void;
    setCenteredProject: (centered: boolean) => void;
    setLoginAppearance: (theme: "light" | "dark", locale: AppLanguagePreference) => Promise<void>;
    resetLogin: () => void;
    failLogin: () => void;
  }; }
}

/**
 * No network or real workspace bytes: exercises production file and editor hosts.
 *
 * A local folder and its Cloud project are two projects (puppy-issues ADR-001).
 * The window shows one of them; the Cloud project opens as its own project in
 * the retained shell, from the project menu or from the folder's notice.
 */
export function NativeCloudWorkbenchSmokeHarness() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const { setLanguagePreference } = useLocalization();
  const [cloudSelected, setCloudSelected] = useState(false);
  const [cloudSessionAvailable, setCloudSessionAvailable] = useState(true);
  const [repositoryLocalOnly, setRepositoryLocalOnly] = useState(false);
  const [repositoryWrongHost, setRepositoryWrongHost] = useState(false);
  const [repositoryMissing, setRepositoryMissing] = useState(false);
  const repositoryContext = resolveSmokeRepositoryContext(repositoryLocalOnly, repositoryWrongHost, repositoryMissing,
    cloudSessionAvailable);
  const [publishLoading, setPublishLoading] = useState(false);
  const [cloudDialogOpen, setCloudDialogOpen] = useState(false);
  const [replacingMissingProject, setReplacingMissingProject] = useState(false);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const location = cloudSelected && cloudSessionAvailable ? "cloud" : "local";
  useEffect(() => { if (!cloudSessionAvailable) setCloudSelected(false); }, [cloudSessionAvailable]);
  const [centeredProject, setCenteredProject] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useDesktopPreferenceEffects();
  const explorerWidth = useDesktopPreference(s => s.explorerWidth);
  const filesVisibilitySettings = useDesktopPreference(s => s.filesVisibilitySettings);
  const setSidebarCollapsed = useDesktopPreference(s => s.setSidebarCollapsed);
  const sidebarCollapsed = useDesktopPreference(s => s.sidebarCollapsed);
  const activeSession = cloudSessionAvailable ? session : null;
  const workbench = useNativeCloudWorkbench({ context, session: activeSession, apiBaseUrl: API,
    active: location === "cloud", filesVisibilitySettings: filesVisibilitySettings });
  const agent = useCloudAgentWorkspace({ context, session: activeSession, apiBaseUrl: API,
    active: location === "cloud", onPublication: workbench.refresh });
  const cloudSidebar = useCloudWorkspaceSidebar({ context, session: activeSession, apiBaseUrl: API, active: location === "cloud", agent });
  const sidebar = useSmokeLocationSidebars(location, cloudSidebar);
  const closeSidebars = sidebar.close;
  const openCloudProject = useCallback(() => {
    closeSidebars();
    setCloudDialogOpen(false);
    setCloudSelected(true);
  }, [closeSidebars]);
  const openLocalFolder = useCallback(() => { closeSidebars(); setCloudSelected(false); }, [closeSidebars]);
  // The sidebar's Cloud entry for this folder, resolved exactly as the app does.
  const requestCloud = useCallback(() => {
    const entry = resolveLocalFolderCloudEntry(repositoryContext, { signedIn: cloudSessionAvailable, publishPending: publishLoading });
    if (entry.kind === "open") openCloudProject();
    else if (entry.kind === "explain") setNoticeDismissed(false);
    else setCloudDialogOpen(true);
  }, [cloudSessionAvailable, openCloudProject, publishLoading, repositoryContext]);
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
  useEffect(() => {
    window.__nativeCloudWorkbenchSmoke = {
      state: () => ({ location, cloudWrites, localWrites, requests, publishRequests, detachRequests, agent: agentFixture.state() }),
      editAgent: editCloudAgentPrompt,
      selectLocation: (next) => { if (next === "cloud") openCloudProject(); else openLocalFolder(); },
      requestCloud,
      openCloudFile: async (path) => {
        if (!workbench.service) throw new Error("Cloud fixture is unavailable.");
        const resource = createWorkspaceResourceUri(workbench.service.folder.uri, path);
        await workbench.onActivePathChange(resource);
      },
      addCloudFixtures: (entries) => {
        for (const entry of entries) {
          cloudFiles.set(entry.path, entry.content ?? "fixture-binary");
          if (entry.content_base64) cloudBytes.set(entry.path, Uint8Array.from(atob(entry.content_base64), character => character.charCodeAt(0)));
        }
        workbench.refresh();
      },
      agentWrite: (path, content) => { cloudBytes.delete(path); cloudFiles.set(path, content); notifyWorkspace(); },
      edit: (target, text) => {
        const element = document.querySelector(`[data-workspace-location="${target}"] .document-surface-slot.is-committed:not(.is-obscured) .cm-editor`);
        const view = element ? EditorView.findFromDOM(element as HTMLElement) : null;
        if (!view) throw new Error(`No ${target} CodeMirror view`);
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      },
      setCloudToolsAvailable: (available) => { cloudToolsAvailable = available; },
      setCloudSessionAvailable, setSidebarCollapsed, setCenteredProject, setRepositoryLocalOnly, setRepositoryWrongHost,
      setRepositoryMissing: (missing) => { cloudProjectMissing = missing; setRepositoryMissing(missing); setNoticeDismissed(false); },
      finishPublish: () => { setPublishLoading(false); setRepositoryLocalOnly(false); setNoticeDismissed(false); },
      setLoginAppearance: async (nextTheme, locale) => { setTheme(nextTheme); await setLanguagePreference(locale); },
      resetLogin: () => { for (const listener of authStateListeners) listener({ status: "signed-out", session: null }); },
      failLogin: () => { for (const listener of authErrorListeners) listener({ message: "Fixture browser sign-in failed. Try again." }); },
      finishLocalSaves: () => { localSaveCompletions.splice(0).forEach((finish) => finish()); },
      holdCloudRead: () => { workbench.service?.invalidateReads(); cloudReadBarrier = new Promise(resolve => { finishCloudRead = resolve; }); },
      finishCloudRead: () => { cloudReadBarrier = null; finishCloudRead?.(); finishCloudRead = null; },
    };
    return () => { delete window.__nativeCloudWorkbenchSmoke; };
  }, [location, openCloudProject, openLocalFolder, requestCloud, setLanguagePreference, setSidebarCollapsed, workbench]);
  // The account catalog: the folder, linked to its Cloud project, and that
  // Cloud project as its own entry while this account can reach it.
  const linked = repositoryContext.status === "resolved";
  const projectItems: ProjectHomeItem[] = [
    { id: `local:${localWorkspace.path}`, label: localWorkspace.name, localPath: localWorkspace.path,
      ...(linked ? { linkedCloudProject: { id: context.projectId, name: context.projectName } } : {}) },
    ...(cloudSessionAvailable && !repositoryMissing
      ? [{ id: `cloud:${context.projectId}`, label: context.projectName, localPath: "", cloudProjectId: context.projectId }] : []),
  ];
  const projectSwitcher = <DesktopTitlebarContext open={menuOpen} refObject={menuRef} multiRootWorkspacesEnabled={false}
        projectItems={projectItems} {...smokeHeaderProject(location === "cloud" ? workbench.service : null)}
        onClose={() => setMenuOpen(false)} onToggle={() => setMenuOpen((current) => !current)}
        onSelectProject={openLocalFolder} onSelectCloudProject={openCloudProject} />;
  const noticeState = resolveLocalFolderCloudNotice(repositoryContext);
  const cloudProjectNotice = noticeState && !noticeDismissed ? <LocalFolderCloudNotice notice={noticeState}
    onOpenCloudProject={openCloudProject} onSignIn={requestCloud}
    onPutInCloud={() => setReplacingMissingProject(true)} onRetry={noop}
    onDismiss={() => setNoticeDismissed(true)} /> : undefined;
  // The Cloud dialog's own content for this folder: sign in first, then the
  // existing first publish. A linked folder has nothing to do here.
  const publishing = repositoryContext.status === "local-only" || publishLoading;
  const cloudDialogAvailable = !cloudSessionAvailable || publishing;
  useEffect(() => { if (!cloudDialogAvailable) setCloudDialogOpen(false); }, [cloudDialogAvailable]);

  return <div className={`app-shell${theme === "dark" ? " dark" : ""}`} data-po-appearance-root="true" data-native-cloud-smoke-ready="true">
    <DesktopOverlayPortal theme={theme}>{null}</DesktopOverlayPortal>
    <DesktopCloudShell onGoHome={noop} workspaceLocation={location} leftSidebarCollapsed={sidebarCollapsed} leftSidebarWidth={explorerWidth}
      rightSidebarOpen={sidebar.open}
      rightSidebarWidth={360} resizableRightSidebar
      onRightSidebarOpenChange={sidebar.setOpen}
      rightSidebar={pane => <SmokeAgentSidebar location={location} agent={agent} cloudSidebar={cloudSidebar} revisionKey={String(workbench.refreshToken.sequence)} contentVisible={pane.contentVisible} />}
      onLeftSidebarExpand={() => setSidebarCollapsed(false)}
      {...getProjectHeaderSlots(centeredProject, projectSwitcher)}
      titlebarActions={<>
        {location === "cloud" && <CloudWorkspaceHeaderTools context={context}
          getShareResource={() => captureCloudWorkspaceShareResource(workbench)}
          session={activeSession} apiBaseUrl={API} onSessionChange={noop}
          agentOpen={agent.open} onToggleAgent={cloudSidebar.toggleAgent}
          historyOpen={cloudSidebar.historyOpen} onToggleHistory={cloudSidebar.toggleHistory} />}
        <DesktopTitlebarActions terminalSidebarOpen={sidebar.localOpen}
        terminalToolEnabled={location === "local"} gitChangesAvailable={location === "local"}
        onToggleTerminal={sidebar.toggleLocal} onToggleGitChanges={noop} />
      </>}
      >
      <DesktopWorkspaceLocationSurface location={location}
        local={<DesktopDataWorkspaceSurface {...commonSurfaceProps} cloudProjectNotice={cloudProjectNotice} />}
        cloud={<DesktopCloudFileWorkspace workbench={workbench} surfaceProps={commonSurfaceProps}
          providerStateContent={null} />} />
    </DesktopCloudShell>
    {cloudDialogOpen && cloudDialogAvailable && <CloudDialog sidebar={null}
      main={<SmokeCloudDialogContent signedIn={cloudSessionAvailable} publishLoading={publishLoading}
        onPublish={(organizationId) => { publishRequests.push(organizationId); setPublishLoading(true); }} />}
      onClose={() => setCloudDialogOpen(false)} />}
    {replacingMissingProject && repositoryContext.status === "not-found" && <MissingCloudProjectReplacement
      context={repositoryContext} session={session} apiBaseUrl={API}
      status={{ remotes: [{ name: "puppyone", fetchUrl: cloudRemote, pushUrl: cloudRemote, branches: [] }] }}
      onCancel={() => setReplacingMissingProject(false)}
      onRemoveCloudRemote={async remotes => {
        detachRequests.push(remotes.map(remote => remote.name));
        cloudProjectMissing = false; setRepositoryMissing(false); setRepositoryLocalOnly(true);
      }}
      onDone={(outcome) => { setReplacingMissingProject(false); if (outcome === "replaced") setCloudDialogOpen(true); }} />}
  </div>;
}

/** The Header names the project in front, with that project's own folder. */
function smokeHeaderProject(hosted: NativeCloudWorkbench["service"] | null) {
  return hosted
    ? { titlebarLabel: hosted.workspace.name, workspace: hosted.workspace, workspaceFolders: [hosted.folder] }
    : { titlebarLabel: localWorkspace.name, workspace: localWorkspace, workspaceFolders: [localFolder] };
}

/** The Cloud dialog's content for this folder: sign in first, then the existing first publish. */
function SmokeCloudDialogContent({ signedIn, publishLoading, onPublish }: {
  signedIn: boolean;
  publishLoading: boolean;
  onPublish: (organizationId?: string) => void;
}) {
  if (!signedIn) return <CloudSignedOutRoute activeSection="initialize" apiBaseUrl={API}
    loadingLabel="" authState={{ status: "signed-out", apiBaseUrl: API }} />;
  return <CloudLocalOnlyWorkspace activeSection="initialize" workspace={localWorkspace}
    accountEmail={session.user_email} branchName="main" totalCommits={1} localChangeCount={0}
    isGitRepository hasHeadCommit hasCurrentBranch publishLoading={publishLoading}
    organizations={[{ id: "fixture-org", name: "Fixture team" }]}
    selectedOrganizationId="fixture-org" organizationStatus="ready"
    onPublishWorkspace={onPublish} />;
}

function useSmokeLocationSidebars(location: "local" | "cloud", sidebar: CloudWorkspaceSidebarController) {
  const [localOpen, setLocalOpen] = useState(false);
  const localActive = location === "local";
  const closeCloudSidebar = sidebar.close;
  return {
    localOpen: localOpen && localActive,
    open: location === "cloud" ? sidebar.open : localOpen && localActive,
    setOpen: location === "cloud" ? sidebar.setOpen : (open: boolean) => { if (!open || localActive) setLocalOpen(open); },
    toggleLocal: () => { if (localActive) setLocalOpen(open => !open); },
    close: useCallback(() => { setLocalOpen(false); closeCloudSidebar(); }, [closeCloudSidebar]),
  };
}

function SmokeAgentSidebar({ location, agent, cloudSidebar, revisionKey, contentVisible }: {
  location: "local" | "cloud";
  agent: ReturnType<typeof useCloudAgentWorkspace>;
  cloudSidebar: CloudWorkspaceSidebarController;
  revisionKey: string;
  contentVisible: boolean;
}) {
  const { t } = useLocalization();
  const localActive = location === "local";
  return <div className="desktop-right-sidebar-stack">
    <div className={`desktop-right-sidebar-surface ${location === "cloud" ? "is-active" : ""}`} aria-hidden={location !== "cloud"}>
      <CloudWorkspaceSidebar sidebar={cloudSidebar} agent={agent} context={context} session={session} apiBaseUrl={API}
        active={location === "cloud" && contentVisible} title={t("cloud.home.location.cloud")}
        revisionKey={revisionKey} onSessionChange={noop} workbenchPanel={AuxiliaryWorkbenchPanel} />
    </div>
    <div className={`desktop-right-sidebar-surface ${localActive ? "is-active" : ""}`}
      aria-hidden={!localActive} data-native-local-agent="true">{t("agent.panel.chat", { agent: t("shell.navigation.local") })}</div>
  </div>;
}

function getProjectHeaderSlots(centered: boolean, project: ReactNode) {
  return centered ? { titlebarCenteredSlot: project }
    : { titlebarSidebarSlot: <div className="desktop-titlebar-context">{project}</div> };
}

function cloudMetadataFixture(operation: string | undefined) {
    if (!cloudToolsAvailable && ["surfaces", "bindings", "providers"].includes(operation ?? ""))
      return { transport: "puppyone-cloud-ipc-v1", ok: false, error: { status: 404, message: "Not Found" } };
    if (["scopes", "mcp-endpoints", "surfaces", "bindings", "providers"].includes(operation ?? "")) return [];
    if (operation === "access-point") return { project_id: context.projectId, url: "https://cloud-fixture.puppyone.ai/git/project.git", scopes: [] };
    if (operation === "commits") return cloudHistorySmokeFixture(context.projectId);
}
