import { useMemo, useState, type ReactNode } from "react";
import { Plus, RefreshCw, Settings2 } from "lucide-react";
import { DataWorkspace, Tooltip, type EditorInteractionPreferences } from "@puppyone/shared-ui";
import { useLocalization } from "@puppyone/localization";
import type { DesktopPreferencesController } from "../../app-shell/useDesktopPreferences";
import { useDesktopPaneLayout } from "../../app-shell/layout/DesktopPaneLayoutContext";
import { COLLAPSED_EXPLORER_WIDTH, EXPLORER_COLLAPSE_THRESHOLD, MAX_EXPLORER_WIDTH, MIN_EXPLORER_WIDTH } from "../../app-shell/layout/desktopPaneLayout";
import { DesktopEditorSplitView } from "../../editor-workbench/layout/DesktopEditorSplitView";
import { useProjectExplorerSession } from "../../data-workspace/useProjectExplorerSession";
import { formatFileOperationNotice } from "../../data-workspace/useFileClipboard";
import { DesktopCreateEntryDialog, DesktopCreateEntryMenu, DesktopExplorerRowActions, DesktopNodeActionMenu, rectToCreateEntryAnchor } from "../../data-workspace/nodeActions";
import { resolveVisibleCreateNewMenuItems } from "../../../preferences";
import { useNativeSurfacePointerPassthroughActivity, useNativeSurfacePointerRoutingRegion } from "../../native-surfaces";
import { openExternalUrl } from "../../../lib/localFiles";
import type { NativeCloudWorkbench } from "./useNativeCloudWorkbench";

export function DesktopNativeCloudWorkspace({ workbench, preferences, onOpenCloudServices, footer }: {
  workbench: NativeCloudWorkbench;
  preferences: DesktopPreferencesController;
  onOpenCloudServices: () => void;
  footer?: ReactNode;
}) {
  const { service, dataPort } = workbench;
  return service && dataPort && workbench.visited
    ? <NativeCloudFiles key={service.workspace.id} workbench={workbench} preferences={preferences}
        onOpenCloudServices={onOpenCloudServices} footer={footer} />
    : null;
}

