import { parseDesktopCloudConfiguration } from "../../../electron/main/cloud-configuration.mjs";

export function cloudConfigurationPlugin() {
  let configuration;
  return {
    name: "puppyone-desktop-cloud-configuration",
    apply: "build",
    configResolved(config) { configuration = parseDesktopCloudConfiguration(config.env); },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "desktop-cloud.json", source: JSON.stringify(configuration) });
    },
  };
}
