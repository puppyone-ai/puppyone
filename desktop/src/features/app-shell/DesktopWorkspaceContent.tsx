import type { ComponentProps } from "react";
import { DataWorkspace, type AiEditRequest, type DataNode, type Workspace } from "@puppyone/shared-ui";
import { AiResponseChangesCard } from "../../ai-edits/AiResponseChangesCard";
import { GitSidebar, GitStatusView } from "../source-control";
import type { DesktopGitController } from "../source-control/useDesktopGitController";
import { SettingsSidebar, SettingsView, type SettingsSection } from "../settings";
import {
  CloudServiceMainView,
  CloudServiceSidebar,
  type CloudWorkspaceSection,
} from "../cloud";
import type { DesktopView } from "../../components/DesktopCloudShell";
import type { useDesktopUpdates } from "../../components/DesktopUpdateControls";
import type { DesktopCloudSession } from "../../lib/cloudApi";
import { openExternalUrl } from "../../lib/localFiles";
import type { FilesVisibilitySettings } from "../../preferences";
import type { GitStatusSnapshot, PuppyoneWorkspaceConfig } from "../../types/electron";
import { DesktopExplorerRowActions } from "../data-workspace/nodeActions";
import type { DesktopPreferencesController } from "./useDesktopPreferences";
import {
  COLLAPSED_EXPLORER_WIDTH,
  MAX_EXPLORER_WIDTH,
  MIN_EXPLORER_WIDTH,
} from "./preferences";
import {
  DesktopSidebarFooterNavigation,
  DesktopSidebarTopNavigation,
} from "./navigation";

type DataWorkspacePort = ComponentProps<typeof DataWorkspace>["dataPort"];
type DesktopUpdatesController = ReturnType<typeof useDesktopUpdates>;

type DesktopWorkspaceContentProps = {
  activeAiEditRequest: AiEditRequest | null;
  activeDataPath: string | null;
  activeView: DesktopView;
  cloud: {
    activeSection: CloudWorkspaceSection;
    backupError: string | null;
    backupLoading: boolean;
    cloudSession: DesktopCloudSession | null;
    sessionRestoring: boolean;
    onCloudSessionChange: (session: DesktopCloudSession | null) => void;
    onConfigureCloudRemote: (remoteUrl: string) => Promise<GitStatusSnapshot | null>;
    onOpenDetails: () => void;
    onOpenGitSettings: () => void;
    onSelectSection: (section: CloudWorkspaceSection) => void;
    onStartPuppyoneBackup: () => void;
  };
  dataPort: DataWorkspacePort | null;
  desktopUpdates: DesktopUpdatesController;
  git: DesktopGitController;
  onActiveDataPathChange: (path: string | null) => void;
  onCreateEntryMenu: (parentPath: string | null, anchorRect: DOMRect) => void;
  onFilesVisibilitySettingsChange: (settings: FilesVisibilitySettings) => void;
  onNavigate: (view: DesktopView) => void;
  onNodeActionMenu: (node: DataNode, anchorRect: DOMRect) => void;
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
  workspace: Workspace;
  workspaceKey: string;
  workspaceRefreshToken: number;
};

