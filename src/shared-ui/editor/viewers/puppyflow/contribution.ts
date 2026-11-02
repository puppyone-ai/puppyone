import { definePresetViewer } from "../../registry/presetViewerContribution";

export const puppyFlowViewerContribution = definePresetViewer({
  id: "puppyflow",
  match: ({ format }) => format.id === "puppyflow",
  isEditable: () => true,
  load: () => import("./PuppyFlowViewer").then(({ PuppyFlowViewer }) => ({ default: PuppyFlowViewer })),
});
