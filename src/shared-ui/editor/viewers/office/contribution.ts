import { definePresetViewer } from "../../registry/presetViewerContribution";

export const officeViewerContribution = definePresetViewer({
  id: "office-preview",
  match: ({ format }) => format.defaultViewer === "office-preview",
  load: () => import("./OfficeViewer").then(({ OfficeViewer }) => ({ default: OfficeViewer })),
});
