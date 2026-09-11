import { HtmlViewer } from "./HtmlViewer";
import { definePresetViewer } from "../../registry/presetViewerContribution";

export const htmlViewerContribution = definePresetViewer({
  id: "html-artifact",
  providerPolicy: { profile: "editable-document", sourceToggle: false, semanticInputs: [], resourceDependencies: "document-directory" },
  allowPreviewContent: false,
  match: ({ document, format }) => document.type === "html" || format.defaultViewer === "html-artifact",
  isEditable: () => true,
  render: (context) => <HtmlViewer {...context} />,
});
