import { createElement } from "react";
import { definePresetViewer } from "../../registry/presetViewerContribution";
import { PdfViewer } from "./PdfViewer";

export const pdfViewerContribution = definePresetViewer({
  id: "pdf-preview",
  match: ({ document, format }) => document.type === "pdf" || format.defaultViewer === "pdf-preview",
  render: (context) => createElement(PdfViewer, context),
});
