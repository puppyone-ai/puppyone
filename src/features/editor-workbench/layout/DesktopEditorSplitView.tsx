import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useLocalization } from "@puppyone/localization";
import {
  getAiEditFileForPath,
  getEditorPanes,
  type AiEditRequest,
  type DataNode,
  type DataPort,
  type DocumentDataNode,
  type DocumentNavigationPort,
  type EditorGroupState,
  type EditorFindCommand,
  type EditorInteractionPreferences,
  type EditorPaneMenuContribution,
  type EditorPaneLayoutLeaf,
  type EditorPaneLayoutNode,
  type EditorPaneLayoutSplit,
  type EditorPaneLayoutState,
  type EditorPaneSplitOptions,
  type EditorSplitDirection,
  type ExplorerReferenceDragEntry,
  type FileIconThemeId,
  type MarkdownWorkspaceEnvironment,
  type ViewerExtensionHostAdapter,
  type Workspace,
  type WorkspaceContentChange,
} from "@puppyone/shared-ui";
import {
  useExplorerFileDrop,
  type EditorFileDropController,
} from "../drag-and-drop/useExplorerFileDrop";
import {
  usePaneMoveDrag,
  type PaneMoveDragController,
} from "../drag-and-drop/usePaneMoveDrag";
import { createEditorNodeIndex, type EditorNodeIndex } from "../runtime/editorNodeIndex";
import { EditorPaneRuntime } from "../runtime/EditorPaneRuntime";
import { EditorPaneRenderBoundary } from "../runtime/EditorPaneRenderBoundary";
import { EditorPaneShell } from "./EditorPaneShell";
import { EditorSplitResizeHandle } from "./EditorSplitResizeHandle";
import { EditorPaneHostSlot } from "./pane-host/EditorPaneHostSlot";
import {
  usePersistentEditorPaneHosts,
  type PersistentEditorPaneHosts,
} from "./pane-host/usePersistentEditorPaneHosts";
import { toWorkspaceRelativePath } from "../../desktop-agent-presence";

export type DesktopEditorSplitViewProps = Readonly<{
  aiEditRequest: AiEditRequest | null;
  dataPort: DataPort;
  editorGroup: EditorGroupState;
  editorInteractionPreferences: EditorInteractionPreferences;
  fileIconTheme: FileIconThemeId;
  layout: EditorPaneLayoutState;
  editorTree: readonly DataNode[];
  markdownEnvironment: MarkdownWorkspaceEnvironment;
  documentNavigation: DocumentNavigationPort;
  refreshKey?: WorkspaceContentChange;
  viewerExtensionAdapter?: ViewerExtensionHostAdapter | null;
  workspace: Workspace;
  resolveWorkspaceResource?: (path: string | null) => Readonly<{
    folder: Readonly<{ workspace: Workspace }>;
    providerPath: string | null;
  }> | null;
  externalOpen?: Readonly<{
    open: (path: string) => void | Promise<void>;
  }>;
  onClosePane: (paneId: string) => void;
  onFocusPane: (paneId: string) => void;
  onResizeSplit: (splitId: string, ratio: number) => void;
  onMovePane: (
    sourcePaneId: string,
    targetPaneId: string,
    direction: EditorSplitDirection,
    placement: NonNullable<EditorPaneSplitOptions["placement"]>,
  ) => void;
  onOpenAtPaneEdge: (
    node: DocumentDataNode,
    targetPaneId: string,
    direction: EditorSplitDirection,
    placement: NonNullable<EditorPaneSplitOptions["placement"]>,
  ) => void;
  onResolveResourceDrop?: (
    files: File[],
    resourceDragSessionId: string,
  ) => Promise<readonly ExplorerReferenceDragEntry[] | null>;
  resourceDragEntries?: readonly ExplorerReferenceDragEntry[] | null;
  resourceDragSessionId?: string | null;
  onSplitPane: (
    paneId: string,
    direction: EditorSplitDirection,
    placement: NonNullable<EditorPaneSplitOptions["placement"]>,
  ) => void;
}>;

