import { existsSync } from "node:fs";
import path from "node:path";
import { APP_IMAGE_RESOURCE_FILENAME, resolveDesktopAppIcon } from "../../shared/desktop/app-icon-contract.mjs";

export function resolveRuntimeAppImage({ isPackaged, resourcesPath, projectRoot, channel }) {
  const candidate = isPackaged
    ? path.join(resourcesPath, APP_IMAGE_RESOURCE_FILENAME)
    : path.join(projectRoot, resolveDesktopAppIcon(channel).source);
  return existsSync(candidate) ? candidate : null;
}

export function setDevelopmentDockIcon({ app, supportsDockIcon, iconPath, logger = console }) {
  // Installed apps use their bundle icon on every native surface. Electron's
  // unbundled development runner needs an explicit image to show our dev badge.
  if (app.isPackaged || !supportsDockIcon || !app.dock || !iconPath) return;
  try {
    app.dock.setIcon(iconPath);
  } catch (error) {
    logger.warn("Unable to set PuppyOne development Dock icon:", error);
  }
}