export function DesktopWorkspaceContent({
  activeAiEditRequest,
  activeDataPath,
  activeView,
  cloud,
  dataPort,
  desktopUpdates,
  git,
  onActiveDataPathChange,
  onCreateEntryMenu,
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
  workspace,
  workspaceKey,
  workspaceRefreshToken,
}: DesktopWorkspaceContentProps) {
  const settingsView = (
    <SettingsView
      workspace={workspace}
      activeSection={settingsSection}
      gitStatus={git.activeGitStatus}
      gitStatusLoading={git.gitStatusLoading}
      gitStatusError={git.gitStatusError}
      themeMode={preferences.themeMode}
      gitDisplayMode={preferences.gitDisplayMode}
      fileIconTheme={preferences.fileIconTheme}
      sidebarNavigationLayout={preferences.sidebarNavigationLayout}
      filesVisibilitySettings={preferences.filesVisibilitySettings}
      rightSidebarToolsSettings={preferences.rightSidebarToolsSettings}
      aiEditAssistEnabled={preferences.aiEditAssistEnabled}
      puppyoneConfig={puppyoneConfig}
      puppyoneConfigLoading={puppyoneConfigLoading}
      puppyoneConfigSaving={puppyoneConfigSaving}
      puppyoneConfigError={puppyoneConfigError}
      updateState={desktopUpdates.state}
      onThemeModeChange={preferences.setThemeMode}
      onGitDisplayModeChange={preferences.setGitDisplayMode}
      onFileIconThemeChange={preferences.setFileIconTheme}
      onSidebarNavigationLayoutChange={preferences.setSidebarNavigationLayout}
      onFilesVisibilitySettingsChange={onFilesVisibilitySettingsChange}
      onRightSidebarToolsSettingsChange={preferences.setRightSidebarToolsSettings}
      onAiEditAssistEnabledChange={preferences.setAiEditAssistEnabled}
      onPuppyoneConfigChange={onPuppyoneConfigChange}
      onUnlinkWorkspace={onUnlinkWorkspace}
      onRefreshGitStatus={git.refreshGitStatus}
      onCheckForUpdates={() => void desktopUpdates.checkForUpdates()}
      onUpdateNow={() => void desktopUpdates.updateNow()}
    />
  );

  const gitStatusView = (
    <GitStatusView
      workspace={workspace}
      status={git.activeGitStatus}
      activePanel={git.gitMainPanel}
      selectedCommitId={git.selectedGitCommitId}
      selectedWorkingFile={git.selectedGitWorkingFile}
      commitDetail={git.gitCommitDetail}
      commitDetailLoading={git.gitCommitDetailLoading}
      commitDetailError={git.gitCommitDetailError}
      workingFileDiff={git.gitWorkingFileDiff}
      workingFileDiffLoading={git.gitWorkingFileDiffLoading}
      workingFileDiffError={git.gitWorkingFileDiffError}
      operationLoading={git.gitOperationLoading}
      operationError={null}
      loading={git.gitStatusLoading}
      error={git.gitStatusError}
      onRefresh={git.refreshGitStatus}
      onSelectCommit={git.selectGitCommit}
      onStagePaths={git.handleStageGitPaths}
      onUnstagePaths={git.handleUnstageGitPaths}
      onDiscardPaths={git.handleDiscardGitPaths}
      onInitializeRepository={git.handleInitializeGitRepository}
    />
  );

  const cloudMainView = (
    <CloudServiceMainView
      workspace={workspace}
      status={git.activeGitStatus}
      puppyoneConfig={puppyoneConfig}
      cloudSession={cloud.cloudSession}
      sessionRestoring={cloud.sessionRestoring}
      onCloudSessionChange={cloud.onCloudSessionChange}
      activeSection={cloud.activeSection}
      loading={git.gitStatusLoading}
      error={git.gitStatusError}
      cloudBackupLoading={cloud.backupLoading}
      cloudBackupError={cloud.backupError}
      onStartPuppyoneBackup={cloud.onStartPuppyoneBackup}
      onConfigureCloudRemote={cloud.onConfigureCloudRemote}
      onSelectSection={cloud.onSelectSection}
      onRefresh={git.refreshGitStatus}
      onOpenDetails={cloud.onOpenDetails}
      onOpenGitSettings={cloud.onOpenGitSettings}
    />
  );

  if (!dataPort) {
    if (activeView === "settings") return settingsView;
    if (activeView === "git") return gitStatusView;
    if (activeView === "cloud") return cloudMainView;
    return null;
  }

  return (
    <div className="desktop-data-workspace-wrap">
      <DataWorkspace
        key={workspaceKey}
        workspace={workspace}
        labels={{ root: workspace.name }}
        dataPort={dataPort}
        activePath={activeDataPath}
        onActivePathChange={onActiveDataPathChange}
        onOpenExternalUrl={openExternalUrl}
        resizableExplorer
        explorerCollapsed={false}
        explorerWidth={preferences.explorerWidth}
        minExplorerWidth={MIN_EXPLORER_WIDTH}
        maxExplorerWidth={MAX_EXPLORER_WIDTH}
        collapsedExplorerWidth={COLLAPSED_EXPLORER_WIDTH}
        onExplorerWidthChange={preferences.setExplorerWidth}
        showHeader={false}
        showExplorerToolbar={preferences.sidebarNavigationPlacement === "top"}
        explorerToolbarSlot={preferences.sidebarNavigationPlacement === "top" ? (
          <DesktopSidebarTopNavigation
            activeView={activeView}
            orientation={preferences.sidebarNavigationOrientation}
            gitIncomingCount={git.gitIncomingCount}
            onNavigate={onNavigate}
            onOpenSettings={onOpenSettings}
          />
        ) : undefined}
        showPreviewHeader={false}
        hidePreviewSourceView
        fileIconTheme={preferences.fileIconTheme}
        editorSaveMode="auto"
        htmlTrustMode="localTrusted"
        aiEditRequest={activeAiEditRequest}
        refreshKey={workspaceRefreshToken}
        explorerRootActionSlot={
          <DesktopExplorerRowActions
            parentPath={null}
            onCreate={onCreateEntryMenu}
            onOpenNodeMenu={onNodeActionMenu}
          />
        }
        explorerNodeActionSlot={(_state, node) => (
          <DesktopExplorerRowActions
            node={node}
            parentPath={node.type === "folder" ? node.path : null}
            onCreate={onCreateEntryMenu}
            onOpenNodeMenu={onNodeActionMenu}
          />
        )}
        explorerSlot={activeView === "data" ? undefined : (
          <div className="desktop-view-surface desktop-view-surface-sidebar" data-view={activeView}>
            {activeView === "git" ? (
              <GitSidebar
                status={git.activeGitStatus}
                puppyoneConfig={puppyoneConfig}
                gitDisplayMode={preferences.gitDisplayMode}
                fileIconTheme={preferences.fileIconTheme}
                activePanel={git.gitMainPanel}
                loading={git.gitStatusLoading}
                error={git.gitStatusError}
                selectedWorkingFile={git.selectedGitWorkingFile}
                operationLoading={git.gitOperationLoading}
                operationError={null}
                onSelectPanel={git.selectGitMainPanel}
                onSelectWorkingFile={git.selectGitWorkingFile}
                onStagePaths={git.handleStageGitPaths}
                onStageAll={git.handleStageAllGitChanges}
                onUnstagePaths={git.handleUnstageGitPaths}
                onUnstageAll={git.handleUnstageAllGitChanges}
                onDiscardPaths={git.handleDiscardGitPaths}
                onDiscardAll={git.handleDiscardAllGitChanges}
                onStageAndCommit={git.handleStageAndCommitGit}
                onCommit={git.handleCommitGit}
                onCommitAndPush={git.handleCommitAndPushGit}
                onPull={git.handlePullGit}
                onPush={git.handlePushGit}
                onPublish={git.handlePublishGitBranch}
                cloudBackupLoading={cloud.backupLoading}
                cloudBackupError={cloud.backupError}
                onStartPuppyoneBackup={cloud.onStartPuppyoneBackup}
                onInitializeRepository={git.handleInitializeGitRepository}
              />
            ) : activeView === "cloud" ? (
              <CloudServiceSidebar
                status={git.activeGitStatus}
                cloudSession={cloud.cloudSession}
                activeSection={cloud.activeSection}
                onSelectSection={cloud.onSelectSection}
              />
            ) : (
              <SettingsSidebar
                activeSection={settingsSection}
                onSelectSection={onSelectSettingsSection}
              />
            )}
          </div>
        )}
        explorerFooterSlot={
          preferences.sidebarNavigationPlacement === "bottom" ? (
            <DesktopSidebarFooterNavigation
              activeView={activeView}
              gitIncomingCount={git.gitIncomingCount}
              onNavigate={onNavigate}
              onOpenSettings={onOpenSettings}
            />
          ) : undefined
        }
        mainSlot={activeView === "git" || activeView === "settings" || activeView === "cloud" ? (
          <div className="desktop-view-surface desktop-view-surface-main" data-view={activeView}>
            {activeView === "git" ? gitStatusView : activeView === "cloud" ? cloudMainView : settingsView}
          </div>
        ) : undefined}
        capabilities={{
          create: true,
          rename: true,
          delete: true,
          move: true,
          write: true,
          history: true,
          accessPoints: false,
          cloudSync: false,
          localGit: true,
          connectors: false,
        }}
      />
      {activeAiEditRequest && activeView === "data" && (
        <div className="desktop-ai-edit-review-floating">
          <AiResponseChangesCard
            request={activeAiEditRequest}
            activePath={activeDataPath}
            onOpenFile={onActiveDataPathChange}
          />
        </div>
      )}
    </div>
  );
}
