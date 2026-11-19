/**
 * Native desktop window geometry contract.
 *
 * Renderer layout mirrors the minimum width through
 * `--desktop-window-min-width`; the architecture check keeps the two process
 * boundaries synchronized because CSS cannot import an Electron main module.
 */
export const DESKTOP_WINDOW_MIN_WIDTH = 720;
export const DESKTOP_WINDOW_MIN_HEIGHT = 520;

// The default renderer Header and native traffic-light lane share this height.
// Keep the CSS mirror checked so Header changes cannot leave native controls
// vertically misaligned. Interface profiles with custom controls own their lane.
export const DESKTOP_DEFAULT_CHROME_HEIGHT = 40;
export const MACOS_NATIVE_WINDOW_BUTTON_HEIGHT = 14;
export const MACOS_NATIVE_WINDOW_BUTTON_LEADING_INSET = 12;
