import { TextEditorFrame } from "../shared/TextEditorFrame";
import { CodeMirrorCodeEditor } from "./CodeMirrorCodeEditor";
import type { PresetViewerRenderContext } from "../../registry/viewerTypes";

type CodeViewerProps = Pick<
  PresetViewerRenderContext,
  | "document"
  | "format"
  | "content"
  | "canEdit"
  | "hideSourceView"
>;

export function JsonViewer(context: CodeViewerProps) {
  const language = context.format.monacoLanguage ?? "json";
  return (
    <TextEditorFrame
      documentId={context.document.path}
      documentVersion={context.document.version}
      content={context.content}
      nodeName={context.document.name}
      defaultMode="source"
      canEdit={context.canEdit}
      hideSourceView={context.hideSourceView}
      sourceSnapshotMode
      renderLive={(value, controls) => (
        <CodeMirrorCodeEditor
          content={value}
          nodeName={context.document.name}
          language={language}
          readOnly={!controls.canEdit}
          onSourceRevisionChange={controls.onSourceRevisionChange}
          onSnapshotPortChange={controls.onSnapshotPortChange}
        />
      )}
      renderSource={(value, controls) => (
        <CodeMirrorCodeEditor
          content={value}
          nodeName={context.document.name}
          language={language}
          readOnly={!controls.canEdit}
          onSourceRevisionChange={controls.onSourceRevisionChange}
          onSnapshotPortChange={controls.onSnapshotPortChange}
        />
      )}
    />
  );
}

export function TextFileViewer(context: CodeViewerProps) {
  const language = context.format.monacoLanguage ?? null;
  return (
    <TextEditorFrame
      documentId={context.document.path}
      documentVersion={context.document.version}
      content={context.content}
      nodeName={context.document.name}
      defaultMode="source"
      canEdit={context.canEdit}
      hideSourceView={context.hideSourceView}
      sourceSnapshotMode
      renderLive={(value, controls) => (
        <CodeMirrorCodeEditor
          content={value}
          nodeName={context.document.name}
          language={language}
          readOnly={!controls.canEdit}
          onSourceRevisionChange={controls.onSourceRevisionChange}
          onSnapshotPortChange={controls.onSnapshotPortChange}
        />
      )}
      renderSource={(value, controls) => (
        <CodeMirrorCodeEditor
          content={value}
          nodeName={context.document.name}
          language={language}
          readOnly={!controls.canEdit}
          onSourceRevisionChange={controls.onSourceRevisionChange}
          onSnapshotPortChange={controls.onSnapshotPortChange}
        />
      )}
    />
  );
}
