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
  type ResourceUri,
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
import { isViewerPluginsEnabled } from "../plugins";
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

type DataWorkspacePort = ComponentProps<typeof DataWorkspace>["dataPort"];
type DesktopWorkspaceContentProps = {
  activeAiEditRequest: AiEditRequest | null;
  activeDocumentPath: string | null;
  activeExplorerPath: string | null;
  activeView: DesktopView;
  cloud: DesktopWorkspaceCloudSurfaceController;
  dataPort: DataWorkspacePort | null;
  editorWorkbench: DesktopEditorWorkbenchController;
  externalOpen: Readonly<{
    open: (path: string) => void | Promise<void>;
  }>;
  fileClipboardController: FileClipboardController;
  desktopUpdates: DesktopUpdatesController;
  firstProjectStarterEligible: boolean;
  git: DesktopGitController;
  navigationComposition: string;
  onActiveDataPathChange: (
    path: string | null,
    node?: DataNode | null,
  ) => void | Promise<void>;
  onActiveDataNodeChange: (node: DataNode | null) => void;
  onResourceMove: (previousPath: string, nextPath: string) => void | Promise<void>;
  onRemoveProject: (folder: WorkspaceFolder) => void | Promise<void>;
  onCreateEntryMenu: (parentPath: string | null, anchorRect: DesktopCreateEntryAnchorInput) => void;
  onDismissCreateEntryMenu: () => void;
  onWorkspaceStarterCreated: (path: string) => void;
  onFilesVisibilitySettingsChange: (settings: FilesVisibilitySettings) => void;
  onNavigate: (view: DesktopView) => void;
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
  sidebarCompanion?: ReactNode;
  sidebarUtility?: ReactNode;
  subThemeCatalog: SubThemeCatalogController;
  workspace: Workspace;
  workspaceFolders: readonly WorkspaceFolder[];
  resolveWorkspaceResource: (path: string | null) => ResolvedWorkbenchDataResource | null;
  workspaceSurfaceError?: string | null;
  workspaceKey: string;
  workspaceRefreshToken: WorkspaceContentChange;
  sidebarCreateMenuOpen: boolean;
};

export function DesktopWorkspaceContent({
  activeAiEditRequest,
  activeDocumentPath,
  activeExplorerPath,
  activeView,
  cloud,
  dataPort,
  editorWorkbench,
  externalOpen,
  fileClipboardController,
  desktopUpdates,
  firstProjectStarterEligible,
  git,
  navigationComposition,
  onActiveDataPathChange,
  onActiveDataNodeChange,
  onResourceMove,
  onRemoveProject,
  onCreateEntryMenu,
  onDismissCreateEntryMenu,
  onWorkspaceStarterCreated,
  onFilesVisibilitySettingsChange,
  onNavigate,
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
  sidebarCompanion,
  sidebarUtility,
  subThemeCatalog,
  workspace,
  workspaceFolders,
  resolveWorkspaceResource,
  workspaceSurfaceError = null,
  workspaceKey,
  workspaceRefreshToken,
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
  }), [
    preferences.experimentalSettings.enableEditorSaveStatus,
    preferences.experimentalSettings.enableMarkdownBlockDrag,
  ]);
  const workspaceRootUri = (
    workspaceFolders.find((folder) => folder.workspace.path === workspace.path)?.uri
    ?? workspaceFolders[0]?.uri
    ?? null
  ) as ResourceUri | null;
  const {
    availableSurfaceIds,
    cloudHubNavigationEnabled,
    gitEnabled,
    pluginsNavigationVisible,
    resolvedActiveView,
    resolvedSurface,
    workspaceChangeCount,
  } = useWorkspaceSurfaceContent({
    activeView,
    cloud,
    desktopUpdates,
    git,
    onActiveDataPathChange,
    onFilesVisibilitySettingsChange,
    onNavigate,
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
    viewerPacks: {
      hostAvailable: externalViewerPacksEnabled,
      refresh: refreshViewerPackSnapshot,
      snapshot: viewerPackSnapshot,
    },
    viewerPluginsEnabled,
    workspace,
    workspaceRootUri,
  });

  if (!dataPort) {
    return resolvedSurface.content.main;
  }

  return (
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
      firstProjectStarterEligible={firstProjectStarterEligible}
      navigation={{
        activeView: resolvedActiveView,
        availableSurfaceIds,
        cloudHubEnabled: cloudHubNavigationEnabled,
        gitEnabled,
        pluginsEnabled: pluginsNavigationVisible,
        gitIncomingCount: git.gitIncomingCount,
        gitOperationLoading: git.gitOperationLoading,
        gitStatus: git.activeGitStatus,
        workspaceChangeCount,
        onNavigate,
        onOpenSettings,
        onPullGit: git.handlePullGit,
      }}
      navigationComposition={navigationComposition}
      onActiveDataNodeChange={onActiveDataNodeChange}
      onActiveDataPathChange={onActiveDataPathChange}
      onResourceMove={onResourceMove}
      onRemoveProject={onRemoveProject}
      onCreateEntryMenu={onCreateEntryMenu}
      onDismissCreateEntryMenu={onDismissCreateEntryMenu}
      onWorkspaceStarterCreated={onWorkspaceStarterCreated}
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
      workspaceSurfaceError={workspaceSurfaceError}
      sidebarCreateMenuOpen={sidebarCreateMenuOpen}
    />
  );
}
