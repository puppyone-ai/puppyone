import { definePresetViewer } from "../../registry/presetViewerContribution";

export const excalidrawViewerContribution = definePresetViewer({
  id: "excalidraw",
  providerPolicy: {
    profile: "editable-document",
    sourceToggle: true,
    semanticInputs: ["asset-resolver"],
    resourceDependencies: "document-directory",
  },
  match: ({ format }) => format.id === "excalidraw",
  isEditable: () => true,
  load: () => {
    // Configure fonts before evaluating the SDK, which registers them at module load.
    (window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = new URL("assets/excalidraw/", document.baseURI).href;
    return import("./ExcalidrawViewer").then(({ ExcalidrawViewer }) => ({ default: ExcalidrawViewer }));
  },
});
