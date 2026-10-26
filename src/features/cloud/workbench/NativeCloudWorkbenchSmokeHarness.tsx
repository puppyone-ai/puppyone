import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EditorView } from "@codemirror/view";
import { createWorkspaceRootUri, createWorkspaceResourceUri, getWorkspaceResourcePath, canonicalizeResourceUri, isDocumentDataNode, withEditorDocumentOperations, type DataPort, type Workspace, type WorkspaceFolder } from "@puppyone/shared-ui";
import { DesktopCloudShell } from "../../../components/DesktopCloudShell";
import { resetDesktopPlatformCapabilitiesForTests } from "../../../platform/desktopPlatformClient";
import { DesktopOverlayPortal } from "../../app-shell/DesktopOverlayPortal";
import { DesktopTitlebarContext } from "../../app-shell/DesktopTitlebarContext";
import { DesktopTitlebarActions } from "../../app-shell/DesktopTitlebarActions";
import { CloudWorkspaceHeaderTools } from "./CloudWorkspaceHeaderTools";
import { captureCloudWorkspaceShareResource } from "../share/cloudWorkspaceShareResource";
import { DesktopWorkspaceLocationSurface } from "../../app-shell/DesktopWorkspaceLocationSurface";
import { useDesktopPreference, useDesktopPreferenceEffects, initializeDesktopPreferences } from "../../settings";
import { useCloudWorkspaceSwitch } from "./useCloudWorkspaceSwitch";
import { CloudWorkspaceSwitchDialog } from "./CloudWorkspaceSwitchDialog";
import { CloudWorkspacePreparation } from "./CloudWorkspacePreparation";
import { RepositoryCloudSwitchGate } from "./RepositoryCloudSwitchGate";
import { MissingCloudProjectRecovery } from "./MissingCloudProjectRecovery";
import { CloudLocalOnlyWorkspace } from "../initialization/CloudInitializationView";
import { cloudMessage } from "../cloudPresentation";
import type { ProjectCloudContext } from "../project/context/projectCloudContext";
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
import { createCloudAgentSmokeFixture, editCloudAgentPrompt } from "../agent/CloudAgentSmokeFixture";
import { useCloudAgentWorkspace } from "../agent/useCloudAgentWorkspace";
import { CloudWorkspaceSidebar } from "./CloudWorkspaceSidebar";
import { useCloudWorkspaceSidebar, type CloudWorkspaceSidebarController } from "./useCloudWorkspaceSidebar";
import { cloudHistorySmokeFixture } from "./cloudRepositorySmokeFixture";

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
function resolveSmokeRepositoryContext(localOnly: boolean, wrongHost: boolean, missing: boolean): ProjectCloudContext {
  if (missing) return { status: "not-found", projectId: context.projectId, message: cloudMessage("remote-not-found") };
  if (wrongHost) return { status: "wrong-host", projectId: context.projectId,
    message: cloudMessage("remote-wrong-host", { origin: "http://api.puppyone.ai" }) };
  if (localOnly) return { status: "local-only", projectId: null };
  return context;
}
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

