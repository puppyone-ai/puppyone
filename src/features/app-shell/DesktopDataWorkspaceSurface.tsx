import { useDesktopPreference, selectFileIconTheme } from "../settings";
import {
  useCallback,
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
  FloatingNotice,
  FloatingNoticeStack,
  PulseGridLoader,
  useDismissibleNotice,
  type AiEditRequest,
  type DataNode,
  type DocumentSourceKind,
  type FloatingNoticeProps,
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
import type { FileClipboardController, FileOperationNotice } from "../data-workspace/useFileClipboard";
import type { GitStatusSnapshot } from "../../types/electron";
import { useDesktopPaneLayout } from "./layout/DesktopPaneLayoutContext";
import {
  COLLAPSED_EXPLORER_WIDTH,
  EXPLORER_COLLAPSE_THRESHOLD,
  MAX_EXPLORER_WIDTH,
  MIN_EXPLORER_WIDTH,
} from "./layout/desktopPaneLayout";
import { DesktopSidebarFooterNavigation } from "./navigation";
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
import type { ResolvedWorkbenchDataResource } from "../data-workspace/workbenchDataPort";
import { useProjectExplorerSession } from "../data-workspace/useProjectExplorerSession";

type DataWorkspaceProps = ComponentProps<typeof DataWorkspace>;

export type DesktopDataWorkspaceSurfaceProps = {
  activeAiEditRequest: AiEditRequest | null;
  activeDocumentPath: string | null;
  activeExplorerPath: string | null;
  dataPort: NonNullable<DataWorkspaceProps["dataPort"]>;
  documentSourceKind?: DocumentSourceKind;
  providerStateContent?: ReactNode;
  editorWorkbench: DesktopEditorWorkbenchController;
  externalOpen: Readonly<{
    open: (path: string) => void | Promise<void>;
  }>;
  showSaveStatus: boolean;
  fileClipboardController: FileClipboardController;
  fileOperationNotice: string | null;
  navigation: {
    activeView: DesktopView;
    availableSurfaceIds: readonly DesktopView[];
    gitEnabled: boolean;
    gitIncomingCount: number;
    gitOperationLoading: string | null;
    gitStatus: GitStatusSnapshot | null;
    workspaceChangeCount: number;
    onNavigate: (view: DesktopView) => void;
    onOpenPlugins: () => void;
    onOpenSettings: () => void;
    pluginsOpen: boolean;
    settingsOpen: boolean;
    showPlugins: boolean;
    showSettings: boolean;
    showWorkspaceNavigation: boolean;
  };
  onActiveDataPathChange: (
    path: string | null,
    node?: DataNode | null,
  ) => void | Promise<void>;
  onActiveDataNodeChange: (node: DataNode | null) => void;
  onResourceMove: (previousPath: string, nextPath: string) => void | Promise<void>;
  onRemoveProject: (folder: WorkspaceFolder) => void | Promise<void>;
  openCreateEntryParentPath: string | null | undefined;
  openNodeActionPath: string | null;
  onCreateEntryMenu: (parentPath: string | null, anchorRect: DesktopCreateEntryAnchorInput) => void;
  onDismissCreateEntryMenu: () => void;
  onNodeActionMenu: (node: DataNode, anchorRect: DOMRect, selectedNodes?: readonly DataNode[]) => void;
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
  documentSourceKind = "local",
  providerStateContent,
  editorWorkbench,
  externalOpen,
  showSaveStatus,
  fileClipboardController,
  fileOperationNotice,
  navigation,
  onActiveDataNodeChange,
  onResourceMove,
  onRemoveProject,
  openCreateEntryParentPath,
  openNodeActionPath,
  onActiveDataPathChange,
  onCreateEntryMenu,
  onDismissCreateEntryMenu,
  onNodeActionMenu,
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
  const markdownBlockDragEnabled = useDesktopPreference(s => s.experimentalSettings.enableMarkdownBlockDrag);
  const markdownHeadingOutlineEnabled = useDesktopPreference(s => s.experimentalSettings.enableMarkdownHeadingOutline);
  const editorInteractionPreferences = useMemo(() => ({ showSaveStatus, markdownBlockDragEnabled, markdownHeadingOutlineEnabled }),
    [showSaveStatus, markdownBlockDragEnabled, markdownHeadingOutlineEnabled]);
  const localResources = documentSourceKind === "local";
  const canCreate = Boolean(dataPort.createFile || dataPort.createFolder);
  const canChangeNodes = Boolean(dataPort.renameNode || dataPort.moveNode || dataPort.deleteNode);
  const [dragExportFailed, setDragExportFailed] = useState(false);
  const dismissDragExportFailure = useCallback(() => setDragExportFailed(false), []);
  const [visibleWorkspaceSurfaceError, dismissWorkspaceSurfaceError] = useDismissibleNotice(workspaceSurfaceError);
  const [workspaceNoticeStack, setWorkspaceNoticeStack] = useState<HTMLDivElement | null>(null);
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
  const onExplorerResizeActiveChange = useNativeSurfacePointerPassthroughActivity(
    "explorer-resize",
  );
  const [explorerResizeHandle, setExplorerResizeHandle] = useState<HTMLDivElement | null>(null);
  useNativeSurfacePointerRoutingRegion("explorer-resize", explorerResizeHandle);
  const explorerWidth = useDesktopPreference(s => s.explorerWidth);
  const fileIconTheme = useDesktopPreference(selectFileIconTheme);
  const setExplorerWidth = useDesktopPreference(s => s.setExplorerWidth);
  const setSidebarCollapsed = useDesktopPreference(s => s.setSidebarCollapsed);
  const sidebarCollapsed = useDesktopPreference(s => s.sidebarCollapsed);
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
  // DataWorkspace's width input is the expanded content-plane width. The
  // Shell's resolved width becomes zero while collapsed and must never replace
  // that retained geometry, or the Explorer children will reflow during exit.
  const resolvedExplorerWidth = paneLayout?.explorer.collapsed
    ? explorerWidth
    : paneLayout?.explorer.width ?? explorerWidth;
  const resolvedExplorerMaxWidth = paneLayout?.explorer.maxWidth
    ?? MAX_EXPLORER_WIDTH;
  const resolvedExplorerMinWidth = paneLayout?.explorer.minWidth ?? MIN_EXPLORER_WIDTH;
  const resolvedExplorerCollapsed = paneLayout?.explorer.collapsed
    ?? sidebarCollapsed;
  const navigationCommon = {
    activeView: navigation.activeView,
    availableSurfaceIds: navigation.availableSurfaceIds,
    gitEnabled: navigation.gitEnabled,
    gitIncomingCount: navigation.gitIncomingCount,
    gitOperationLoading: navigation.gitOperationLoading,
    gitStatus: navigation.gitStatus,
    workspaceChangeCount: navigation.workspaceChangeCount,
    onNavigate: navigation.onNavigate,
    onOpenPlugins: navigation.onOpenPlugins,
    onOpenSettings: navigation.onOpenSettings,
    pluginsOpen: navigation.pluginsOpen,
    settingsOpen: navigation.settingsOpen,
    showPlugins: navigation.showPlugins,
    showSettings: navigation.showSettings,
    utilitySlot: sidebarUtility,
  } as const;
  return (
    <div
      className="desktop-data-workspace-wrap"
      data-cloud-native={documentSourceKind === "cloud" ? "true" : undefined}
      data-file-workbench="true"
      data-sidebar-navigation-placement={navigation.showWorkspaceNavigation
        ? "bottom"
        : undefined}
    >
      <FloatingNoticeStack ref={setWorkspaceNoticeStack} className="desktop-workspace-notice-stack">
        {visibleWorkspaceSurfaceError && (
          <FloatingNotice tone="warning" role="status" onDismiss={dismissWorkspaceSurfaceError}>
            {visibleWorkspaceSurfaceError}
          </FloatingNotice>
        )}
        {dragExportFailed && (
          <FloatingNotice tone="danger" onDismiss={dismissDragExportFailure}>
            {t("workspace.drag.exportFailed")}
          </FloatingNotice>
        )}
      </FloatingNoticeStack>
      <FloatingNoticeStack placement="bottom-end" className="desktop-file-operation-notice-stack">
        {fileClipboardController.notice && fileOperationNotice && (
          <FloatingNotice
            {...fileOperationNoticePresentation(fileClipboardController.notice)}
            role="status"
            onDismiss={fileClipboardController.dismissNotice}
          >
            {fileOperationNotice}
          </FloatingNotice>
        )}
      </FloatingNoticeStack>
      <DataWorkspace
        onExportNodes={localResources ? exportNodes : undefined}
        resourceDragEntries={localResources ? resourceDragPreview?.entries : undefined}
        onResolveFileDrop={localResources ? resolveFileDrop : undefined}
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
        documentSourceKind={documentSourceKind}
        resizableExplorer
        explorerCollapsed={resolvedExplorerCollapsed}
        explorerWidth={resolvedExplorerWidth}
        minExplorerWidth={resolvedExplorerMinWidth}
        maxExplorerWidth={resolvedExplorerMaxWidth}
        collapsedExplorerWidth={COLLAPSED_EXPLORER_WIDTH}
        explorerCollapseThreshold={EXPLORER_COLLAPSE_THRESHOLD}
        onExplorerCollapsedChange={setSidebarCollapsed}
        onExplorerWidthChange={setExplorerWidth}
        onExplorerResizeActiveChange={onExplorerResizeActiveChange}
        explorerResizeHandleRef={setExplorerResizeHandle}
        showHeader={false}
        showExplorerRoot={false}
        onExplorerRootContextMenu={canCreate ? (_state, event) => {
          event.preventDefault();
          event.stopPropagation();
          onCreateEntryMenu(activeWorkspaceRootPath, getContextMenuAnchorRect(event));
        } : undefined}
        onExplorerNodeContextMenu={canChangeNodes ? (state, node, event) => {
          event.preventDefault();
          event.stopPropagation();
          const selectedNodes = state.selectedNodes.some(({ path }) => path === node.path)
            ? state.selectedNodes
            : [node];
          onNodeActionMenu(node, getContextMenuAnchorRect(event), selectedNodes);
        } : undefined}
        explorerCutPaths={fileClipboardController.cutPaths}
        onCopyNodes={fileClipboardController.canCopy ? fileClipboardController.copyNodes : undefined}
        onCutNodes={fileClipboardController.canCut ? fileClipboardController.cutNodes : undefined}
        onPasteNodes={dataPort.moveNode || dataPort.copyNode ? fileClipboardController.pasteNodes : undefined}
        onDuplicateNodes={fileClipboardController.canDuplicate ? fileClipboardController.duplicateNodes : undefined}
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
              aria-haspopup="menu"
              data-desktop-sidebar-menu-trigger="true"
              disabled={!canCreate}
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
        showExplorerToolbar={false}
        showPreviewHeader={false}
        loadActiveFileSource={resolvedSurface.id !== "data"}
        hidePreviewSourceView
        fileIconTheme={fileIconTheme}
        editorInteractionPreferences={editorInteractionPreferences}
        editorSaveMode="auto"
        htmlTrustMode="safe"
        aiEditRequest={activeAiEditRequest}
        enableMarkdownLinkContentIndexing={documentSourceKind !== "cloud"}
        folderExpansionStrategy={documentSourceKind === "cloud" ? "optimistic" : "load-before-expand"}
        refreshKey={workspaceRefreshToken}
        atomicRefreshKey={workspaceAtomicRefreshToken}
        explorerNodeActionSlot={(state, node) => {
          const agentPresencePath = localResources && node.type === "file"
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
              {canChangeNodes && <DesktopExplorerRowActions
                createMenuOpen={openCreateEntryParentPath !== undefined
                  && openCreateEntryParentPath === (node.type === "folder" ? node.path : null)}
                node={node}
                nodeMenuOpen={openNodeActionPath === node.path}
                parentPath={node.type === "folder" ? node.path : null}
                showMoreActions={!node.workspaceFolderRoot}
                onRemoveWorkspaceRoot={localResources && workspaceFolders.length > 0
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
              />}
            </>
          );
        }}
        explorerOpenActionMenu={openNodeActionPath !== null
          ? { path: openNodeActionPath, trigger: "more" }
          : openCreateEntryParentPath !== undefined
            ? { path: openCreateEntryParentPath, trigger: "create" }
            : null}
        explorerSlot={resolvedSurface.id === "data" || resolvedSurface.content.sidebar == null
          ? undefined
          : <WorkspaceSurfaceOutlet region="sidebar" surface={resolvedSurface} />}
        explorerFooterSlot={navigation.showWorkspaceNavigation || sidebarCompanion
          ? (
              <div className="desktop-sidebar-companion-host">
                {sidebarCompanion}
                {navigation.showWorkspaceNavigation && (
                  <DesktopSidebarFooterNavigation {...navigationCommon} />
                )}
              </div>
            )
          : undefined}
        mainSlot={resolvedSurface.id === "data"
          ? (state) => providerStateContent ?? (
              <>
                <DesktopEditorSplitView
                  noticeStack={workspaceNoticeStack}
                  aiEditRequest={activeAiEditRequest}
                  dataPort={dataPort}
                  documentSourceKind={documentSourceKind}
                  editorGroup={editorWorkbench.state}
                  externalOpen={externalOpen}
                  editorInteractionPreferences={editorInteractionPreferences}
                  editorTree={state.tree}
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
                  onResizeSplit={editorWorkbench.resizeSplit}
                  onSplitPane={editorWorkbench.splitPane}
                />
              </>
            )
          : resolvedSurface.content.main == null
            ? undefined
            : <WorkspaceSurfaceOutlet region="main" surface={resolvedSurface} />}
        capabilities={{
          create: canCreate,
          rename: Boolean(dataPort.renameNode),
          delete: Boolean(dataPort.deleteNode),
          move: Boolean(dataPort.moveNode),
          copy: Boolean(dataPort.copyNode),
          write: Boolean(dataPort.documentPersistence),
          history: localResources,
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
    </div>
  );
}

function fileOperationNoticePresentation(
  notice: FileOperationNotice,
): Pick<FloatingNoticeProps, "icon" | "tone"> {
  if (notice.tone === "error") return { tone: "danger" };
  if (notice.code === "in-progress") {
    return { tone: "neutral", icon: <PulseGridLoader size="xs" ariaHidden /> };
  }
  if (notice.code === "completed") return { tone: "success" };
  return { tone: "neutral" };
}

function getContextMenuAnchorRect(event: ReactMouseEvent<HTMLElement>): DOMRect {
  if (event.clientX === 0 && event.clientY === 0) {
    return event.currentTarget.getBoundingClientRect();
  }
  return new DOMRect(event.clientX, event.clientY, 0, 0);
}
