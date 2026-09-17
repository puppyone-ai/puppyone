import type { ExperimentalSettings } from "../../preferences";

export function isViewerPluginsEnabled({
  settings,
}: {
  settings: ExperimentalSettings;
}) {
  return settings.enableViewerPlugins;
}
