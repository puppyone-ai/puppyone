import { memo, useMemo } from "react";
import { useLocalization } from "@puppyone/localization";
import { PageLoading } from "../../../components/loading";
import {
  FilePreview,
  isDocumentDataNode,
  type AiEditFile,
  type DataNode,
  type DataPort,
  type DocumentDataNode,
  type DocumentNavigationPort,
  type ContextMapWorkspaceEnvironment,
  type EditorGroupState,
  type EditorInteractionPreferences,
  type FileContent,
  type FileIconThemeId,
  type MarkdownWorkspaceEnvironment,
  type ViewerExtensionHostAdapter,
  type Workspace,
  type WorkspaceContentChange,
  workspaceContentChangeMatchesResource,
} from "@puppyone/shared-ui";
import { useEditorPaneSource } from "./useEditorPaneSource";

export type EditorPaneDocumentRuntimeProps = Readonly<{
  aiEditFile: AiEditFile | null;
  dataPort: DataPort;
  editor: EditorGroupState["editors"][number] | null;
  editorInteractionPreferences: EditorInteractionPreferences;
  fileIconTheme: FileIconThemeId;
  markdownEnvironment: MarkdownWorkspaceEnvironment;
  documentNavigation: DocumentNavigationPort;
  refreshKey?: WorkspaceContentChange;
  treeNode: DataNode | null;
  viewerExtensionAdapter?: ViewerExtensionHostAdapter | null;
  workspaceId: Workspace["id"];
  workspaceRoot: Workspace["path"];
  markdownDialect: Workspace["markdownDialect"];
}>;

/** Expensive source and Viewer boundary. Active-pane routing lives above this
 * component so focus changes do not reconcile document content. */
export const EditorPaneDocumentRuntime = memo(function EditorPaneDocumentRuntime({
  aiEditFile,
  dataPort,
  editor,
  editorInteractionPreferences,
  fileIconTheme,
  markdownEnvironment,
  documentNavigation,
  refreshKey,
  treeNode,
  viewerExtensionAdapter = null,
  workspaceId,
  workspaceRoot,
  markdownDialect,
}: EditorPaneDocumentRuntimeProps) {
  return (
    <RegularEditorPaneDocumentRuntime
      aiEditFile={aiEditFile}
      dataPort={dataPort}
      editor={editor}
      editorInteractionPreferences={editorInteractionPreferences}
      fileIconTheme={fileIconTheme}
      markdownEnvironment={markdownEnvironment}
      documentNavigation={documentNavigation}
      refreshKey={refreshKey}
      treeNode={treeNode}
      viewerExtensionAdapter={viewerExtensionAdapter}
      workspaceId={workspaceId}
      workspaceRoot={workspaceRoot}
      markdownDialect={markdownDialect}
    />
  );
}, areEditorPaneDocumentRuntimePropsEqual);

type RegularEditorPaneDocumentRuntimeProps = EditorPaneDocumentRuntimeProps;

function RegularEditorPaneDocumentRuntime({
  aiEditFile,
  dataPort,
  editor,
  editorInteractionPreferences,
  fileIconTheme,
  markdownEnvironment,
  documentNavigation,
  refreshKey,
  treeNode,
  viewerExtensionAdapter = null,
  workspaceId,
  workspaceRoot,
  markdownDialect,
}: RegularEditorPaneDocumentRuntimeProps) {
  const { t } = useLocalization();
  const invalidTreeNode = Boolean(treeNode && !isDocumentDataNode(treeNode));
  const fallbackNode = useMemo(
    () => editor && !invalidTreeNode ? createFallbackNode(editor.resource, editor.label) : null,
    [editor, invalidTreeNode],
  );
  const sourceNode = isDocumentDataNode(treeNode) ? treeNode : fallbackNode;
  const source = useEditorPaneSource(sourceNode, dataPort, refreshKey);
  const node = useMemo(() => (
    source.content ? mergeNodeWithContent(sourceNode, source.content) : sourceNode
  ), [source.content, sourceNode]);
  const contextMapEnvironment = useMemo<ContextMapWorkspaceEnvironment>(() => ({
    revision: refreshKey?.sequence ?? 0,
    listChildren: dataPort.listChildren,
    readFile: dataPort.readFile,
  }), [dataPort.listChildren, dataPort.readFile, refreshKey?.sequence]);
  const hideSourceView = !isMarkdownDocumentDescriptor(
    node,
    editor?.resource ?? null,
  );

  // A directory discovered after an editor was restored is invalid workbench
  // state. Never route it through the unknown-file fallback viewer or reduce
  // the pane to an unexplained blank surface.
  if (invalidTreeNode) {
    return (
      <div className="editor-state editor-state--stacked" role="alert">
        <strong>{t("editor.unavailable.title")}</strong>
      </div>
    );
  }

  return (
    <FilePreview
      node={node}
      fileContent={source.content}
      fileUrl={source.fileUrl}
      fileUrlLoading={source.fileUrlLoading}
      fileUrlError={source.fileUrlError}
      loading={source.loading}
      loadingIndicator={(
        <PageLoading
          variant="fill"
          label={null}
          ariaLabel={t("editor.loadingFile")}
        />
      )}
      error={source.error}
      aiEditFile={aiEditFile}
      showHeader={false}
      hideSourceView={hideSourceView}
      fileIconTheme={fileIconTheme}
      editorInteractionPreferences={editorInteractionPreferences}
      editorSaveMode="auto"
      htmlTrustMode="safe"
      workspaceId={workspaceId}
      workspaceRoot={workspaceRoot}
      markdownDialect={markdownDialect ?? null}
      markdownEnvironment={markdownEnvironment}
      documentNavigation={documentNavigation}
      contextMapEnvironment={contextMapEnvironment}
      appPreview={dataPort.appPreview ?? null}
      openExternalFile={dataPort.openExternalFile}
      convertOfficeDocumentToDocx={dataPort.convertOfficeDocumentToDocx}
      viewerExtensionAdapter={viewerExtensionAdapter}
      documentSourceKind="local"
      documentPersistence={dataPort.documentPersistence ?? null}
      onDocumentPersisted={
        dataPort.documentPersistence && node ? source.applyPersistedCommit : undefined
      }
    />
  );
}

