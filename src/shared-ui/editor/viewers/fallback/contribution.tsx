import { useLocalization } from "@puppyone/localization/react";
import { DocumentPreview } from "./DocumentFallbackViewer";
import { definePresetViewer } from "../../registry/presetViewerContribution";
import type { PresetViewerImplementation } from "../../registry/viewerTypes";

export const fallbackViewerContribution = definePresetViewer({
  id: "document-placeholder",
  match: () => true,
  render: (context) => <FallbackDocumentPreview {...context} />,
});

function FallbackDocumentPreview({
  document,
}: Parameters<NonNullable<PresetViewerImplementation["render"]>>[0]) {
  const { t } = useLocalization();
  return <DocumentPreview document={document} label={t("editor.preview.binaryFile")} />;
}
