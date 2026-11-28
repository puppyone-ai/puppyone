"use client";

import { getMarkdownDocumentModel, MarkdownCodeMirrorEditor } from "./MarkdownCodeMirrorEditor";
import { CodeMirrorCodeEditor } from "../viewers/code/CodeMirrorCodeEditor";
import { useDocumentModelOwner } from "../document-session/DocumentModelOwner";
import type { PresetViewerRenderContext } from "../registry/viewerTypes";
import { TextEditorFrame } from "../viewers/shared/TextEditorFrame";

type MarkdownViewerProps = Pick<
  PresetViewerRenderContext,
  | "document"
  | "content"
  | "canEdit"
  | "hideSourceView"
  | "editorInteractionPreferences"
  | "aiEditFile"
  | "htmlTrustMode"
  | "workspaceId"
  | "workspaceRoot"
  | "markdownEnvironment"
> & Partial<Pick<PresetViewerRenderContext, "documentControls">>;

export function MarkdownViewer(context: MarkdownViewerProps) {
  return (
    <TextEditorFrame
      documentId={context.document.path}
      documentVersion={context.document.version}
      content={context.content}
      nodeName={context.document.name}
      defaultMode="live"
      canEdit={context.canEdit}
      hideSourceView={context.hideSourceView}
      documentControls={context.documentControls}
      enableModeToggleShortcut
      modeControlPlacement="pane-menu"
      sourceSnapshotMode
      renderLive={(value, controls) => (
        <MarkdownCodeMirrorEditor
          value={value}
          readOnly={!controls.canEdit}
          livePreview
          blockDragEnabled={context.editorInteractionPreferences.markdownBlockDragEnabled}
          headingOutlineEnabled={
            context.editorInteractionPreferences.markdownHeadingOutlineEnabled === true
          }
          aiEditFile={context.aiEditFile}
          htmlTrustMode={context.htmlTrustMode}
          documentPath={context.document.path}
          markdownDialect={context.document.markdownDialect}
          workspaceId={context.workspaceId}
          workspaceRoot={context.workspaceRoot}
          markdownLinkGraph={context.markdownEnvironment?.linkGraph}
          markdownLinkCommands={context.markdownEnvironment?.linkCommands}
          markdownAssetUrlResolver={context.markdownEnvironment?.assetUrlResolver}
          markdownAssetResolverRevision={context.markdownEnvironment?.assetResolverRevision}
          onSourceRevisionChange={controls.onSourceRevisionChange}
          onSnapshotPortChange={controls.onSnapshotPortChange}
        />
      )}
      renderSourcePanel={(value, canEdit) => (
        <MarkdownSourcePanel value={value} nodeName={context.document.name} readOnly={!canEdit} />
      )}
      renderSource={(value, controls) => (
        <MarkdownCodeMirrorEditor
          value={value}
          readOnly={!controls.canEdit}
          livePreview={false}
          aiEditFile={context.aiEditFile}
          htmlTrustMode={context.htmlTrustMode}
          documentPath={context.document.path}
          markdownDialect={context.document.markdownDialect}
          workspaceId={context.workspaceId}
          workspaceRoot={context.workspaceRoot}
          markdownLinkGraph={context.markdownEnvironment?.linkGraph}
          markdownLinkCommands={context.markdownEnvironment?.linkCommands}
          markdownAssetUrlResolver={context.markdownEnvironment?.assetUrlResolver}
          markdownAssetResolverRevision={context.markdownEnvironment?.assetResolverRevision}
          onSourceRevisionChange={controls.onSourceRevisionChange}
          onSnapshotPortChange={controls.onSnapshotPortChange}
        />
      )}
    />
  );
}

/**
 * The Markdown source beside the page. It follows the text the page's editor
 * holds, so either side's edits show in the other at once; without a document
 * owner there is no shared text, and the source only reads.
 */
function MarkdownSourcePanel({ value, nodeName, readOnly }: { value: string; nodeName: string; readOnly: boolean }) {
  const owner = useDocumentModelOwner();
  const model = owner ? getMarkdownDocumentModel(owner, value) : undefined;
  return <CodeMirrorCodeEditor model={model} follow={Boolean(model)} content={value} nodeName={nodeName}
    language="markdown" readOnly={readOnly || !model} lineWrapping />;
}

export function canEditMarkdown() {
  return true;
}
