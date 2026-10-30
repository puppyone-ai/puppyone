import { useDesktopPreference, useDesktopAppearance } from "../features/settings";
import { resolveProjectPlaceMenu } from "../features/app-shell/project-place/projectPlaceMenuState";
import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import { createWorkspaceResourceUri } from "@puppyone/shared-ui";
import { DesktopCloudShell } from "../components/DesktopCloudShell";
import type { ResolvedSurfaceAppearance } from "../features/appearance/AppearanceRuntime";
import { DesktopTitlebarContext } from "../features/app-shell/DesktopTitlebarContext";
import { DesktopShellLocationBar } from "../features/app-shell/DesktopShellLocationBar";
import { AuxiliaryWorkbenchPanel } from "../features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchPanel";
import { EditorHeaderTabs } from "../features/editor-workbench/header/EditorHeaderTabs";
import { DesktopCloudFileWorkspace, type CloudFileSurfaceProps } from "../features/cloud/workbench/DesktopCloudFileWorkspace";
import type { NativeCloudWorkbench } from "../features/cloud/workbench/useNativeCloudWorkbench";
import type { DesktopCloudSession } from "../lib/cloudApi";
import { CloudWorkspaceHeaderTools } from "../features/cloud/workbench/CloudWorkspaceHeaderTools";
import { CloudWorkspaceAgentPeople } from "./CloudWorkspaceAgentPeople";
import { captureCloudWorkspaceShareResource } from "../features/cloud/share/cloudWorkspaceShareResource";
import type { ProjectCloudContext } from "../features/cloud/project/context";
import type { ProjectNavigationTarget } from "../features/app-shell/projectNavigation";
import type { ProjectHomeItem } from "../lib/workspaceHomeModel";
import { useCloudAgentWorkspace } from "../features/cloud/agent/useCloudAgentWorkspace";
import { CloudWorkspaceSidebar } from "../features/cloud/workbench/CloudWorkspaceSidebar";
import { useCloudWorkspaceSidebar, type CloudWorkspaceSidebarController } from "../features/cloud/workbench/useCloudWorkspaceSidebar";

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

/** Cloud project surface used when no local folder is open. With a local folder
 * open, the retained local shell embeds the presentation above instead. */
export function AccountCloudWorkspaceSurface({ workbench, presentation, active, appearance, onHome, context, session, apiBaseUrl, onSessionChange, projectItems, pendingProject, onSelectProject, onSelectCloudProject, onCreateProject, projectRail, agent: suppliedAgent, sidebar: suppliedSidebar }: {
  workbench: NativeCloudWorkbench;
  presentation: AccountCloudWorkspacePresentation;
  active: boolean;
  agent?: ReturnType<typeof useCloudAgentWorkspace>;
  sidebar?: CloudWorkspaceSidebarController;
  appearance: ResolvedSurfaceAppearance;
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
  // A Cloud project is its own project; a folder linked to it is another one.
  const linkedFolder = projectItems.find((item) => item.localPath && item.linkedCloudProject?.id === service.workspace.projectId);
  const placeMenu = { menu: resolveProjectPlaceMenu({ place: "cloud", unhosted: false, publishPending: false, notice: null,
    missingReplaceable: false, linkedFolder: linkedFolder ? { path: linkedFolder.localPath, name: linkedFolder.label } : null }),
  handlers: { onPutInCloud: noop, onOpenCloudProject: noop, onSignIn: noop, onPutInCloudAgain: noop,
    onOpenLocalFolder: (path: string) => onSelectProject(path) } };
  // The rail states the Project it is switching between, so the hosted Header
  // repeats neither the name nor the place while the rail is present.
  const projectContext = !active || projectRail ? null : <DesktopTitlebarContext open={menuOpen} refObject={menuRef}
        titlebarLabel={service.workspace.name} workspace={service.workspace} workspaceFolders={[service.folder]}
        multiRootWorkspacesEnabled={false} placeMenu={placeMenu}
        onClose={() => setMenuOpen(false)} onToggle={() => setMenuOpen((current) => !current)}
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
        historyOpen={sidebar.historyOpen} onToggleHistory={sidebar.toggleHistory}
        renderPeople={people => <CloudWorkspaceAgentPeople {...people} />} />}
      titlebarSidebarSlot={centered ? undefined : projectContext}
      titlebarCenteredSlot={centered ? projectContext : undefined}
      titlebarTabs={editorTabsInHeader ? presentation.titlebarTabs : undefined}
      alignTitlebarTabsToExplorer={editorTabsInHeader}
      locationBar={presentation.locationBar}
      rightSidebarOpen={sidebar.open} rightSidebarWidth={rightSidebarWidth} resizableRightSidebar
      onRightSidebarOpenChange={sidebar.setOpen} onRightSidebarWidthChange={setRightSidebarWidth}
      rightSidebar={pane => <CloudWorkspaceSidebar sidebar={sidebar} agent={agent} context={context}
        session={session} apiBaseUrl={apiBaseUrl} active={active && pane.contentVisible} title={service.workspace.name}
        revisionKey={String(workbench.refreshToken.sequence)} onSessionChange={onSessionChange}
        workbenchPanel={AuxiliaryWorkbenchPanel} />}>
      {presentation.content}
    </DesktopCloudShell>
  </div>;
}
