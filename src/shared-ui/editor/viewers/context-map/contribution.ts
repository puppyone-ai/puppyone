import { definePresetViewer } from "../../registry/presetViewerContribution";

export const contextMapViewerContribution = definePresetViewer({
  id: "context-map",
  match: ({ format }) => format.id === "context-map",
  isEditable: () => true,
  load: () => import("./ContextMapViewer").then(({ ContextMapViewer }) => ({
    default: ContextMapViewer,
  })),
});
