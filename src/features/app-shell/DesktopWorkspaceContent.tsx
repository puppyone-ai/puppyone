import {
  useMemo,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  DataWorkspace,
  type AiEditRequest,
  type DataNode,
  type EditorInteractionPreferences,
  type Workspace,
  type WorkspaceContentChange,
  type WorkspaceFolder,
} from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import type { DesktopGitController } from "../source-control";
import type { SettingsSection } from "../settings";
import type { DesktopView } from "../../components/DesktopCloudShell";
import type { DesktopUpdatesController } from "../updates";
import type { FilesVisibilitySettings } from "../../preferences";
import {
  formatFileOperationNotice,
  type FileClipboardController,
} from "../data-workspace/useFileClipboard";
import type { PuppyoneWorkspaceConfig } from "../../types/electron";
import type { DesktopCreateEntryAnchorInput } from "../data-workspace/nodeActions";
import { isViewerPluginsEnabled, PluginsDialog } from "../plugins";
import type { DesktopPreferencesController } from "./useDesktopPreferences";
import {
  useWorkspaceSurfaceContent,
  type DesktopWorkspaceCloudSurfaceController,
} from "./workspace-surfaces";
import { useDesktopViewerPacks } from "../viewer-packs/host";
import { DesktopDataWorkspaceSurface } from "./DesktopDataWorkspaceSurface";
import type { DesktopEditorWorkbenchController } from "../editor-workbench/controller/useDesktopEditorWorkbench";
import type { ResolvedWorkbenchDataResource } from "../data-workspace/workbenchDataPort";
import type { SubThemeCatalogController } from "../themes/useSubThemeCatalog";
import { CloudDialog } from "../cloud/CloudDialog";

type DataWorkspacePort = ComponentProps<typeof DataWorkspace>["dataPort"];
type DesktopWorkspaceContentProps = {
  activeAiEditRequest: AiEditRequest | null;
  activeDocumentPath: string | null;
  activeExplorerPath: string | null;
  activeView: DesktopView;
  cloud: DesktopWorkspaceCloudSurfaceController;
  cloudOpen?: boolean;
  dataPort: DataWorkspacePort | null;
  editorWorkbench: DesktopEditorWorkbenchController;
  externalOpen: Readonly<{
    open: (path: string) => void | Promise<void>;
  }>;
  fileClipboardController: FileClipboardController;
  desktopUpdates: DesktopUpdatesController;
  git: DesktopGitController;
  onActiveDataPathChange: (
    path: string | null,
    node?: DataNode | null,
  ) => void | Promise<void>;
  onActiveDataNodeChange: (node: DataNode | null) => void;
  onResourceMove: (previousPath: string, nextPath: string) => void | Promise<void>;
  onRemoveProject: (folder: WorkspaceFolder) => void | Promise<void>;
  onCreateEntryMenu: (parentPath: string | null, anchorRect: DesktopCreateEntryAnchorInput) => void;
  onDismissCreateEntryMenu: () => void;
  onFilesVisibilitySettingsChange: (settings: FilesVisibilitySettings) => void;
  onNavigate: (view: DesktopView) => void;
  onCloseCloud: () => void;
  onClosePlugins: () => void;
  onOpenGitChanges: () => void;
  onOpenPlugins: () => void;
  onNodeActionMenu: (node: DataNode, anchorRect: DOMRect, selectedNodes?: readonly DataNode[]) => void;
  onOpenSettings: () => void;
  onPuppyoneConfigChange: (config: PuppyoneWorkspaceConfig) => Promise<PuppyoneWorkspaceConfig | null>;
  onSelectSettingsSection: (section: SettingsSection) => void;
  onUnlinkWorkspace: () => Promise<void>;
  preferences: DesktopPreferencesController;
  puppyoneConfig: PuppyoneWorkspaceConfig | null;
  puppyoneConfigError: string | null;
  puppyoneConfigLoading: boolean;
  puppyoneConfigSaving: boolean;
  settingsSection: SettingsSection;
  pluginsOpen?: boolean;
  settingsOpen?: boolean;
  settingsNavigationVisible?: boolean;
  workspaceNavigationVisible?: boolean;
  sidebarCompanion?: ReactNode;
  sidebarUtility?: ReactNode;
  subThemeCatalog: SubThemeCatalogController;
  workspace: Workspace;
  workspaceFolders: readonly WorkspaceFolder[];
  resolveWorkspaceResource: (path: string | null) => ResolvedWorkbenchDataResource | null;
  workspaceSurfaceError?: string | null;
  workspaceKey: string;
  workspaceRefreshToken: WorkspaceContentChange;
  workspaceAtomicRefreshToken: number;
  sidebarCreateMenuOpen: boolean;
};

