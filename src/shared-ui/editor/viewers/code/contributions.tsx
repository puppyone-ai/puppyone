import { JsonViewer, TextFileViewer } from "./CodeViewer";
import { definePresetViewer } from "../../registry/presetViewerContribution";
import { formatJson } from "../shared/viewerUtils";

export const jsonViewerContribution = definePresetViewer({
  id: "json",
  match: ({ document, format }) => (
    document.type === "json" || format.id === "json" || format.id === "jsonl"
  ),
  normalizeContent: formatJson,
  isEditable: () => true,
  render: (context) => <JsonViewer {...context} />,
});

export const textViewerContribution = definePresetViewer({
  id: "text",
  match: ({ document, format }) => (
    document.type === "code"
    || document.type === "text"
    || format.defaultViewer === "plain-text"
    || format.defaultViewer === "monaco-code"
  ),
  isEditable: () => true,
  render: (context) => <TextFileViewer {...context} />,
});
