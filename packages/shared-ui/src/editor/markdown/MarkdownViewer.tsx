"use client";

import { MarkdownCodeMirrorEditor } from "./MarkdownCodeMirrorEditor";
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
>;

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

export function canEditMarkdown() {
  return true;
}
