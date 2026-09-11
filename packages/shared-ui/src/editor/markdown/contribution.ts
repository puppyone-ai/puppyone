import { definePresetViewer } from "../registry/presetViewerContribution";

export const markdownViewerContribution = definePresetViewer({
  id: "markdown",
  providerPolicy: { profile: "editable-document", sourceToggle: true, semanticInputs: ["link-graph", "asset-resolver"] },
  match: ({ document, format }) => (
    document.type === "markdown" || format.defaultViewer === "markdown-editor"
  ),
  isEditable: () => true,
  load: () => import("./MarkdownViewer").then(({ MarkdownViewer }) => ({ default: MarkdownViewer })),
});
