import { definePresetViewer } from "../../registry/presetViewerContribution";

export const databaseViewerContribution = definePresetViewer({
  id: "database-preview",
  match: ({ format }) => format.defaultViewer === "database-preview",
  load: () => import("./DatabaseViewer").then(({ DatabaseViewer }) => ({ default: DatabaseViewer })),
});
