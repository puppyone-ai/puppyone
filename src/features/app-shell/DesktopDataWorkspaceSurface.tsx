import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { Plus } from "lucide-react";
import { useLocalization } from "@puppyone/localization";
import {
  DataWorkspace,
  qualifyDataResourcePath,
  getFileSemanticKind,
  type AiEditRequest,
  type DataNode,
  type Workspace,
  type WorkspaceContentChange,
  type WorkspaceFolder,
} from "@puppyone/shared-ui";
import { AiResponseChangesCard } from "../../ai-edits/AiResponseChangesCard";
import { openExternalUrl } from "../../lib/localFiles";
import { useResourceDragPreview } from "../../platform/useResourceDragPreview";
import { resolveResourceDropSource } from "../../platform/resourceDragSession";
import { useResourceDragExport } from "../data-workspace/useResourceDragExport";
import {
  DesktopExplorerRowActions,
  rectToCreateEntryAnchor,
  type DesktopCreateEntryAnchorInput,
} from "../data-workspace/nodeActions";
import type { FileClipboardController } from "../data-workspace/useFileClipboard";
import type { GitStatusSnapshot } from "../../types/electron";
import { useDesktopPaneLayout } from "./layout/DesktopPaneLayoutContext";
import {
  COLLAPSED_EXPLORER_WIDTH,
  EXPLORER_COLLAPSE_THRESHOLD,
  MAX_EXPLORER_WIDTH,
  MIN_EXPLORER_WIDTH,
} from "./layout/desktopPaneLayout";
import type { DesktopPreferencesController } from "./useDesktopPreferences";
import {
  DesktopSidebarFooterNavigation,
  DesktopSidebarRailNavigation,
  DesktopSidebarTopNavigation,
} from "./navigation";
import { WorkspaceSurfaceOutlet, type ResolvedWorkspaceSurface } from "./workspace-surfaces";
import type { DesktopView } from "../../components/DesktopCloudShell";
import {
  useNativeSurfacePointerPassthroughActivity,
  useNativeSurfacePointerRoutingRegion,
} from "../native-surfaces";
import { DesktopEditorSplitView } from "../editor-workbench/layout/DesktopEditorSplitView";
import type { DesktopEditorWorkbenchController } from "../editor-workbench/controller/useDesktopEditorWorkbench";
import {
  AgentFilePresence,
  desktopAgentActivityStore,
  toWorkspaceRelativePath,
} from "../desktop-agent-presence";
import { DesktopShellNavigationToolbarPortal } from "./DesktopShellAccessoryContext";
import {
  getRemoteUpdateNoticeModel,
  RemoteUpdateNotice,
} from "../data-workspace/RemoteUpdateNotice";
import type { ResolvedWorkbenchDataResource } from "../data-workspace/workbenchDataPort";
import { useProjectExplorerSession } from "../data-workspace/useProjectExplorerSession";
import {
  EmptyWorkspaceOnboardingDialog,
  markFirstProjectStarterCompleted,
  readFirstProjectStarterCompleted,
  resolveWorkspaceRootOnboardingStatus,
  shouldShowFirstProjectStarter,
  type EmptyWorkspaceStarterSelection,
  type WorkspaceRootOnboardingStatus,
} from "./EmptyWorkspaceOnboardingDialog";

type DataWorkspaceProps = ComponentProps<typeof DataWorkspace>;

