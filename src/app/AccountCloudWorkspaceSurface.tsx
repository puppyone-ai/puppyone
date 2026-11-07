import { useDesktopPreference, useDesktopAppearance } from "../features/settings";
import { cloudProjectAddress, resolveProjectPlaceMenu } from "../features/app-shell/project-place/projectPlaceMenuState";
import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import { createWorkspaceResourceUri } from "@puppyone/shared-ui";
import type { ProjectShell } from "../components/ProjectShell";
import { ProjectWindow, type ProjectWindowOpening } from "./ProjectWindow";
import type { ResolvedSurfaceAppearance } from "../features/appearance/AppearanceRuntime";
import { DesktopTitlebarContext } from "../features/app-shell/DesktopTitlebarContext";
import { DesktopShellLocationBar } from "../features/app-shell/DesktopShellLocationBar";
import { AuxiliaryWorkbenchPanel } from "../features/app-shell/auxiliary-workbench/AuxiliaryWorkbenchPanel";
import { EditorHeaderTabs } from "../features/editor-workbench/header/EditorHeaderTabs";
import { DesktopCloudFileWorkspace, type CloudFileSurfaceProps } from "../features/cloud/workbench/DesktopCloudFileWorkspace";
import type { NativeCloudWorkbench } from "../features/cloud/workbench/useNativeCloudWorkbench";
import type { RemoteFolderWorkbench } from "../features/remote-workbench/useRemoteFolderWorkbench";
import type { DesktopCloudSession } from "../lib/cloudApi";
import { CloudWorkspaceHeaderTools } from "../features/cloud/workbench/CloudWorkspaceHeaderTools";
import { CloudWorkspaceAgentMark, CloudWorkspaceAgentPeople } from "./CloudWorkspaceAgentPeople";
import type { ProjectCloudContext } from "../features/cloud/project/context";
import type { ProjectTarget } from "../features/app-shell/window-project/windowProjectStore";
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

/** Build a remote folder's body (Cloud or another computer) while leaving window chrome to its caller. */
export function useAccountCloudWorkspacePresentation({ workbench, onOpenSettings, settingsOpen = false, showWorkspaceNavigation = true, sidebarUtility }: {
  workbench: RemoteFolderWorkbench;
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

/** A Cloud project is its own project; a folder linked to it is another one. */
function hostedPlaceMenu({ projectId, organizationName, projectItems, sidebar, onSelectProject }: {
  projectId: string | null | undefined;
  organizationName: string | null | undefined;
  projectItems: readonly ProjectHomeItem[];
  sidebar: CloudWorkspaceSidebarController;
  onSelectProject: (path: string) => void;
}) {
  const linkedFolder = projectItems.find((item) => item.localPath && item.linkedCloudProject?.id === projectId);
  return { menu: resolveProjectPlaceMenu({ place: "cloud", address: cloudProjectAddress(organizationName),
    unhosted: false, publishPending: false, notice: null,
    disconnectable: false, linkedFolder: linkedFolder ? { path: linkedFolder.localPath, name: linkedFolder.label } : null }),
  handlers: { onPutInCloud: noop, onOpenCloudProject: noop, onSignIn: noop, onRetryCloudLink: noop, onDisconnectCloudLink: noop,
    onOpenLocalFolder: (path: string) => onSelectProject(path),
    ...(sidebar.historyAvailable ? { onOpenHistory: sidebar.openHistory } : {}) } };
}

/** Cloud project surface used when no local folder is open. With a local folder
 * open, the retained local shell embeds the presentation above instead. */
export function AccountCloudWorkspaceSurface({ opening, workbench, presentation, active, organizationName, appearance, onHome, context, session, apiBaseUrl, onSessionChange, projectItems, pendingProject, onSelectProject, onSelectCloudProject, onCreateProject, projectRail, agent: suppliedAgent, sidebar: suppliedSidebar }: {
  /** Another project on its way into this window: its name and its wait. */
  opening?: ProjectWindowOpening & Readonly<{ projectName: string }>;
  workbench: NativeCloudWorkbench;
  presentation: AccountCloudWorkspacePresentation;
  active: boolean;
  /** The organization that holds this Cloud project, once known; the Header states it as the project's place. */
  organizationName?: string | null;
  agent?: ReturnType<typeof useCloudAgentWorkspace>;
  sidebar?: CloudWorkspaceSidebarController;
  appearance: ResolvedSurfaceAppearance;
  onHome: () => void;
  projectItems: readonly ProjectHomeItem[];
  pendingProject?: ProjectTarget | null;
  projectRail?: Pick<ComponentProps<typeof ProjectShell>, "renderLeadingRail"
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
  const rightSidebarWidth = useDesktopPreference(s => s.rightSidebarWidth);
  const setRightSidebarWidth = useDesktopPreference(s => s.setRightSidebarWidth);
  const editorTabsInHeader = useDesktopPreference(s => s.experimentalSettings.enableEditorTabsInHeader);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const ownAgent = useCloudAgentWorkspace({ context: suppliedAgent ? null : context, session, apiBaseUrl,
    active: !suppliedAgent && active, onPublication: workbench.refresh });
  const agent = suppliedAgent ?? ownAgent;
  const ownSidebar = useCloudWorkspaceSidebar({ context, session, apiBaseUrl, active: !suppliedSidebar && active, agent });
  const sidebar = suppliedSidebar ?? ownSidebar;
  const { service } = workbench;
  if (!service || !workbench.visited) return null;
  const placeMenu = hostedPlaceMenu({ projectId: service.workspace.projectId, organizationName, projectItems, sidebar, onSelectProject });
  // The rail states the Project it is switching between, so the hosted Header
  // repeats neither the name nor the place while the rail is present.
  const projectContext = !active || projectRail ? null : <DesktopTitlebarContext open={menuOpen} refObject={menuRef}
        titlebarLabel={opening?.projectName ?? service.workspace.name} workspace={service.workspace} workspaceFolders={[service.folder]}
        multiRootWorkspacesEnabled={false} placeMenu={opening ? null : placeMenu}
        onClose={() => setMenuOpen(false)} onToggle={() => setMenuOpen((current) => !current)}
        projectItems={projectItems} pendingProject={pendingProject} onSelectProject={onSelectProject} onSelectCloudProject={onSelectCloudProject}
        onCreateProject={onCreateProject} onHome={onHome} />;
  return <ProjectWindow location="cloud" hosted active={active} opening={opening} appearance={appearance}
    rootAttributes={{ hidden: !active, style: active ? undefined : { display: "none" },
      "data-active-cloud-project": service.workspace.projectId ?? undefined }}
      {...projectRail}
      titlebarActions={active && <CloudWorkspaceHeaderTools context={context} session={session}
        apiBaseUrl={apiBaseUrl} onSessionChange={onSessionChange} agentOpen={agent.open} onToggleAgent={sidebar.toggleAgent}
        renderPeople={people => <CloudWorkspaceAgentPeople {...people} />}
        renderAgentMark={agent => <CloudWorkspaceAgentMark {...agent} />} />}
      titlebarSidebarSlot={projectContext}
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
  </ProjectWindow>;
}
