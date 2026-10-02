import { useEffect, useMemo, useRef, useState } from "react";
import { EditorView } from "@codemirror/view";
import { DataWorkspace, createWorkspaceRootUri, createWorkspaceResourceUri, type DataPort, type Workspace } from "@puppyone/shared-ui";
import { DesktopCloudShell } from "../../../components/DesktopCloudShell";
import { DesktopOverlayPortal } from "../../app-shell/DesktopOverlayPortal";
import { DesktopWorkspaceSwitcher } from "../../app-shell/DesktopWorkspaceSwitcher";
import { DesktopWorkspaceLocationSurface } from "../../app-shell/DesktopWorkspaceLocationSurface";
import { useDesktopPreferences } from "../../app-shell/useDesktopPreferences";
import { EditorHeaderTabs } from "../../editor-workbench/header/EditorHeaderTabs";
import { useNativeCloudWorkbench } from "./useNativeCloudWorkbench";
import { DesktopNativeCloudWorkspace } from "./DesktopNativeCloudWorkspace";
import type { DesktopCloudSession } from "../../../lib/cloudApi";

const API = "http://127.0.0.1:9090/api/v1";
const localRoot = createWorkspaceRootUri("cloud-switch-fixture-local");
const localPath = createWorkspaceResourceUri(localRoot, "readme.txt");
const localWorkspace: Workspace = { id: "cloud-switch-fixture", name: "Native workspace", path: "/Users/demo/native-workspace", status: "recording" };
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
window.puppyoneDesktop = {
  ...window.puppyoneDesktop,
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
  }; }
}

/** No network or real workspace bytes: exercises production file and editor hosts. */
export function NativeCloudWorkbenchSmokeHarness() {
  const [location, setLocation] = useState<"local" | "cloud">("local");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const preferences = useDesktopPreferences();
  const workbench = useNativeCloudWorkbench({ context, session, apiBaseUrl: API, localWorkspaceIdentity: localWorkspace.id,
    active: location === "cloud", filesVisibilitySettings: preferences.filesVisibilitySettings });
  const localPort = useMemo<DataPort>(() => ({
    listChildren: async () => [{ id: localPath, name: "readme.txt", path: localPath, type: "text", source: "local" },
      { id: "local-only", name: "local-only.md", path: createWorkspaceResourceUri(localRoot, "local-only.md"), type: "markdown", source: "local" }],
    readFile: async (path) => ({ path, name: "readme.txt", type: "text", content: "LOCAL_FILE_BODY", version: "local-1" }),
    documentPersistence: { kind: "local-fs", storageIdentity: "fixture-local-files", persist: (request) => {
      localWrites.push({ path: request.path, content: request.content });
      return new Promise((resolve) => localSaveCompletions.push(() => resolve({ ok: true, version: "local-2" })));
    } },
  }), []);
  useEffect(() => {
    window.__nativeCloudWorkbenchSmoke = {
      state: () => ({ location, cloudWrites, localWrites, requests }),
      edit: (target, text) => {
        const element = document.querySelector(`[data-workspace-location="${target}"] .cm-editor`);
        const view = element ? EditorView.findFromDOM(element as HTMLElement) : null;
        if (!view) throw new Error(`No ${target} CodeMirror view`);
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      },
      finishLocalSaves: () => { localSaveCompletions.splice(0).forEach((finish) => finish()); },
    };
    return () => { delete window.__nativeCloudWorkbenchSmoke; };
  }, [location]);
  return <div className="app-shell dark" data-po-appearance-root="true" data-native-cloud-smoke-ready="true">
    <DesktopOverlayPortal theme="dark">{null}</DesktopOverlayPortal>
    <DesktopCloudShell leftSidebarCollapsed={preferences.sidebarCollapsed} leftSidebarWidth={preferences.explorerWidth}
      onLeftSidebarExpand={() => preferences.setSidebarCollapsed(false)}
      titlebarCenteredSlot={<DesktopWorkspaceSwitcher open={menuOpen} refObject={menuRef} titlebarLabel={localWorkspace.name}
        workspace={localWorkspace} workspaceFolders={[]} multiRootWorkspacesEnabled={false}
        projectLocation={{ current: location, localAvailable: true, cloudState: "available" }} cloudProject={{ id: context.projectId }}
        onClose={() => setMenuOpen(false)} onToggle={() => setMenuOpen((current) => !current)}
        onViewLocal={() => { setLocation("local"); setMenuOpen(false); }} onViewCloud={() => { setLocation("cloud"); setMenuOpen(false); }} />}
      titlebarTabs={location === "cloud" ? <EditorHeaderTabs activeEditorId={workbench.editorWorkbench.activeEditorId}
        editors={workbench.editorWorkbench.state.editors} fileIconTheme={preferences.fileIconTheme}
        storageIdentity={workbench.dataPort?.documentPersistence?.storageIdentity ?? null}
        onActivate={workbench.editorWorkbench.activate} onClose={workbench.closeEditor} onMove={workbench.editorWorkbench.moveTab} /> : undefined}>
      <DesktopWorkspaceLocationSurface location={location}
        local={<DataWorkspace workspace={localWorkspace} dataPort={localPort} defaultActivePath={localPath}
          showHeader={false} showExplorerRoot={false} documentSourceKind="local" editorSaveMode="auto" fileIconTheme={preferences.fileIconTheme} />}
        nativeCloud={<DesktopNativeCloudWorkspace workbench={workbench} preferences={preferences} onOpenCloudServices={() => undefined} />}
        cloudServices={{ sidebar: null, main: null }} />
    </DesktopCloudShell>
  </div>;
}
