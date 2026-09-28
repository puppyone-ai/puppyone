export const DEFAULT_MACOS_WINDOW_BUTTON_POSITION = Object.freeze({ x: 15, y: 14 });

const DEFAULT_WINDOW_CHROME_PROFILE = Object.freeze({
  customControls: false,
  windowButtonPosition: DEFAULT_MACOS_WINDOW_BUTTON_POSITION,
});
const WINDOW_CHROME_PROFILES = new Map([
  ["default-titlebar-v1", DEFAULT_WINDOW_CHROME_PROFILE],
  [
    "windows-xp-luna-titlebar-v1",
    Object.freeze({
      customControls: true,
      windowButtonPosition: null,
    }),
  ],
]);
const activeWindowChromeProfiles = new WeakMap();

export function resolveWindowChromeProfile(titlebar) {
  return WINDOW_CHROME_PROFILES.get(titlebar) ?? DEFAULT_WINDOW_CHROME_PROFILE;
}

export function applyWindowChromeProfile(ownerWindow, titlebar) {
  const profile = resolveWindowChromeProfile(titlebar);
  activeWindowChromeProfiles.set(ownerWindow, profile);
  synchronizeWindowChromeProfile(ownerWindow, profile, { applying: true });
  return profile;
}

export function reapplyWindowChromeProfile(ownerWindow) {
  const profile = activeWindowChromeProfiles.get(ownerWindow);
  if (!profile) return null;
  synchronizeWindowChromeProfile(ownerWindow, profile, { applying: false });
  return profile;
}

function synchronizeWindowChromeProfile(ownerWindow, profile, { applying }) {
  if (applying || profile.customControls) {
    ownerWindow.setWindowButtonVisibility?.(!profile.customControls);
  }
  if (!profile.customControls && profile.windowButtonPosition) {
    // Native controls are already visible for the default profile. Reapplying
    // visibility on every focus can rebuild their titlebar safe area and move
    // renderer chrome; only their reviewed position needs to be restored.
    ownerWindow.setWindowButtonPosition?.({ ...profile.windowButtonPosition });
  }
}