export function DesktopWorkspaceContent({
  activeAiEditRequest,
  activeDocumentPath,
  activeExplorerPath,
  activeView,
  cloud,
  cloudOpen = false,
  dataPort,
  editorWorkbench,
  externalOpen,
  fileClipboardController,
  desktopUpdates,
  git,
  onActiveDataPathChange,
  onActiveDataNodeChange,
  onResourceMove,
  onRemoveProject,
  onCreateEntryMenu,
  onDismissCreateEntryMenu,
  onFilesVisibilitySettingsChange,
  onNavigate,
  onCloseCloud,
  onClosePlugins,
  onOpenGitChanges,
  onOpenPlugins,
  onNodeActionMenu,
  onOpenSettings,
  onPuppyoneConfigChange,
  onSelectSettingsSection,
  onUnlinkWorkspace,
  preferences,
  puppyoneConfig,
  puppyoneConfigError,
  puppyoneConfigLoading,
  puppyoneConfigSaving,
  settingsSection,
  pluginsOpen = false,
  settingsOpen = false,
  settingsNavigationVisible = true,
  workspaceNavigationVisible = true,
  sidebarCompanion,
  sidebarUtility,
  subThemeCatalog,
  workspace,
  workspaceFolders,
  resolveWorkspaceResource,
  workspaceSurfaceError = null,
  workspaceKey,
  workspaceRefreshToken,
  workspaceAtomicRefreshToken,
  sidebarCreateMenuOpen,
}: DesktopWorkspaceContentProps) {
  const { t } = useLocalization();
  const fileOperationNotice = formatFileOperationNotice(fileClipboardController.notice, t);
  const viewerPluginsEnabled = isViewerPluginsEnabled({
    settings: preferences.experimentalSettings,
  });
  const {
    adapter: viewerExtensionAdapter,
    hostAvailable: externalViewerPacksEnabled,
    refresh: refreshViewerPackSnapshot,
    snapshot: viewerPackSnapshot,
  } = useDesktopViewerPacks({
    enabled: viewerPluginsEnabled,
    workspaceKey,
    workspacePath: workspace.path,
  });
  const editorInteractionPreferences = useMemo<EditorInteractionPreferences>(() => ({
    showSaveStatus: preferences.experimentalSettings.enableEditorSaveStatus,
    markdownBlockDragEnabled: preferences.experimentalSettings.enableMarkdownBlockDrag,
    markdownHeadingOutlineEnabled: preferences.experimentalSettings.enableMarkdownHeadingOutline,
  }), [
    preferences.experimentalSettings.enableEditorSaveStatus,
    preferences.experimentalSettings.enableMarkdownBlockDrag,
    preferences.experimentalSettings.enableMarkdownHeadingOutline,
  ]);
  const {
    availableSurfaceIds,
    cloudSurface,
    gitEnabled,
    resolvedActiveView,
    resolvedSurface,
    workspaceChangeCount,
  } = useWorkspaceSurfaceContent({
    activeView,
    cloud,
    desktopUpdates,
    git,
    onFilesVisibilitySettingsChange,
    onOpenGitChanges,
    onPuppyoneConfigChange,
    onSelectSettingsSection,
    onUnlinkWorkspace,
    preferences,
    puppyoneConfig,
    puppyoneConfigError,
    puppyoneConfigLoading,
    puppyoneConfigSaving,
    settingsSection,
    subThemeCatalog,
    workspace,
  });

  const workspaceSurface = !dataPort
    ? resolvedSurface.content.main
    : (
      <DesktopDataWorkspaceSurface
        activeAiEditRequest={activeAiEditRequest}
        activeDocumentPath={activeDocumentPath}
        activeExplorerPath={activeExplorerPath}
        dataPort={dataPort}
        editorWorkbench={editorWorkbench}
        externalOpen={externalOpen}
        editorInteractionPreferences={editorInteractionPreferences}
        fileClipboardController={fileClipboardController}
        fileOperationNotice={fileOperationNotice}
        navigation={{
          activeView: resolvedActiveView,
          availableSurfaceIds,
          gitEnabled,
          gitIncomingCount: git.gitIncomingCount,
          gitOperationLoading: git.gitOperationLoading,
          gitStatus: git.activeGitStatus,
          workspaceChangeCount,
          onNavigate,
          onOpenPlugins,
          onOpenSettings,
          pluginsOpen,
          settingsOpen,
          showPlugins: viewerPluginsEnabled,
          showSettings: settingsNavigationVisible,
          showWorkspaceNavigation: workspaceNavigationVisible,
        }}
        onActiveDataNodeChange={onActiveDataNodeChange}
        onActiveDataPathChange={onActiveDataPathChange}
        onResourceMove={onResourceMove}
        onRemoveProject={onRemoveProject}
        onCreateEntryMenu={onCreateEntryMenu}
        onDismissCreateEntryMenu={onDismissCreateEntryMenu}
        onNodeActionMenu={onNodeActionMenu}
        preferences={preferences}
        resolvedSurface={resolvedSurface}
        sidebarCompanion={sidebarCompanion}
        sidebarUtility={sidebarUtility}
        viewerExtensionAdapter={viewerExtensionAdapter}
        workspace={workspace}
        workspaceFolders={workspaceFolders}
        resolveWorkspaceResource={resolveWorkspaceResource}
        workspaceRefreshToken={workspaceRefreshToken}
        workspaceAtomicRefreshToken={workspaceAtomicRefreshToken}
        workspaceSurfaceError={workspaceSurfaceError}
        sidebarCreateMenuOpen={sidebarCreateMenuOpen}
      />
    );

  return (
    <>
      {workspaceSurface}
      {cloudOpen && (
        <CloudDialog
          sidebar={cloudSurface.sidebar}
          main={cloudSurface.main}
          onClose={onCloseCloud}
        />
      )}
      {pluginsOpen && viewerPluginsEnabled && (
        <PluginsDialog
          hostAvailable={externalViewerPacksEnabled}
          snapshot={viewerPackSnapshot}
          onRefresh={refreshViewerPackSnapshot}
          onClose={onClosePlugins}
        />
      )}
    </>
  );
}
