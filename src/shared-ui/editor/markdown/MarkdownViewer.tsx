"use client";

import { useCallback, useRef, useState } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { MarkdownCodeMirrorEditor } from "./MarkdownCodeMirrorEditor";
import { MarkdownOutlinePanel } from "./MarkdownOutlinePanel";
import { scrollMarkdownViewToHeading } from "./core/interaction/markdownHeadingOutline";
import type { MarkdownOutlineSnapshot } from "./core/interaction/markdownOutlineState";
import type { PresetViewerRenderContext } from "../registry/viewerTypes";
import { TextEditorFrame, type TextEditorControls } from "../viewers/shared/TextEditorFrame";
import type { EditorView } from "@codemirror/view";

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
  const { t } = useLocalization();
  const [outline, setOutline] = useState<MarkdownOutlineSnapshot | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  const handleViewReady = useCallback((view: EditorView | null) => {
    viewRef.current = view;
  }, []);

  const handleJump = useCallback((index: number) => {
    const view = viewRef.current;
    const heading = outline?.headings[index];
    if (!view || !heading) return;
    // Panel clicks move the reading position only; the editor keeps its caret.
    scrollMarkdownViewToHeading(view, heading);
  }, [outline]);

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
        && context.editorInteractionPreferences.markdownHeadingOutlineEnabled === true}
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
      onOutlineChange={setOutline}
      onViewReady={handleViewReady}
      onSourceRevisionChange={controls.onSourceRevisionChange}
      onSnapshotPortChange={controls.onSnapshotPortChange}
    />
  );

  return (
    <div className="markdown-viewer-shell">
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
      <MarkdownOutlinePanel
        snapshot={outline}
        onJump={handleJump}
        label={t("editor.markdown.outline")}
      />
    </div>
  );
}

export function canEditMarkdown() {
  return true;
}