export type DesktopDataWorkspaceSurfaceProps = {
  activeAiEditRequest: AiEditRequest | null;
  activeDocumentPath: string | null;
  activeExplorerPath: string | null;
  dataPort: NonNullable<DataWorkspaceProps["dataPort"]>;
  editorWorkbench: DesktopEditorWorkbenchController;
  externalOpen: Readonly<{
    open: (path: string) => void | Promise<void>;
  }>;
  editorInteractionPreferences: NonNullable<DataWorkspaceProps["editorInteractionPreferences"]>;
  fileClipboardController: FileClipboardController;
  fileOperationNotice: string | null;
  firstProjectStarterEligible: boolean;
  navigation: {
    activeView: DesktopView;
    availableSurfaceIds: readonly DesktopView[];
    cloudHubEnabled: boolean;
    gitEnabled: boolean;
    pluginsEnabled: boolean;
    gitIncomingCount: number;
    gitOperationLoading: string | null;
    gitStatus: GitStatusSnapshot | null;
    workspaceChangeCount: number;
    onNavigate: (view: DesktopView) => void;
    onOpenSettings: () => void;
    showSettings: boolean;
    showWorkspaceNavigation: boolean;
    onPullGit: () => Promise<boolean>;
  };
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
  onNodeActionMenu: (node: DataNode, anchorRect: DOMRect, selectedNodes?: readonly DataNode[]) => void;
  preferences: DesktopPreferencesController;
  resolvedSurface: ResolvedWorkspaceSurface;
  sidebarCompanion?: ReactNode;
  sidebarUtility?: ReactNode;
  viewerExtensionAdapter: DataWorkspaceProps["viewerExtensionAdapter"];
  workspace: Workspace;
  workspaceFolders: readonly WorkspaceFolder[];
  resolveWorkspaceResource: (path: string | null) => ResolvedWorkbenchDataResource | null;
  workspaceRefreshToken: WorkspaceContentChange;
  workspaceAtomicRefreshToken: number;
  workspaceSurfaceError: string | null;
  sidebarCreateMenuOpen: boolean;
};