export function DesktopEditorSplitView({
  aiEditRequest,
  dataPort,
  editorGroup,
  editorInteractionPreferences,
  fileIconTheme,
  layout,
  editorTree,
  markdownEnvironment,
  documentNavigation,
  refreshKey,
  viewerExtensionAdapter = null,
  workspace,
  resolveWorkspaceResource,
  externalOpen,
  onClosePane,
  onFocusPane,
  onMovePane,
  onOpenAtPaneEdge,
  onResolveResourceDrop,
  onResizeSplit,
  resourceDragEntries = null,
  resourceDragSessionId = null,
  onSplitPane,
}: DesktopEditorSplitViewProps) {
  const editorById = useMemo(
    () => new Map(editorGroup.editors.map((editor) => [editor.id, editor])),
    [editorGroup.editors],
  );
  const panes = useMemo(() => getEditorPanes(layout), [layout]);
  const editorNodeIndex = useMemo(() => createEditorNodeIndex(editorTree), [editorTree]);
  const paneCount = panes.length;
  const paneHosts = usePersistentEditorPaneHosts(panes.map((pane) => pane.id));
  const [openActionsPaneId, setOpenActionsPaneId] = useState<string | null>(null);
  const paneMove = usePaneMoveDrag(onMovePane);
  const fileDrop = useExplorerFileDrop(
    workspace.id,
    onOpenAtPaneEdge,
    resourceDragEntries,
    resourceDragSessionId,
    onResolveResourceDrop,
  );

  useEffect(() => {
    if (openActionsPaneId && !panes.some((pane) => pane.id === openActionsPaneId)) {
      setOpenActionsPaneId(null);
    }
  }, [openActionsPaneId, panes]);

  useEffect(() => {
    if (paneMove.dragging) setOpenActionsPaneId(null);
  }, [paneMove.dragging]);

  return (
    <div className="desktop-editor-split-view" data-pane-count={paneCount}>
      <EditorLayoutNode
        node={layout.root}
        touchesBlockEnd
        touchesInlineStart
        paneHosts={paneHosts}
        onResizeSplit={onResizeSplit}
      />
      {panes.map((pane) => createPortal(
        <EditorPane
          activePaneId={layout.activePaneId}
          aiEditRequest={aiEditRequest}
          dataPort={dataPort}
          editorById={editorById}
          editorNodeIndex={editorNodeIndex}
          editorInteractionPreferences={editorInteractionPreferences}
          externalOpen={externalOpen}
          fileIconTheme={fileIconTheme}
          fileDrop={fileDrop}
          pane={pane}
          paneCount={paneCount}
          paneMove={paneMove}
          openActionsPaneId={openActionsPaneId}
          markdownEnvironment={markdownEnvironment}
          documentNavigation={documentNavigation}
          refreshKey={refreshKey}
          viewerExtensionAdapter={viewerExtensionAdapter}
          workspace={workspace}
          resolveWorkspaceResource={resolveWorkspaceResource}
          onClosePane={onClosePane}
          onFocusPane={onFocusPane}
          onOpenActionsPaneChange={setOpenActionsPaneId}
          onSplitPane={onSplitPane}
        />,
        paneHosts.get(pane.id)!,
        pane.id,
      ))}
    </div>
  );
}

type EditorLayoutNodeProps = Readonly<{
  node: EditorPaneLayoutNode;
  paneHosts: PersistentEditorPaneHosts;
  touchesBlockEnd: boolean;
  touchesInlineStart: boolean;
  onResizeSplit: DesktopEditorSplitViewProps["onResizeSplit"];
}>;

function EditorLayoutNode(props: EditorLayoutNodeProps): ReactNode {
  if (props.node.kind === "pane") {
    return (
      <EditorPaneHostSlot
        host={props.paneHosts.get(props.node.id)!}
        paneId={props.node.id}
        touchesBlockEnd={props.touchesBlockEnd}
      />
    );
  }
  return <EditorSplit {...props} split={props.node} />;
}

function EditorSplit({
  node: _node,
  split,
  ...props
}: EditorLayoutNodeProps & { split: EditorPaneLayoutSplit }) {
  const style = {
    "--desktop-editor-first-track": `${split.ratio}fr`,
    "--desktop-editor-second-track": `${1 - split.ratio}fr`,
  };

  return (
    <div
      className="desktop-editor-split"
      data-direction={split.direction}
      data-touches-inline-start={props.touchesInlineStart ? "true" : undefined}
      style={style as CSSProperties}
    >
      <EditorLayoutNode
        key={split.first.id}
        {...props}
        node={split.first}
        touchesBlockEnd={split.direction === "horizontal" && props.touchesBlockEnd}
        touchesInlineStart={props.touchesInlineStart}
      />
      <EditorSplitResizeHandle
        key={split.id}
        direction={split.direction}
        ratio={split.ratio}
        splitId={split.id}
        onCommit={props.onResizeSplit}
      />
      <EditorLayoutNode
        key={split.second.id}
        {...props}
        node={split.second}
        touchesBlockEnd={props.touchesBlockEnd}
        touchesInlineStart={split.direction === "vertical" && props.touchesInlineStart}
      />
    </div>
  );
}

