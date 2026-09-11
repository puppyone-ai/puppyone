export const APP_IMAGE_RESOURCE_FILENAME = "puppy-app-image.png";
export const MACOS_APP_ICON_FILENAME = "icon.icns";

const sourceByChannel = Object.freeze({
  dev: "assets/brand/puppy/puppy-app-image-dev.png",
  internal: "assets/brand/puppy/puppy-app-image.png",
  stable: "assets/brand/puppy/puppy-app-image.png",
});

export function resolveDesktopAppIcon(channel) {
  if (!Object.hasOwn(sourceByChannel, channel)) {
    throw new Error(`Unsupported app icon channel: ${channel}`);
  }
  return Object.freeze({
    source: sourceByChannel[channel],
    macos: `generated/app-icons/${channel}/${MACOS_APP_ICON_FILENAME}`,
  });
}