export function DesktopDataWorkspaceSurface({
  activeAiEditRequest,
  activeDocumentPath,
  activeExplorerPath,
  dataPort,
  editorWorkbench,
  externalOpen,
  editorInteractionPreferences,
  fileClipboardController,
  fileOperationNotice,
  firstProjectStarterEligible,
  navigation,
  navigationComposition,
  onActiveDataNodeChange,
  onResourceMove,
  onRemoveProject,
  onActiveDataPathChange,
  onCreateEntryMenu,
  onDismissCreateEntryMenu,
  onWorkspaceStarterCreated,
  onNodeActionMenu,
  preferences,
  resolvedSurface,
  sidebarCompanion,
  sidebarUtility,
  viewerExtensionAdapter,
  workspace,
  workspaceFolders,
  resolveWorkspaceResource,
  workspaceRefreshToken,
  workspaceAtomicRefreshToken,
  workspaceSurfaceError,
  sidebarCreateMenuOpen,
}: DesktopDataWorkspaceSurfaceProps) {
  const [dragExportFailed, setDragExportFailed] = useState(false);
  const exportNodes = useResourceDragExport(resolveWorkspaceResource, setDragExportFailed);
  const resourceDragPreview = useResourceDragPreview();
  const resolveFileDrop = useCallback<NonNullable<DataWorkspaceProps["onResolveFileDrop"]>>(async (files, target) => {
    setDragExportFailed(false);
    try {
      const targetResource = resolveWorkspaceResource(target)?.resourceUri;
      const source = await resolveResourceDropSource({ kind: "files", files }, "explorer-move", targetResource);
      return source.kind === "workspace-entries" ? source.entries : null;
    } catch (error) {
      setDragExportFailed(true);
      throw error;
    }
  }, [resolveWorkspaceResource]);
  const resolveEditorResourceDrop = useCallback(async (
    files: File[],
    resourceDragSessionId: string,
  ) => {
    setDragExportFailed(false);
    try {
      const source = await resolveResourceDropSource(
        { kind: "files", files },
        "editor-split",
        undefined,
        resourceDragSessionId,
      );
      return source.kind === "workspace-entries" ? source.entries : null;
    } catch (error) {
      setDragExportFailed(true);
      throw error;
    }
  }, []);
  const onExplorerResizeActiveChange = useNativeSurfacePointerPassthroughActivity(
    "explorer-resize",
  );
  const [explorerResizeHandle, setExplorerResizeHandle] = useState<HTMLDivElement | null>(null);
  const [workspaceRootStatus, setWorkspaceRootStatus] = useState<Readonly<{
    workspaceKey: string;
    status: WorkspaceRootOnboardingStatus;
  }> | null>(null);
  const [firstProjectStarterCompleted, setFirstProjectStarterCompleted] = useState(
    readFirstProjectStarterCompleted,
  );
  useNativeSurfacePointerRoutingRegion("explorer-resize", explorerResizeHandle);
  const { t } = useLocalization();
  const paneLayout = useDesktopPaneLayout();
  const activeWorkspaceResource = useMemo(
    () => resolveWorkspaceResource(activeExplorerPath),
    [activeExplorerPath, resolveWorkspaceResource],
  );
  const activeWorkspaceRootPath = activeWorkspaceResource?.folder.uri
    ?? workspaceFolders[0]?.uri
    ?? null;
  const explorerSession = useProjectExplorerSession(workspace, workspaceFolders);
  const defaultExpandedWorkspaceRoots = useMemo(
    () => workspaceFolders.length > 1
      ? workspaceFolders.map((folder) => folder.uri)
      : undefined,
    [workspaceFolders],
  );
  const updateWorkspaceRootStatus = useCallback((
    nextWorkspaceKey: string,
    status: WorkspaceRootOnboardingStatus,
  ) => {
    setWorkspaceRootStatus((current) => (
      current?.workspaceKey === nextWorkspaceKey && current.status === status
        ? current
        : { workspaceKey: nextWorkspaceKey, status }
    ));
  }, []);
  const currentWorkspaceRootStatus = workspaceRootStatus?.workspaceKey === explorerSession.key
    ? workspaceRootStatus.status
    : null;
  const showEmptyWorkspaceOnboarding = shouldShowFirstProjectStarter({
    eligible: firstProjectStarterEligible,
    completed: firstProjectStarterCompleted,
    workspaceStatus: currentWorkspaceRootStatus,
  });
  const confirmWorkspaceStarter = useCallback(async (selection: EmptyWorkspaceStarterSelection) => {
    if (selection.file) {
      if (!dataPort.createFile) throw new Error(t("workspace.emptyOnboarding.createUnavailable"));
      const folder = workspaceFolders.find((candidate) => candidate.uri === activeWorkspaceRootPath);
      if (!folder || !activeWorkspaceRootPath) {
        throw new Error("A Workspace Folder is required to create the starter document.");
      }
      const resourcePath = qualifyDataResourcePath(activeWorkspaceRootPath, selection.file.path);
      await dataPort.createFile(resourcePath, selection.file.content);
      const node: DataNode = {
        id: resourcePath,
        name: selection.file.path,
        path: resourcePath,
        type: getFileSemanticKind(selection.file.path, "file"),
        resourceUri: resourcePath,
        workspaceFolderId: folder.id,
      };
      markFirstProjectStarterCompleted();
      setFirstProjectStarterCompleted(true);
      onWorkspaceStarterCreated(resourcePath);
      await onActiveDataPathChange(resourcePath, node);
      return;
    }

    markFirstProjectStarterCompleted();
    setFirstProjectStarterCompleted(true);
  }, [
    activeWorkspaceRootPath,
    dataPort,
    onActiveDataPathChange,
    onWorkspaceStarterCreated,
    t,
    workspaceFolders,
  ]);
  const resolvedExplorerWidth = paneLayout?.explorer.width ?? preferences.explorerWidth;
  const resolvedExplorerMaxWidth = paneLayout?.explorer.maxWidth
    ?? MAX_EXPLORER_WIDTH;
  const resolvedExplorerMinWidth = paneLayout?.explorer.minWidth ?? MIN_EXPLORER_WIDTH;
  const resolvedExplorerCollapsed = paneLayout?.explorer.collapsed
    ?? preferences.sidebarCollapsed;
  const navigationCommon = {
    activeView: navigation.activeView,
    availableSurfaceIds: navigation.availableSurfaceIds,
    cloudHubEnabled: navigation.cloudHubEnabled,
    gitEnabled: navigation.gitEnabled,
    pluginsEnabled: navigation.pluginsEnabled,
    gitIncomingCount: navigation.gitIncomingCount,
    gitOperationLoading: navigation.gitOperationLoading,
    gitStatus: navigation.gitStatus,
    workspaceChangeCount: navigation.workspaceChangeCount,
    onNavigate: navigation.onNavigate,
    onOpenSettings: navigation.onOpenSettings,
    showSettings: navigation.showSettings,
    utilitySlot: sidebarUtility,
  } as const;
  const remoteUpdateNoticeVisible = navigation.showWorkspaceNavigation
    && getRemoteUpdateNoticeModel(navigation.gitStatus) !== null;
  const shellHostedTopNavigation = navigationComposition === "sidebar-top-toolbar"
    && preferences.sidebarNavigationPlacement === "top";
  const topNavigation = navigation.showWorkspaceNavigation
    && preferences.sidebarNavigationPlacement === "top" ? (
    <DesktopSidebarTopNavigation
      {...navigationCommon}
      orientation={preferences.sidebarNavigationOrientation}
      shellToolbar={shellHostedTopNavigation}
      useToolLabels={shellHostedTopNavigation}
    />
  ) : null;

  return (
    <div
      className="desktop-data-workspace-wrap"
      data-sidebar-navigation-placement={preferences.sidebarNavigationPlacement}
    >
      {shellHostedTopNavigation && topNavigation && (
        <DesktopShellNavigationToolbarPortal>
          {topNavigation}
        </DesktopShellNavigationToolbarPortal>
      )}
      {workspaceSurfaceError && (
        <div className="desktop-workspace-surface-alert" role="status">{workspaceSurfaceError}</div>
      )}
      {dragExportFailed && (
        <div className="desktop-workspace-surface-alert" role="alert">{t("workspace.drag.exportFailed")}</div>
      )}
      {fileClipboardController.notice && fileOperationNotice && (
        <div
          className="desktop-file-operation-notice"
          data-tone={fileClipboardController.notice.tone}
          role="status"
          aria-live="polite"
          dir="auto"
        >
          {fileOperationNotice}
        </div>
      )}
      <DataWorkspace
        onExportNodes={exportNodes}
        resourceDragEntries={resourceDragPreview?.entries}
        onResolveFileDrop={resolveFileDrop}
        dragExportHint={t("workspace.drag.exportHint")}
        key={explorerSession.key}
        workspace={workspace}
        labels={{ root: workspace.name }}
        dataPort={dataPort}
        defaultExpandedPaths={defaultExpandedWorkspaceRoots}
        initialExplorerSession={explorerSession.initialSession}
        onExplorerSessionChange={explorerSession.onSessionChange}
        activePath={activeExplorerPath}
        onResourceMove={onResourceMove}
        onActivePathChange={onActiveDataPathChange}
        onActiveNodeChange={onActiveDataNodeChange}
        onOpenExternalUrl={openExternalUrl}
        viewerExtensionAdapter={viewerExtensionAdapter}
        documentSourceKind="local"
        resizableExplorer
        explorerCollapsed={resolvedExplorerCollapsed}
        explorerWidth={resolvedExplorerWidth}
        minExplorerWidth={resolvedExplorerMinWidth}
        maxExplorerWidth={resolvedExplorerMaxWidth}
        collapsedExplorerWidth={COLLAPSED_EXPLORER_WIDTH}
        explorerCollapseThreshold={EXPLORER_COLLAPSE_THRESHOLD}
        onExplorerCollapsedChange={preferences.setSidebarCollapsed}
        onExplorerWidthChange={preferences.setExplorerWidth}
        onExplorerResizeActiveChange={onExplorerResizeActiveChange}
        explorerResizeHandleRef={setExplorerResizeHandle}
        showHeader={false}
        showExplorerRoot={false}
        onExplorerRootContextMenu={(_state, event) => {
          event.preventDefault();
          event.stopPropagation();
          onCreateEntryMenu(activeWorkspaceRootPath, getContextMenuAnchorRect(event));
        }}
        onExplorerNodeContextMenu={(state, node, event) => {
          event.preventDefault();
          event.stopPropagation();
          const selectedNodes = state.selectedNodes.some(({ path }) => path === node.path)
            ? state.selectedNodes
            : [node];
          onNodeActionMenu(node, getContextMenuAnchorRect(event), selectedNodes);
        }}
        explorerCutPaths={fileClipboardController.cutPaths}
        onCopyNodes={fileClipboardController.copyNodes}
        onCutNodes={fileClipboardController.cutNodes}
        onPasteNodes={fileClipboardController.pasteNodes}
        onDuplicateNodes={fileClipboardController.duplicateNodes}
        explorerLoadingPresentation="skeleton"
        explorerListEndSlot={(
          <div
            className="desktop-explorer-list-end-create"
            data-open={sidebarCreateMenuOpen ? "true" : undefined}
          >
            <button
              className="tree-row desktop-explorer-list-end-create-row"
              type="button"
              aria-expanded={sidebarCreateMenuOpen}
              aria-controls="desktop-sidebar-create-menu"
              onClick={(event) => {
                if (sidebarCreateMenuOpen) {
                  onDismissCreateEntryMenu();
                  return;
                }
                onCreateEntryMenu(
                  activeWorkspaceRootPath,
                  rectToCreateEntryAnchor(event.currentTarget.getBoundingClientRect(), "auto-end"),
                );
              }}
            >
              <span className="tree-row-content desktop-explorer-list-end-create-command">
                <span className="tree-icon-slot"><Plus size={14} strokeWidth={2.2} aria-hidden="true" /></span>
                <span className="tree-label"><span className="tree-label-primary">{t("workspace.explorer.new")}</span></span>
              </span>
            </button>
          </div>
        )}
        showExplorerToolbar={!shellHostedTopNavigation && Boolean(topNavigation)}
        explorerToolbarSlot={shellHostedTopNavigation ? undefined : (topNavigation ?? undefined)}
        explorerRailSlot={navigation.showWorkspaceNavigation
          && preferences.sidebarNavigationPlacement === "left" ? (
          <DesktopSidebarRailNavigation {...navigationCommon} />
        ) : undefined}
        showPreviewHeader={false}
        loadActiveFileSource={resolvedSurface.id !== "data"}
        hidePreviewSourceView
        fileIconTheme={preferences.fileIconTheme}
        editorInteractionPreferences={editorInteractionPreferences}
        editorSaveMode="auto"
        htmlTrustMode="safe"
        aiEditRequest={activeAiEditRequest}
        enableMarkdownLinkContentIndexing
        folderExpansionStrategy="load-before-expand"
        refreshKey={workspaceRefreshToken}
        atomicRefreshKey={workspaceAtomicRefreshToken}
        explorerNodeActionSlot={(state, node) => {
          const agentPresencePath = node.type === "file"
            ? node.workspaceFolderId
              ? resolveWorkspaceResource(node.path)?.providerPath ?? null
              : toWorkspaceRelativePath(workspace.path, node.path)
            : null;
          return (
            <>
              {agentPresencePath && (
                <AgentFilePresence
                  path={agentPresencePath}
                  store={desktopAgentActivityStore}
                  variant="explorer"
                />
              )}
              <DesktopExplorerRowActions
                node={node}
                parentPath={node.type === "folder" ? node.path : null}
                showMoreActions={!node.workspaceFolderRoot}
                onRemoveWorkspaceRoot={workspaceFolders.length > 0
                  ? () => {
                      const folder = workspaceFolders.find((item) => item.id === node.workspaceFolderId);
                      if (folder) void onRemoveProject(folder);
                    }
                  : undefined}
                onCreate={onCreateEntryMenu}
                onOpenNodeMenu={(targetNode, anchorRect) => {
                  const selectedNodes = state.selectedNodes.some(({ path }) => path === targetNode.path)
                    ? state.selectedNodes
                    : [targetNode];
                  onNodeActionMenu(targetNode, anchorRect, selectedNodes);
                }}
              />
            </>
          );
        }}
        explorerSlot={resolvedSurface.id === "data"
          ? undefined
          : <WorkspaceSurfaceOutlet region="sidebar" surface={resolvedSurface} />}
        explorerFooterSlot={navigation.showWorkspaceNavigation && (
          remoteUpdateNoticeVisible
          || sidebarCompanion
          || preferences.sidebarNavigationPlacement === "bottom"
        )
          ? (
              <div className="desktop-sidebar-companion-host">
                {remoteUpdateNoticeVisible && (
                  <div className="desktop-sidebar-lower-notice">
                    <RemoteUpdateNotice
                      status={navigation.gitStatus}
                      operationLoading={navigation.gitOperationLoading}
                      onPull={navigation.onPullGit}
                    />
                  </div>
                )}
                {sidebarCompanion}
                {preferences.sidebarNavigationPlacement === "bottom" && (
                  <DesktopSidebarFooterNavigation {...navigationCommon} />
                )}
              </div>
            )
          : undefined}
        mainSlot={resolvedSurface.id === "data"
          ? (state) => (
              <>
                <WorkspaceRootOnboardingStatusReporter
                  workspaceKey={explorerSession.key}
                  rootLoading={state.rootLoading}
                  loadError={state.loadError}
                  rootEntryCount={state.tree.length}
                  onStatusChange={updateWorkspaceRootStatus}
                />
                <DesktopEditorSplitView
                  aiEditRequest={activeAiEditRequest}
                  dataPort={dataPort}
                  editorGroup={editorWorkbench.state}
                  externalOpen={externalOpen}
                  editorInteractionPreferences={editorInteractionPreferences}
                  editorTree={state.tree}
                  fileIconTheme={preferences.fileIconTheme}
                  layout={editorWorkbench.paneLayout}
                  markdownEnvironment={state.markdownEnvironment}
                  documentNavigation={state.documentNavigation}
                  refreshKey={workspaceRefreshToken}
                  viewerExtensionAdapter={viewerExtensionAdapter}
                  workspace={workspace}
                  resolveWorkspaceResource={resolveWorkspaceResource}
                  onClosePane={editorWorkbench.closePane}
                  onFocusPane={editorWorkbench.focusPane}
                  onMovePane={editorWorkbench.movePane}
                  onOpenAtPaneEdge={editorWorkbench.openDocumentAtPaneEdge}
                  onResolveResourceDrop={resolveEditorResourceDrop}
                  onResizeSplit={editorWorkbench.resizeSplit}
                  resourceDragEntries={resourceDragPreview?.entries}
                  resourceDragSessionId={resourceDragPreview?.id}
                  onSplitPane={editorWorkbench.splitPane}
                />
              </>
            )
          : resolvedSurface.content.main == null
            ? undefined
            : <WorkspaceSurfaceOutlet region="main" surface={resolvedSurface} />}
        capabilities={{
          create: true,
          rename: true,
          delete: true,
          move: true,
          copy: Boolean(dataPort.copyNode),
          write: Boolean(dataPort.documentPersistence),
          history: true,
          accessPoints: false,
          cloudSync: false,
          localGit: navigation.gitEnabled,
          connectors: false,
        }}
      />
      {activeAiEditRequest && resolvedSurface.id === "data" && (
        <div className="desktop-ai-edit-review-floating">
          <AiResponseChangesCard
            request={activeAiEditRequest}
            activePath={activeDocumentPath}
            onOpenFile={onActiveDataPathChange}
          />
        </div>
      )}
      {showEmptyWorkspaceOnboarding && (
        <EmptyWorkspaceOnboardingDialog
          onConfirm={confirmWorkspaceStarter}
        />
      )}
    </div>
  );
}

function WorkspaceRootOnboardingStatusReporter({
  workspaceKey,
  rootLoading,
  loadError,
  rootEntryCount,
  onStatusChange,
}: {
  workspaceKey: string;
  rootLoading: boolean;
  loadError: string | null;
  rootEntryCount: number;
  onStatusChange: (workspaceKey: string, status: WorkspaceRootOnboardingStatus) => void;
}) {
  useEffect(() => {
    onStatusChange(workspaceKey, resolveWorkspaceRootOnboardingStatus({
      rootLoading,
      loadError,
      rootEntryCount,
    }));
  }, [loadError, onStatusChange, rootEntryCount, rootLoading, workspaceKey]);
  return null;
}

function getContextMenuAnchorRect(event: ReactMouseEvent<HTMLElement>): DOMRect {
  if (event.clientX === 0 && event.clientY === 0) {
    return event.currentTarget.getBoundingClientRect();
  }
  return new DOMRect(event.clientX, event.clientY, 0, 0);
}