function NativeCloudFiles({ workbench, preferences, onOpenCloudServices, footer }: {
  workbench: NativeCloudWorkbench;
  preferences: DesktopPreferencesController;
  onOpenCloudServices: () => void;
  footer?: ReactNode;
}) {
  const { t } = useLocalization();
  const { service, dataPort, editorWorkbench, actions } = workbench;
  const { createEntryDraft, nodeActionMenu, fileClipboardController: clipboard } = actions;
  const paneLayout = useDesktopPaneLayout();
  const folders = useMemo(() => [service!.folder], [service]);
  const explorerSession = useProjectExplorerSession(service!.workspace, folders);
  const [resizeHandle, setResizeHandle] = useState<HTMLDivElement | null>(null);
  const onResizeActiveChange = useNativeSurfacePointerPassthroughActivity("explorer-resize");
  useNativeSurfacePointerRoutingRegion("explorer-resize", resizeHandle);
  const interactionPreferences = useMemo<EditorInteractionPreferences>(() => ({
    showSaveStatus: true,
    markdownBlockDragEnabled: preferences.experimentalSettings.enableMarkdownBlockDrag,
    markdownHeadingOutlineEnabled: preferences.experimentalSettings.enableMarkdownHeadingOutline,
  }), [preferences.experimentalSettings]);
  const createItems = useMemo(() => {
    const items = resolveVisibleCreateNewMenuItems(preferences.createNewMenuSettings, preferences.experimentalSettings);
    return { main: items.main.filter((item) => item !== "slides"), submenu: items.submenu.filter((item) => item !== "slides") };
  }, [preferences.createNewMenuSettings, preferences.experimentalSettings]);
  const notice = formatFileOperationNotice(clipboard.notice, t);
  const editable = service!.writable;
  const openCreate = (parent: string | null, anchor: DOMRect) => {
    if (editable) actions.openCreateEntryMenu(parent ?? service!.folder.uri, anchor);
  };
  return (
    <div className="desktop-data-workspace-wrap" data-cloud-native="true">
      {workbench.error && <div className="desktop-workspace-surface-alert" role="alert">{workbench.error}</div>}
      {notice && <div className="desktop-file-operation-notice" data-tone={clipboard.notice?.tone} role="status">{notice}</div>}
      <DataWorkspace
        key={explorerSession.key}
        workspace={service!.workspace}
        dataPort={dataPort!}
        labels={{ root: t("cloud.route.contents.title") }}
        documentSourceKind="cloud"
        initialExplorerSession={explorerSession.initialSession}
        onExplorerSessionChange={explorerSession.onSessionChange}
        activePath={workbench.activeNode?.path ?? editorWorkbench.activePath}
        onActivePathChange={workbench.onActivePathChange}
        onActiveNodeChange={workbench.setActiveNode}
        onResourceMove={editorWorkbench.rebaseResource}
        onOpenExternalUrl={openExternalUrl}
        explorerCutPaths={clipboard.cutPaths}
        onCopyNodes={clipboard.canCopy ? clipboard.copyNodes : undefined}
        onCutNodes={clipboard.canCut ? clipboard.cutNodes : undefined}
        onPasteNodes={editable ? clipboard.pasteNodes : undefined}
        onDuplicateNodes={clipboard.canDuplicate ? clipboard.duplicateNodes : undefined}
        showHeader={false}
        showExplorerRoot={false}
        showPreviewHeader={false}
        loadActiveFileSource={false}
        hidePreviewSourceView
        resizableExplorer
        explorerCollapsed={paneLayout?.explorer.collapsed ?? preferences.sidebarCollapsed}
        explorerWidth={preferences.explorerWidth}
        minExplorerWidth={paneLayout?.explorer.minWidth ?? MIN_EXPLORER_WIDTH}
        maxExplorerWidth={paneLayout?.explorer.maxWidth ?? MAX_EXPLORER_WIDTH}
        collapsedExplorerWidth={COLLAPSED_EXPLORER_WIDTH}
        explorerCollapseThreshold={EXPLORER_COLLAPSE_THRESHOLD}
        onExplorerCollapsedChange={preferences.setSidebarCollapsed}
        onExplorerWidthChange={preferences.setExplorerWidth}
        onExplorerResizeActiveChange={onResizeActiveChange}
        explorerResizeHandleRef={setResizeHandle}
        explorerLoadingPresentation="skeleton"
        folderExpansionStrategy="load-before-expand"
        fileIconTheme={preferences.fileIconTheme}
        editorInteractionPreferences={interactionPreferences}
        editorSaveMode="auto"
        htmlTrustMode="safe"
        enableMarkdownLinkContentIndexing
        refreshKey={workbench.refreshToken}
        explorerToolbarSlot={(
          <div className="desktop-explorer-toolbar">
            <span>{t("cloud.route.contents.title")}</span>
            <div className="desktop-explorer-actions">
              {editable && <Tooltip content={t("workspace.explorer.new")}><button type="button" aria-label={t("workspace.explorer.new")}
                onClick={(event) => openCreate(service!.folder.uri, event.currentTarget.getBoundingClientRect())}><Plus size={15} /></button></Tooltip>}
              <Tooltip content={t("cloud.common.refresh")}><button type="button" aria-label={t("cloud.common.refresh")} onClick={workbench.refresh}><RefreshCw size={14} /></button></Tooltip>
              <Tooltip content={t("shell.navigation.cloud")}><button type="button" aria-label={t("shell.navigation.cloud")} onClick={onOpenCloudServices}><Settings2 size={14} /></button></Tooltip>
            </div>
          </div>
        )}
        onExplorerRootContextMenu={editable ? (_state, event) => {
          event.preventDefault(); event.stopPropagation(); openCreate(service!.folder.uri, event.currentTarget.getBoundingClientRect());
        } : undefined}
        onExplorerNodeContextMenu={editable ? (state, node, event) => {
          event.preventDefault(); event.stopPropagation();
          actions.openNodeActionMenu(node, event.currentTarget.getBoundingClientRect(),
            state.selectedNodes.some(({ path }) => path === node.path) ? state.selectedNodes : [node]);
        } : undefined}
        explorerNodeActionSlot={editable ? (state, node) => <DesktopExplorerRowActions
          createMenuOpen={Boolean(createEntryDraft && createEntryDraft.parentPath === node.path)}
          node={node} nodeMenuOpen={nodeActionMenu?.node.path === node.path} parentPath={node.type === "folder" ? node.path : null}
          showMoreActions onCreate={(parent, anchor) => actions.openCreateEntryMenu(parent ?? service!.folder.uri, anchor)}
          onOpenNodeMenu={(target, anchor) => actions.openNodeActionMenu(target, anchor,
            state.selectedNodes.some(({ path }) => path === target.path) ? state.selectedNodes : [target])} /> : undefined}
        explorerListEndSlot={editable ? <div className="desktop-explorer-list-end-create"><button type="button"
          className="tree-row desktop-explorer-list-end-create-row" onClick={(event) => actions.openCreateEntryMenu(service!.folder.uri, rectToCreateEntryAnchor(event.currentTarget.getBoundingClientRect(), "auto-end"))}>
          <span className="tree-row-content desktop-explorer-list-end-create-command"><span className="tree-icon-slot"><Plus size={14} /></span><span className="tree-label"><span className="tree-label-primary">{t("workspace.explorer.new")}</span></span></span>
        </button></div> : undefined}
        explorerFooterSlot={footer}
        mainSlot={(state) => <DesktopEditorSplitView
          aiEditRequest={null} dataPort={dataPort!} editorGroup={editorWorkbench.state} documentSourceKind="cloud"
          editorInteractionPreferences={interactionPreferences} editorTree={state.tree} fileIconTheme={preferences.fileIconTheme}
          layout={editorWorkbench.paneLayout} markdownEnvironment={state.markdownEnvironment} documentNavigation={state.documentNavigation}
          refreshKey={workbench.refreshToken} workspace={service!.workspace} resolveWorkspaceResource={service!.resolveResource}
          onClosePane={editorWorkbench.closePane} onFocusPane={editorWorkbench.focusPane} onMovePane={editorWorkbench.movePane}
          onOpenAtPaneEdge={editorWorkbench.openDocumentAtPaneEdge} onResizeSplit={editorWorkbench.resizeSplit} onSplitPane={editorWorkbench.splitPane} />}
        capabilities={{ create: editable, rename: editable, delete: editable, move: editable,
          copy: false, write: editable, history: false, localGit: false }}
      />
      {createEntryDraft && (createEntryDraft.selectedKind
        ? <DesktopCreateEntryDialog draft={createEntryDraft} fileIconTheme={preferences.fileIconTheme}
            onChange={actions.setCreateEntryDraft} onCancel={() => actions.setCreateEntryDraft(null)} onCreate={actions.createEntryFromMenu} />
        : <DesktopCreateEntryMenu draft={createEntryDraft} mainEntries={createItems.main} submenuItemKinds={createItems.submenu}
            fileIconTheme={preferences.fileIconTheme} onCancel={() => actions.setCreateEntryDraft(null)} onSelectKind={actions.selectCreateEntryKind} />)}
      {nodeActionMenu && <DesktopNodeActionMenu draft={nodeActionMenu} experimentalSettings={preferences.experimentalSettings}
        showRevealInFinder={false} showOpenInDefaultApp={false} canCopy={clipboard.canCopy} canCut={clipboard.canCut}
        canPaste={nodeActionMenu.node.type === "folder" && clipboard.canPasteInto(nodeActionMenu.node.path)} canDuplicate={false}
        onChange={actions.setNodeActionMenu} onCancel={() => actions.setNodeActionMenu(null)}
        onCopy={() => { clipboard.copyNodes(nodeActionMenu.nodes); actions.setNodeActionMenu(null); }}
        onCut={() => { clipboard.cutNodes(nodeActionMenu.nodes); actions.setNodeActionMenu(null); }}
        onPaste={() => { actions.setNodeActionMenu(null); void clipboard.pasteNodes(nodeActionMenu.node.path); }}
        onDuplicate={() => undefined} onCreateInside={() => actions.openCreateEntryMenu(nodeActionMenu.node.path, nodeActionMenu.anchor)}
        onRename={actions.renameNodeFromMenu} onDelete={actions.deleteNodeFromMenu}
        onOpenInDefaultApp={() => undefined} onRevealInFinder={() => undefined} />}
    </div>
  );
}
