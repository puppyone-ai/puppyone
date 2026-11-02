import { CsvViewer } from "./CsvViewer";
import { definePresetViewer } from "../../registry/presetViewerContribution";

export const csvTableViewerContribution = definePresetViewer({
  id: "csv-table",
  match: ({ format }) => format.defaultViewer === "csv-table",
  isEditable: () => true,
  render: (context) => <CsvViewer {...context} />,
});