type EditorPaneProps = Readonly<{
  activePaneId: string;
  aiEditRequest: AiEditRequest | null;
  dataPort: DataPort;
  editorById: ReadonlyMap<string, EditorGroupState["editors"][number]>;
  editorNodeIndex: EditorNodeIndex;
  editorInteractionPreferences: EditorInteractionPreferences;
  externalOpen?: DesktopEditorSplitViewProps["externalOpen"];
  fileIconTheme: FileIconThemeId;
  fileDrop: EditorFileDropController;
  pane: EditorPaneLayoutLeaf;
  paneCount: number;
  paneMove: PaneMoveDragController;
  openActionsPaneId: string | null;
  markdownEnvironment: MarkdownWorkspaceEnvironment;
  documentNavigation: DocumentNavigationPort;
  refreshKey?: WorkspaceContentChange;
  viewerExtensionAdapter?: ViewerExtensionHostAdapter | null;
  workspace: Workspace;
  resolveWorkspaceResource?: DesktopEditorSplitViewProps["resolveWorkspaceResource"];
  onClosePane: DesktopEditorSplitViewProps["onClosePane"];
  onFocusPane: DesktopEditorSplitViewProps["onFocusPane"];
  onOpenActionsPaneChange: (paneId: string | null) => void;
  onSplitPane: DesktopEditorSplitViewProps["onSplitPane"];
}>;

function EditorPane({
  activePaneId,
  aiEditRequest,
  dataPort,
  editorById,
  editorNodeIndex,
  editorInteractionPreferences,
  externalOpen,
  fileIconTheme,
  fileDrop,
  pane,
  paneCount,
  paneMove,
  openActionsPaneId,
  markdownEnvironment,
  documentNavigation,
  refreshKey,
  viewerExtensionAdapter,
  workspace,
  resolveWorkspaceResource,
  onClosePane,
  onFocusPane,
  onOpenActionsPaneChange,
  onSplitPane,
}: EditorPaneProps) {
  const { t } = useLocalization();
  const active = pane.id === activePaneId;
  const actionsOpen = pane.id === openActionsPaneId;
  const editor = pane.editorId ? editorById.get(pane.editorId) ?? null : null;
  const treeNode = editor
    ? editorNodeIndex.get(editor.resource) ?? null
    : null;
  const editorWorkspaceResource = editor
    ? resolveWorkspaceResource?.(editor.resource) ?? null
    : null;
  const editorWorkspace = editorWorkspaceResource?.folder.workspace ?? workspace;
  const [findCommand, setFindCommand] = useState<EditorFindCommand | null>(null);
  const [menuContribution, setMenuContribution] = useState<Readonly<{
    editorResource: string | null;
    contribution: EditorPaneMenuContribution;
  }> | null>(null);
  const publishMenuContribution = useCallback((contribution: EditorPaneMenuContribution | null) => {
    setMenuContribution(contribution
      ? { editorResource: editor?.resource ?? null, contribution }
      : null);
  }, [editor?.resource]);
  const externalOpenPath = editor?.resource ?? null;
  const agentPresencePath = editor
    ? editorWorkspaceResource?.providerPath
      ?? toWorkspaceRelativePath(editorWorkspace.path, editor.resource)
    : null;
  const paneMenuContribution = menuContribution?.editorResource === editor?.resource
    ? menuContribution?.contribution ?? null
    : null;

  return (
    <EditorPaneShell
      active={active}
      actionsOpen={actionsOpen}
      agentPresencePath={agentPresencePath}
      contentState={editor ? "document" : "empty"}
      editorLabel={editor?.label ?? null}
      findCommand={findCommand}
      fileDrop={fileDrop}
      pane={pane}
      paneCount={paneCount}
      paneMove={paneMove}
      menuContribution={paneMenuContribution}
      onActionsPaneChange={onOpenActionsPaneChange}
      onActivate={() => {
        if (!active) onFocusPane(pane.id);
      }}
      onClose={() => onClosePane(pane.id)}
      onOpenExternal={externalOpen && externalOpenPath
        ? () => externalOpen.open(externalOpenPath)
        : null}
      onSplit={(direction, placement) => onSplitPane(pane.id, direction, placement)}
    >
      <EditorPaneRenderBoundary
        failureTitle={t("shared-ui.preview.crashed")}
        resetKey={editor?.resource
          ? `${editor.resource}:${refreshKey?.sequence ?? 0}`
          : null}
      >
        <EditorPaneRuntime
          aiEditFile={getAiEditFileForPath(aiEditRequest, editor?.resource) ?? null}
          dataPort={dataPort}
          editor={editor}
          editorInteractionPreferences={editorInteractionPreferences}
          fileIconTheme={fileIconTheme}
          markdownEnvironment={markdownEnvironment}
          documentNavigation={documentNavigation}
          refreshKey={refreshKey}
          treeNode={treeNode}
          viewerExtensionAdapter={viewerExtensionAdapter}
          workspaceId={editorWorkspace.id}
          workspaceRoot={editorWorkspace.path}
          markdownDialect={editorWorkspace.markdownDialect}
          onFindCommandChange={setFindCommand}
          onMenuContributionChange={publishMenuContribution}
        />
      </EditorPaneRenderBoundary>
    </EditorPaneShell>
  );
}
