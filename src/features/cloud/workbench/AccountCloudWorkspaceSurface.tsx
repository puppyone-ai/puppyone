import { useDesktopPreference, useDesktopAppearance } from "../../settings";
import { useRef, useState, type ReactNode } from "react";
import { createWorkspaceResourceUri } from "@puppyone/shared-ui";
import { DesktopCloudShell } from "../../../components/DesktopCloudShell";
import type { ResolvedSurfaceAppearance } from "../../appearance/AppearanceRuntime";
import { DesktopTitlebarContext } from "../../app-shell/DesktopTitlebarContext";
import { DesktopShellLocationBar } from "../../app-shell/DesktopShellLocationBar";
import { EditorHeaderTabs } from "../../editor-workbench/header/EditorHeaderTabs";
import { DesktopCloudFileWorkspace, type CloudFileSurfaceProps } from "./DesktopCloudFileWorkspace";
import type { NativeCloudWorkbench } from "./useNativeCloudWorkbench";
import type { DesktopCloudSession } from "../../../lib/cloudApi";
import { CloudWorkspaceHeaderTools } from "./CloudWorkspaceHeaderTools";
import type { ProjectCloudContext } from "../project/context";
import type { ProjectHomeItem } from "../../app-shell/workspaceHomeModel";

const noop = () => undefined;

export type AccountCloudWorkspacePresentation = Readonly<{
  content: ReactNode;
  locationBar: ReactNode;
  titlebarTabs: ReactNode;
}>;

/** Build the provider-specific body while leaving window chrome to its caller. */
export function useAccountCloudWorkspacePresentation({ workbench, onOpenSettings, settingsOpen = false, showWorkspaceNavigation = true, sidebarUtility }: {
  workbench: NativeCloudWorkbench;
  onOpenSettings: () => void;
  settingsOpen?: boolean;
  showWorkspaceNavigation?: boolean;
  sidebarUtility?: ReactNode;
}): AccountCloudWorkspacePresentation {
  const { resolvedAppearance } = useDesktopAppearance();
  const { service, editorWorkbench, actions } = workbench;
  if (!service || !workbench.visited) return { content: null, locationBar: null, titlebarTabs: null };
  const surfaceProps: CloudFileSurfaceProps = {
    showSaveStatus: true, viewerExtensionAdapter: null, sidebarUtility,
    navigation: { activeView: "data", availableSurfaceIds: ["data"], gitEnabled: false,
      gitIncomingCount: 0, gitOperationLoading: null, gitStatus: null, workspaceChangeCount: 0,
      onNavigate: noop, onOpenPlugins: noop, onOpenSettings,
      pluginsOpen: false, settingsOpen, showPlugins: false, showSettings: true, showWorkspaceNavigation },
  };
  const titlebarTabs = <EditorHeaderTabs activeEditorId={editorWorkbench.activeEditorId} editors={editorWorkbench.state.editors}
    storageIdentity={workbench.dataPort?.documentPersistence?.storageIdentity ?? null}
    onActivate={editorWorkbench.activate} onClose={workbench.closeEditor} onMove={editorWorkbench.moveTab}
    onCreate={service.writable ? (anchor) => actions.openCreateEntryMenu(service.folder.uri, anchor) : undefined} />;
  const locationBar = resolvedAppearance.composition.locationBar === "workspace-path-v1" ? <DesktopShellLocationBar
    path={service.resolveResource(editorWorkbench.activePath ?? workbench.activeNode?.path ?? null)?.providerPath ?? ""}
    onNavigate={async (path) => { if (path.trim()) await workbench.onActivePathChange(createWorkspaceResourceUri(service.folder.uri, path.trim())); }} /> : null;
  return {
    content: <DesktopCloudFileWorkspace workbench={workbench} surfaceProps={surfaceProps} providerStateContent={null} />,
    locationBar,
    titlebarTabs,
  };
}

/** Hosted-only surface used when no local repository is open. Repository-linked
 * switching embeds the presentation above in the retained local shell instead. */
export function AccountCloudWorkspaceSurface({ workbench, presentation, active, appearance, onLocal, onHome, context, session, apiBaseUrl, onSessionChange, projectItems, onSelectProject, onSelectCloudProject, onCreateProject }: {
  workbench: NativeCloudWorkbench;
  presentation: AccountCloudWorkspacePresentation;
  active: boolean;
  appearance: ResolvedSurfaceAppearance;
  onLocal: () => void;
  onHome: () => void;
  projectItems: readonly ProjectHomeItem[];
  onSelectProject: (path: string) => void;
  onSelectCloudProject: (projectId: string) => void;
  onCreateProject: () => void;
  session: DesktopCloudSession | null;
  context: ProjectCloudContext;
  apiBaseUrl: string;
  onSessionChange: (session: DesktopCloudSession | null) => void;
}) {
  const sidebarCollapsed = useDesktopPreference(s => s.sidebarCollapsed);
  const explorerWidth = useDesktopPreference(s => s.explorerWidth);
  const setSidebarCollapsed = useDesktopPreference(s => s.setSidebarCollapsed);
  const editorTabsInHeader = useDesktopPreference(s => s.experimentalSettings.enableEditorTabsInHeader);
  const centered = useDesktopPreference(s => s.experimentalSettings.enableCenteredProjectInHeader);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { service } = workbench;
  if (!service || !workbench.visited) return null;
  const projectContext = <DesktopTitlebarContext open={menuOpen} refObject={menuRef}
        titlebarLabel={service.workspace.name} workspace={service.workspace} workspaceFolders={[service.folder]}
        multiRootWorkspacesEnabled={false} projectLocation={{ current: "cloud", localAvailable: true, cloudState: "available" }}
        cloudProject={{ id: service.workspace.projectId!, name: service.workspace.name }}
        onClose={() => setMenuOpen(false)} onToggle={() => setMenuOpen((current) => !current)}
        onViewLocal={() => { setMenuOpen(false); onLocal(); }}
        projectItems={projectItems} onSelectProject={onSelectProject} onSelectCloudProject={onSelectCloudProject}
        onCreateProject={onCreateProject} onHome={onHome}
        menuAlignment={centered ? "center" : "start"} />;
  return <div className={`app-shell cloud-runtime desktop-account-cloud-workspace ${appearance.appearance.effectiveColorMode === "dark" ? "dark" : ""}`} hidden={!active}
    {...appearance.rootProps}
    style={{ ...appearance.rootProps.style, ...(!active ? { display: "none" } : {}) }} data-active-cloud-project={service.workspace.projectId}>
    <DesktopCloudShell active={active} workspaceLocation="cloud" leftSidebarCollapsed={sidebarCollapsed}
      leftSidebarWidth={explorerWidth} onLeftSidebarExpand={() => setSidebarCollapsed(false)}
      titlebarActions={active && <CloudWorkspaceHeaderTools context={context} session={session}
        apiBaseUrl={apiBaseUrl} onSessionChange={onSessionChange} />}
      titlebarSidebarSlot={centered ? undefined : projectContext}
      titlebarCenteredSlot={centered ? projectContext : undefined}
      titlebarTabs={editorTabsInHeader ? presentation.titlebarTabs : undefined}
      alignTitlebarTabsToExplorer={editorTabsInHeader}
      locationBar={presentation.locationBar}>
      {presentation.content}
    </DesktopCloudShell>
  </div>;
}