/** No network or real workspace bytes: exercises production file and editor hosts. */
export function NativeCloudWorkbenchSmokeHarness() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const { setLanguagePreference } = useLocalization();
  const [cloudSelected, setCloudSelected] = useState(false);
  const [cloudSessionAvailable, setCloudSessionAvailable] = useState(true);
  const [repositoryLocalOnly, setRepositoryLocalOnly] = useState(false);
  const [repositoryWrongHost, setRepositoryWrongHost] = useState(false);
  const [repositoryMissing, setRepositoryMissing] = useState(false);
  const repositoryContext = resolveSmokeRepositoryContext(repositoryLocalOnly, repositoryWrongHost, repositoryMissing);
  const repositoryUnavailable = repositoryContext.status !== "resolved";
  const [publishLoading, setPublishLoading] = useState(false);
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
  const commitCloud = useCallback(() => setCloudSelected(true), []);
  const controller = useCloudWorkspaceSwitch({ enabled: true, scope: localWorkspace.id,
    session: activeSession, service: workbench.service,
    providerError: workbench.error, initializationPending: repositoryUnavailable || publishLoading, onCommit: commitCloud });
  const cloudSidebar = useCloudWorkspaceSidebar({ context, session: activeSession, apiBaseUrl: API, active: location === "cloud", agent });
  const sidebar = useSmokeLocationSidebars(location, controller.pending, cloudSidebar);
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
  const preparingInPlace = cloudSessionAvailable && !repositoryUnavailable && !publishLoading;
  const headerLocation = (preparingInPlace ? controller.requestedLocation : undefined) ?? location;
  useEffect(() => {
    window.__nativeCloudWorkbenchSmoke = {
      state: () => ({ location, cloudWrites, localWrites, requests, publishRequests, detachRequests, agent: agentFixture.state() }),
      editAgent: editCloudAgentPrompt,
      selectLocation: (next) => { if (next === "cloud") controller.request(); else { controller.cancel(); setCloudSelected(false); } },
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
      setRepositoryMissing: (missing) => { cloudProjectMissing = missing; setRepositoryMissing(missing); },
      finishPublish: () => { setPublishLoading(false); setRepositoryLocalOnly(false); },
      setLoginAppearance: async (nextTheme, locale) => { setTheme(nextTheme); await setLanguagePreference(locale); },
      resetLogin: () => { for (const listener of authStateListeners) listener({ status: "signed-out", session: null }); },
      failLogin: () => { for (const listener of authErrorListeners) listener({ message: "Fixture browser sign-in failed. Try again." }); },
      finishLocalSaves: () => { localSaveCompletions.splice(0).forEach((finish) => finish()); },
      holdCloudRead: () => { workbench.service?.invalidateReads(); cloudReadBarrier = new Promise(resolve => { finishCloudRead = resolve; }); },
      finishCloudRead: () => { cloudReadBarrier = null; finishCloudRead?.(); finishCloudRead = null; },
    };
    return () => { delete window.__nativeCloudWorkbenchSmoke; };
  }, [location, setLanguagePreference, setSidebarCollapsed, workbench, controller]);
  const projectSwitcher = <DesktopTitlebarContext open={menuOpen} refObject={menuRef} titlebarLabel={localWorkspace.name}
        workspace={localWorkspace} workspaceFolders={[]} multiRootWorkspacesEnabled={false}
        projectLocation={{ current: location, requested: controller.requestedLocation, headerLocation, loading: controller.pending && !controller.error,
          failed: controller.pending && Boolean(controller.error),
          localAvailable: true, cloudState: "available" }} cloudProject={{ id: context.projectId }}
        onClose={() => setMenuOpen(false)} onToggle={() => setMenuOpen((current) => !current)}
        onViewLocal={() => { sidebar.close(); controller.cancel(); setCloudSelected(false); }}
        onViewCloud={() => { sidebar.close(); controller.request(); }} />;
  return <div className={`app-shell${theme === "dark" ? " dark" : ""}`} data-po-appearance-root="true" data-native-cloud-smoke-ready="true">
    <DesktopOverlayPortal theme={theme}>{null}</DesktopOverlayPortal>
    <DesktopCloudShell onGoHome={noop} workspaceLocation={location} leftSidebarCollapsed={sidebarCollapsed} leftSidebarWidth={explorerWidth}
      rightSidebarOpen={sidebar.open}
      rightSidebarWidth={360} resizableRightSidebar
      onRightSidebarOpenChange={sidebar.setOpen}
      rightSidebar={pane => <SmokeAgentSidebar location={location} pending={controller.pending} agent={agent} cloudSidebar={cloudSidebar} revisionKey={String(workbench.refreshToken.sequence)} contentVisible={pane.contentVisible} />}
      requestedWorkspaceLocation={headerLocation}
      onLeftSidebarExpand={() => setSidebarCollapsed(false)}
      {...getProjectHeaderSlots(centeredProject, projectSwitcher)}
      titlebarActions={<>
        {headerLocation === "cloud" && <CloudWorkspaceHeaderTools context={location === "cloud" ? context : null}
          getShareResource={() => captureCloudWorkspaceShareResource(workbench)}
          session={activeSession} apiBaseUrl={API} onSessionChange={noop}
          agentOpen={agent.open} onToggleAgent={cloudSidebar.toggleAgent}
          historyOpen={cloudSidebar.historyOpen} onToggleHistory={cloudSidebar.toggleHistory} />}
        <DesktopTitlebarActions terminalSidebarOpen={sidebar.localOpen}
        terminalToolEnabled={headerLocation === "local"} gitChangesAvailable={headerLocation === "local"}
        onToggleTerminal={sidebar.toggleLocal} onToggleGitChanges={noop} />
      </>}
      >
      <DesktopWorkspaceLocationSurface location={location}
        preparation={controller.pending && preparingInPlace ? <CloudWorkspacePreparation controller={controller} /> : undefined}
        local={<DesktopDataWorkspaceSurface {...commonSurfaceProps} />}
        cloud={<DesktopCloudFileWorkspace workbench={workbench} surfaceProps={commonSurfaceProps}
          providerStateContent={null} />} />
    </DesktopCloudShell>
    <CloudWorkspaceSwitchDialog controller={controller} authenticationRequired={!cloudSessionAvailable}
      preparingInPlace={preparingInPlace}
      gate={<RepositoryCloudSwitchGate apiBaseUrl={API} onRetry={controller.retry}
        context={repositoryContext}
        initializationPending={publishLoading}
        missingProjectRecovery={repositoryContext.status === "not-found" ? <MissingCloudProjectRecovery
          context={repositoryContext} session={session} apiBaseUrl={API} onRetry={controller.retry}
          status={{ remotes: [{ name: "puppyone", fetchUrl: `${API.replace('/api/v1', '')}/git/${context.projectId}.git`,
            pushUrl: `${API.replace('/api/v1', '')}/git/${context.projectId}.git`, branches: [] }] }}
          onRemoveCloudRemote={async remotes => {
            detachRequests.push(remotes.map(remote => remote.name));
            cloudProjectMissing = false; setRepositoryMissing(false); setRepositoryLocalOnly(true);
          }} /> : undefined}
        authState={cloudSessionAvailable ? { status: "signed-in", apiBaseUrl: API, session } : { status: "signed-out", apiBaseUrl: API }}
        publishEntry={<CloudLocalOnlyWorkspace activeSection="contents" workspace={localWorkspace}
          accountEmail={session.user_email} branchName="main" totalCommits={1} localChangeCount={0}
          isGitRepository hasHeadCommit hasCurrentBranch publishLoading={publishLoading}
          organizations={[{ id: "fixture-org", name: "Fixture team" }]}
          selectedOrganizationId="fixture-org" organizationStatus="ready"
          onPublishWorkspace={(organizationId) => { publishRequests.push(organizationId); setPublishLoading(true); }} />} />} />
  </div>;
}

