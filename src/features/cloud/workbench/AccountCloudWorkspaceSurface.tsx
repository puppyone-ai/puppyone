import { useMemo, useRef, useState, type ReactNode } from "react";
import { createWorkspaceResourceUri } from "@puppyone/shared-ui";
import { DesktopCloudShell } from "../../../components/DesktopCloudShell";
import type { DesktopPreferencesController } from "../../app-shell/useDesktopPreferences";
import type { ResolvedSurfaceAppearance } from "../../appearance/AppearanceRuntime";
import { DesktopWorkspaceSwitcher } from "../../app-shell/DesktopWorkspaceSwitcher";
import { DesktopShellLocationBar } from "../../app-shell/DesktopShellLocationBar";
import { EditorHeaderTabs } from "../../editor-workbench/header/EditorHeaderTabs";
import { DesktopCloudFileWorkspace, type CloudFileSurfaceProps } from "./DesktopCloudFileWorkspace";
import type { NativeCloudWorkbench } from "./useNativeCloudWorkbench";

const noop = () => undefined;

export type AccountCloudWorkspacePresentation = Readonly<{
  content: ReactNode;
  locationBar: ReactNode;
  titlebarTabs: ReactNode;
}>;

/** Build the provider-specific body while leaving window chrome to its caller. */
export function useAccountCloudWorkspacePresentation({ workbench, preferences }: {
  workbench: NativeCloudWorkbench;
  preferences: DesktopPreferencesController;
}): AccountCloudWorkspacePresentation {
  const { service, editorWorkbench, actions } = workbench;
  const interaction = useMemo(() => ({ showSaveStatus: true,
    markdownBlockDragEnabled: preferences.experimentalSettings.enableMarkdownBlockDrag,
    markdownHeadingOutlineEnabled: preferences.experimentalSettings.enableMarkdownHeadingOutline,
  }), [preferences.experimentalSettings.enableMarkdownBlockDrag, preferences.experimentalSettings.enableMarkdownHeadingOutline]);
  if (!service || !workbench.visited) return { content: null, locationBar: null, titlebarTabs: null };
  const surfaceProps: CloudFileSurfaceProps = {
    preferences, editorInteractionPreferences: interaction, viewerExtensionAdapter: null,
    navigation: { activeView: "data", availableSurfaceIds: ["data"], gitEnabled: false,
      gitIncomingCount: 0, gitOperationLoading: null, gitStatus: null, workspaceChangeCount: 0,
      onNavigate: noop, onOpenPlugins: noop, onOpenSettings: noop,
      pluginsOpen: false, settingsOpen: false, showPlugins: false, showSettings: false, showWorkspaceNavigation: false },
  };
  const titlebarTabs = <EditorHeaderTabs activeEditorId={editorWorkbench.activeEditorId} editors={editorWorkbench.state.editors}
    fileIconTheme={preferences.fileIconTheme} storageIdentity={workbench.dataPort?.documentPersistence?.storageIdentity ?? null}
    onActivate={editorWorkbench.activate} onClose={workbench.closeEditor} onMove={editorWorkbench.moveTab}
    onCreate={service.writable ? (anchor) => actions.openCreateEntryMenu(service.folder.uri, anchor) : undefined} />;
  const locationBar = preferences.resolvedAppearance.composition.locationBar === "workspace-path-v1" ? <DesktopShellLocationBar
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
export function AccountCloudWorkspaceSurface({ workbench, presentation, active, preferences, appearance, onLocal, onHome }: {
  workbench: NativeCloudWorkbench;
  presentation: AccountCloudWorkspacePresentation;
  active: boolean;
  preferences: DesktopPreferencesController;
  appearance: ResolvedSurfaceAppearance;
  onLocal: () => void;
  onHome: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { service } = workbench;
  if (!service || !workbench.visited) return null;
  return <div className={`app-shell cloud-runtime desktop-account-cloud-workspace ${appearance.appearance.effectiveColorMode === "dark" ? "dark" : ""}`} hidden={!active}
    {...appearance.rootProps}
    style={{ ...appearance.rootProps.style, ...(!active ? { display: "none" } : {}) }} data-active-cloud-project={service.workspace.projectId}>
    <DesktopCloudShell active={active} workspaceLocation="cloud" onGoHome={onHome} leftSidebarCollapsed={preferences.sidebarCollapsed}
      leftSidebarWidth={preferences.explorerWidth} onLeftSidebarExpand={() => preferences.setSidebarCollapsed(false)}
      titlebarCenteredSlot={<DesktopWorkspaceSwitcher open={menuOpen} refObject={menuRef}
        titlebarLabel={service.workspace.name} workspace={service.workspace} workspaceFolders={[service.folder]}
        multiRootWorkspacesEnabled={false} projectLocation={{ current: "cloud", localAvailable: true, cloudState: "available" }}
        cloudProject={{ id: service.workspace.projectId!, name: service.workspace.name }}
        onClose={() => setMenuOpen(false)} onToggle={() => setMenuOpen((current) => !current)}
        onViewLocal={() => { setMenuOpen(false); onLocal(); }} />}
      titlebarTabs={preferences.experimentalSettings.enableEditorTabsInHeader ? presentation.titlebarTabs : undefined}
      alignTitlebarTabsToExplorer={preferences.experimentalSettings.enableEditorTabsInHeader}
      locationBar={presentation.locationBar}>
      {presentation.content}
    </DesktopCloudShell>
  </div>;
}
