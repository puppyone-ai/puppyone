export const WINDOWS_GRAYSCALE_TEXT_SWITCH = "disable-lcd-text";

/**
 * Keeps Chromium text on one antialiasing path throughout the Windows app.
 *
 * Chromium otherwise uses LCD subpixel rendering for opaque, stationary text
 * and grayscale rendering for text inside composited surfaces. PuppyOne mixes
 * both kinds of surfaces (native titlebar chrome, virtualized trees, editors),
 * so the same font metrics can acquire visibly different stroke weight while
 * scrolling or animating. Choosing grayscale once, before Electron is ready,
 * avoids per-component compositing hacks and keeps layout metrics unchanged.
 */
export function configureDesktopTextRasterization({
  commandLine,
  nodePlatform = process.platform,
} = {}) {
  if (nodePlatform !== "win32") {
    return { antialiasing: "platform-default", switch: null };
  }

  if (!commandLine || typeof commandLine.appendSwitch !== "function") {
    throw new TypeError("Electron commandLine is required for Windows text rasterization");
  }

  if (typeof commandLine.hasSwitch !== "function"
    || !commandLine.hasSwitch(WINDOWS_GRAYSCALE_TEXT_SWITCH)) {
    commandLine.appendSwitch(WINDOWS_GRAYSCALE_TEXT_SWITCH);
  }

  return {
    antialiasing: "grayscale",
    switch: WINDOWS_GRAYSCALE_TEXT_SWITCH,
  };
}
