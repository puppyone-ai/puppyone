import type { PresetViewerRuntimeHostAdapter } from "@puppyone/shared-ui";
import { BuiltInEditorSurfaceController } from "./BuiltInEditorSurfaceController";

export const desktopPresetViewerRuntimeHost: PresetViewerRuntimeHostAdapter = Object.freeze({
  renderIsolatedSurface: ({ viewer, context }) => (
    <BuiltInEditorSurfaceController viewer={viewer} context={context} />
  ),
});