function useSmokeLocationSidebars(location: "local" | "cloud", pending: boolean, sidebar: CloudWorkspaceSidebarController) {
  const [localOpen, setLocalOpen] = useState(false);
  const localActive = location === "local" && !pending;
  return {
    localOpen: localOpen && localActive,
    open: location === "cloud" ? sidebar.open : localOpen && localActive,
    setOpen: location === "cloud" ? sidebar.setOpen : (open: boolean) => { if (!open || localActive) setLocalOpen(open); },
    toggleLocal: () => { if (localActive) setLocalOpen(open => !open); },
    close: () => { setLocalOpen(false); sidebar.close(); },
  };
}

function SmokeAgentSidebar({ location, pending, agent, cloudSidebar, revisionKey, contentVisible }: {
  location: "local" | "cloud";
  pending: boolean;
  agent: ReturnType<typeof useCloudAgentWorkspace>;
  cloudSidebar: CloudWorkspaceSidebarController;
  revisionKey: string;
  contentVisible: boolean;
}) {
  const { t } = useLocalization();
  const localActive = location === "local" && !pending;
  return <div className="desktop-right-sidebar-stack">
    <div className={`desktop-right-sidebar-surface ${location === "cloud" ? "is-active" : ""}`} aria-hidden={location !== "cloud"}>
      <CloudWorkspaceSidebar sidebar={cloudSidebar} agent={agent} context={context} session={session} apiBaseUrl={API}
        active={location === "cloud" && contentVisible} title={t("cloud.home.location.cloud")}
        revisionKey={revisionKey} onSessionChange={noop} />
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
