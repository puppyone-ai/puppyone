import { CsvTableEditor } from "./CsvTableEditor";
import { CsvSourceEditor } from "./CsvSourceEditor";
import type { PresetViewerRenderContext } from "../../registry/viewerTypes";
import { TextEditorFrame } from "../shared/TextEditorFrame";
import { getDelimitedTableDelimiter } from "../shared/viewerUtils";

type CsvViewerProps = Pick<
  PresetViewerRenderContext,
  | "document"
  | "content"
  | "canEdit"
  | "hideSourceView"
  | "documentNavigation"
>;

export function CsvViewer(context: CsvViewerProps) {
  return (
    <TextEditorFrame
      documentId={context.document.path}
      documentVersion={context.document.version}
      content={context.content}
      nodeName={context.document.name}
      defaultMode="live"
      canEdit={context.canEdit}
      hideSourceView={context.hideSourceView}
      liveScrollOwner="viewer"
      sourceSnapshotMode
      renderLive={(value, controls) => (
        <CsvTableEditor
          documentId={context.document.path}
          content={value}
          nodeName={context.document.name}
          delimiter={getDelimitedTableDelimiter(context.document)}
          readOnly={!controls.canEdit}
          documentNavigation={context.documentNavigation}
          onSourceRevisionChange={controls.onSourceRevisionChange}
          onSnapshotPortChange={controls.onSnapshotPortChange}
        />
      )}
      renderSource={(value, controls) => (
        <CsvSourceEditor
          content={value}
          nodeName={context.document.name}
          readOnly={!controls.canEdit}
          onSourceRevisionChange={controls.onSourceRevisionChange}
          onSnapshotPortChange={controls.onSnapshotPortChange}
        />
      )}
    />
  );
}
