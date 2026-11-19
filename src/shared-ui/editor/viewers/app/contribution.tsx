import { AppPreviewViewer } from "./AppPreviewViewer";
import { definePresetViewer } from "../../registry/presetViewerContribution";

export const appPreviewViewerContribution = definePresetViewer({
  id: "app-preview",
  match: ({ document, format }) => document.type === "app" || format.defaultViewer === "app-preview",
  render: (context) => <AppPreviewViewer {...context} />,
});
