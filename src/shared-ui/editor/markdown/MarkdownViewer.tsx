"use client";

import { MarkdownCodeMirrorEditor } from "./MarkdownCodeMirrorEditor";
import type { PresetViewerRenderContext } from "../registry/viewerTypes";
import { TextEditorFrame, type TextEditorControls } from "../viewers/shared/TextEditorFrame";

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
  const renderEditor = (
    value: string,
    controls: TextEditorControls,
    livePreview: boolean,
  ) => (
    <MarkdownCodeMirrorEditor
      value={value}
      readOnly={!controls.canEdit}
      livePreview={livePreview}
      blockDragEnabled={livePreview
        ? context.editorInteractionPreferences.markdownBlockDragEnabled
        : false}
      headingOutlineEnabled={livePreview
        && context.editorInteractionPreferences.markdownHeadingOutlineEnabled !== false}
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
  );

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
      renderLive={(value, controls) => renderEditor(value, controls, true)}
      renderSource={(value, controls) => renderEditor(value, controls, false)}
    />
  );
}

export function canEditMarkdown() {
  return true;
}