export function areEditorPaneDocumentRuntimePropsEqual(
  previous: EditorPaneDocumentRuntimeProps,
  next: EditorPaneDocumentRuntimeProps,
): boolean {
  return previous.aiEditFile === next.aiEditFile
    && previous.dataPort === next.dataPort
    && sameEditor(previous.editor, next.editor)
    && previous.editorInteractionPreferences.showSaveStatus
      === next.editorInteractionPreferences.showSaveStatus
    && previous.editorInteractionPreferences.markdownBlockDragEnabled
      === next.editorInteractionPreferences.markdownBlockDragEnabled
    && previous.fileIconTheme === next.fileIconTheme
    && samePaneEnvironment(
      previous.markdownEnvironment,
      next.markdownEnvironment,
      next.treeNode,
      next.editor?.resource ?? null,
    )
    && previous.documentNavigation === next.documentNavigation
    && sameDocumentRefresh(previous.refreshKey, next.refreshKey, next.editor?.resource ?? null)
    && sameDocumentDescriptor(previous.treeNode, next.treeNode)
    && previous.viewerExtensionAdapter === next.viewerExtensionAdapter
    && previous.workspaceId === next.workspaceId
    && previous.workspaceRoot === next.workspaceRoot
    && previous.markdownDialect === next.markdownDialect;
}

function samePaneEnvironment(
  previous: MarkdownWorkspaceEnvironment,
  next: MarkdownWorkspaceEnvironment,
  node: DataNode | null,
  resource: string | null,
): boolean {
  if (previous === next) return true;
  // Link and asset revisions are Markdown-only semantic inputs. Other
  // Viewers may use the stable navigation command port (for example Office
  // hyperlinks), but must not receive Markdown index broadcasts.
  if (!isMarkdownDocumentDescriptor(node, resource)) {
    return previous.linkCommands === next.linkCommands;
  }
  return (
    previous.linkGraph?.revision === next.linkGraph?.revision
    && previous.linkCommands === next.linkCommands
    && previous.assetResolverRevision === next.assetResolverRevision
  );
}

function isMarkdownDocumentDescriptor(node: DataNode | null, resource: string | null): boolean {
  return node?.type === "markdown"
    || hasMimeType(node, "text/markdown")
    || /\.(?:md|markdown|mdx)$/i.test(node?.path ?? resource ?? "");
}

function hasMimeType(node: DataNode | null, expected: string): boolean {
  return node?.mimeType?.split(";", 1)[0]?.trim().toLowerCase() === expected;
}

function sameDocumentRefresh(
  previous: WorkspaceContentChange | undefined,
  next: WorkspaceContentChange | undefined,
  resource: string | null,
): boolean {
  if (previous === next) return true;
  if (isContextMapDocumentDescriptor(null, resource)) {
    return previous?.sequence === next?.sequence;
  }
  return !workspaceContentChangeMatchesResource(
    next,
    resource,
    previous?.sequence ?? Number.NEGATIVE_INFINITY,
  );
}

function isContextMapDocumentDescriptor(node: DataNode | null, resource: string | null): boolean {
  return node?.type === "context-map"
    || node?.mimeType === "application/vnd.puppyone.context-map+json"
    || /\.contextmap$/i.test(node?.path ?? resource ?? "");
}

function sameEditor(
  previous: EditorPaneDocumentRuntimeProps["editor"],
  next: EditorPaneDocumentRuntimeProps["editor"],
): boolean {
  return previous === next || Boolean(
    previous
    && next
    && previous.id === next.id
    && previous.resource === next.resource
    && previous.label === next.label,
  );
}

/** Explorer tree containers may be rebuilt for an unrelated folder update.
 * A pane consumes only its flat document descriptor, so child-array identity
 * is intentionally excluded from the expensive runtime boundary. */
function sameDocumentDescriptor(previous: DataNode | null, next: DataNode | null): boolean {
  return previous === next || Boolean(
    previous
    && next
    && previous.id === next.id
    && previous.name === next.name
    && previous.path === next.path
    && previous.type === next.type
    && previous.mimeType === next.mimeType
    && previous.size === next.size
    && previous.modified === next.modified
    && previous.status === next.status
    && previous.preview === next.preview
    && previous.content === next.content
    && previous.hasChildren === next.hasChildren
    && previous.source === next.source,
  );
}

function createFallbackNode(path: string, label: string): DocumentDataNode {
  return {
    id: path,
    name: label,
    path,
    type: "file",
    source: "local",
  };
}

function mergeNodeWithContent(
  node: DocumentDataNode | null,
  content: FileContent,
): DocumentDataNode {
  return {
    ...(node ?? createFallbackNode(content.path, content.name)),
    name: content.name,
    path: content.path,
    type: content.type,
    mimeType: content.mimeType,
    size: content.size,
  };
}
