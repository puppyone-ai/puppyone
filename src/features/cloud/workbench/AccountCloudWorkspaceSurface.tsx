import { useDesktopPreference, useDesktopAppearance } from "../../settings";
import { useRef, useState, type ComponentProps, type ReactNode } from "react";
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
import { captureCloudWorkspaceShareResource } from "../share/cloudWorkspaceShareResource";
import type { ProjectCloudContext } from "../project/context";
import type { ProjectNavigationTarget } from "../../app-shell/projectNavigation";
import type { ProjectHomeItem } from "../../app-shell/workspaceHomeModel";
import { useCloudAgentWorkspace } from "../agent/useCloudAgentWorkspace";
import { CloudWorkspaceSidebar } from "./CloudWorkspaceSidebar";
import { useCloudWorkspaceSidebar, type CloudWorkspaceSidebarController } from "./useCloudWorkspaceSidebar";

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
export function AccountCloudWorkspaceSurface({ workbench, presentation, active, appearance, onHome, context, session, apiBaseUrl, onSessionChange, projectItems, pendingProject, onSelectProject, onSelectCloudProject, onCreateProject, projectRail, agent: suppliedAgent, sidebar: suppliedSidebar }: {
  workbench: NativeCloudWorkbench;
  presentation: AccountCloudWorkspacePresentation;
  active: boolean;
  agent?: ReturnType<typeof useCloudAgentWorkspace>;
  sidebar?: CloudWorkspaceSidebarController;
  appearance: ResolvedSurfaceAppearance;
  onLocal: () => void;
  onHome: () => void;
  projectItems: readonly ProjectHomeItem[];
  pendingProject?: ProjectNavigationTarget | null;
  projectRail?: Pick<ComponentProps<typeof DesktopCloudShell>, "renderLeadingRail"
    | "leadingRailWidth" | "leadingRailMinWidth" | "leadingRailMaxWidth"
    | "leadingRailCollapsed" | "leadingRailCollapsedWidth" | "leadingRailCollapseThreshold"
    | "resizableLeadingRail" | "onLeadingRailCollapsedChange" | "onLeadingRailWidthChange">;
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
  const rightSidebarWidth = useDesktopPreference(s => s.rightSidebarWidth);
  const setRightSidebarWidth = useDesktopPreference(s => s.setRightSidebarWidth);
  const setSidebarCollapsed = useDesktopPreference(s => s.setSidebarCollapsed);
  const editorTabsInHeader = useDesktopPreference(s => s.experimentalSettings.enableEditorTabsInHeader);
  const centered = useDesktopPreference(s => s.experimentalSettings.enableCenteredProjectInHeader);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const ownAgent = useCloudAgentWorkspace({ context: suppliedAgent ? null : context, session, apiBaseUrl,
    active: !suppliedAgent && active, onPublication: workbench.refresh });
  const agent = suppliedAgent ?? ownAgent;
  const ownSidebar = useCloudWorkspaceSidebar({ context, session, apiBaseUrl, active: !suppliedSidebar && active, agent });
  const sidebar = suppliedSidebar ?? ownSidebar;
  const { service } = workbench;
  if (!service || !workbench.visited) return null;
  const localProject = projectItems.find(item => item.cloudProjectId === service.workspace.projectId && item.localPath);
  // The rail states the Project it is switching between, so the hosted Header
  // repeats neither the name nor the place while the rail is present.
  const projectContext = !active || projectRail ? null : <DesktopTitlebarContext open={menuOpen} refObject={menuRef}
        titlebarLabel={service.workspace.name} workspace={service.workspace} workspaceFolders={[service.folder]}
        multiRootWorkspacesEnabled={false} projectLocation={{ current: "cloud", localAvailable: Boolean(localProject), cloudState: "available" }}
        cloudProject={{ id: service.workspace.projectId!, name: service.workspace.name }}
        onClose={() => setMenuOpen(false)} onToggle={() => setMenuOpen((current) => !current)}
        onViewLocal={localProject ? () => { setMenuOpen(false); onSelectProject(localProject.localPath); } : undefined}
        projectItems={projectItems} pendingProject={pendingProject} onSelectProject={onSelectProject} onSelectCloudProject={onSelectCloudProject}
        onCreateProject={onCreateProject} onHome={onHome}
        menuAlignment={centered ? "center" : "start"} />;
  return <div className={`app-shell cloud-runtime desktop-account-cloud-workspace ${appearance.appearance.effectiveColorMode === "dark" ? "dark" : ""}`} hidden={!active}
    {...appearance.rootProps}
    style={{ ...appearance.rootProps.style, ...(!active ? { display: "none" } : {}) }} data-active-cloud-project={service.workspace.projectId}>
    <DesktopCloudShell active={active} workspaceLocation="cloud" leftSidebarCollapsed={sidebarCollapsed}
      {...projectRail}
      leftSidebarWidth={explorerWidth} onLeftSidebarExpand={() => setSidebarCollapsed(false)}
      titlebarActions={active && <CloudWorkspaceHeaderTools context={context} session={session}
        getShareResource={() => captureCloudWorkspaceShareResource(workbench)}
        apiBaseUrl={apiBaseUrl} onSessionChange={onSessionChange} agentOpen={agent.open} onToggleAgent={sidebar.toggleAgent}
        historyOpen={sidebar.historyOpen} onToggleHistory={sidebar.toggleHistory} />}
      titlebarSidebarSlot={centered ? undefined : projectContext}
      titlebarCenteredSlot={centered ? projectContext : undefined}
      titlebarTabs={editorTabsInHeader ? presentation.titlebarTabs : undefined}
      alignTitlebarTabsToExplorer={editorTabsInHeader}
      locationBar={presentation.locationBar}
      rightSidebarOpen={sidebar.open} rightSidebarWidth={rightSidebarWidth} resizableRightSidebar
      onRightSidebarOpenChange={sidebar.setOpen} onRightSidebarWidthChange={setRightSidebarWidth}
      rightSidebar={pane => <CloudWorkspaceSidebar sidebar={sidebar} agent={agent} context={context}
        session={session} apiBaseUrl={apiBaseUrl} active={active && pane.contentVisible} title={service.workspace.name}
        revisionKey={String(workbench.refreshToken.sequence)} onSessionChange={onSessionChange} />}>
      {presentation.content}
    </DesktopCloudShell>
  </div>;
}
