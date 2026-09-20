import { parseFileIconThemeId } from "@puppyone/shared-ui";
import {
  DARK_THEME_PRESET_STORAGE_KEY,
  INTERFACE_STYLE_STORAGE_KEY,
  LEGACY_APPEARANCE_PREFERENCES_STORAGE_KEY,
  LEGACY_THEME_PRESET_STORAGE_KEY,
  LIGHT_THEME_PRESET_STORAGE_KEY,
  THEME_STORAGE_KEY,
  parseInterfaceStyle,
} from "./interfaceStyles";
import {
  DEFAULT_MARKDOWN_PRESENTATION_SETTINGS,
  parseMarkdownPresentationSettings,
} from "../markdown/markdownPresentation";
import {
  LEGACY_SURFACE_THEME_PREFERENCES_STORAGE_KEY,
  readLegacySurfaceSubThemeId,
} from "../themes/subThemePreferences";
import {
  FILE_ICON_THEME_STORAGE_KEY,
  LOADING_ANIMATION_STORAGE_KEY,
  MARKDOWN_EMPHASIS_STORAGE_KEY,
  MARKDOWN_PRESENTATION_STORAGE_KEY,
  POINTER_CURSORS_STORAGE_KEY,
  SIDEBAR_NAVIGATION_LAYOUT_STORAGE_KEY,
  TYPOGRAPHY_STORAGE_KEY,
  parseDarkThemePreset,
  parseLightThemePreset,
  parseLoadingAnimationPreset,
  parsePointerCursors,
  parseSidebarNavigationLayout,
  parseThemeMode,
  parseTypography,
} from "../../preferences";
import type { LegacyAppearanceSnapshot } from "./appearancePreferences";
import {
  LEGACY_TEXT_SIZE_STORAGE_KEY,
  parseLegacyTextSize,
} from "./legacyTextSizeMigration";

/**
 * One-way migration input for releases that predate the canonical Appearance
 * document. Runtime features must never read or write these keys directly.
 */
export function readLegacyAppearanceSnapshot(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): LegacyAppearanceSnapshot {
  const storedFileIconTheme = storage.getItem(FILE_ICON_THEME_STORAGE_KEY);
  return Object.freeze({
    activeStyle: parseInterfaceStyle(storage.getItem(INTERFACE_STYLE_STORAGE_KEY)),
    themeMode: parseThemeMode(storage.getItem(THEME_STORAGE_KEY)),
    lightThemePreset: parseLightThemePreset(
      storage.getItem(LIGHT_THEME_PRESET_STORAGE_KEY)
        ?? storage.getItem(LEGACY_THEME_PRESET_STORAGE_KEY),
    ),
    darkThemePreset: parseDarkThemePreset(storage.getItem(DARK_THEME_PRESET_STORAGE_KEY)),
    legacySubThemeId: readLegacySurfaceSubThemeId(
      storage.getItem(LEGACY_SURFACE_THEME_PREFERENCES_STORAGE_KEY),
    ),
    markdownPresentation: parseMarkdownPresentationSettings(
      storage.getItem(MARKDOWN_PRESENTATION_STORAGE_KEY)
        ?? storage.getItem(MARKDOWN_EMPHASIS_STORAGE_KEY),
    ) || DEFAULT_MARKDOWN_PRESENTATION_SETTINGS,
    legacyTextSize: parseLegacyTextSize(storage.getItem(LEGACY_TEXT_SIZE_STORAGE_KEY)),
    typography: parseTypography(storage.getItem(TYPOGRAPHY_STORAGE_KEY)),
    pointerCursors: parsePointerCursors(storage.getItem(POINTER_CURSORS_STORAGE_KEY)),
    loadingAnimationPreset: parseLoadingAnimationPreset(
      storage.getItem(LOADING_ANIMATION_STORAGE_KEY),
    ),
    fileIconTheme: parseFileIconThemeId(storedFileIconTheme) ?? "default",
    sidebarNavigationLayout: parseSidebarNavigationLayout(
      storage.getItem(SIDEBAR_NAVIGATION_LAYOUT_STORAGE_KEY),
    ),
  });
}

export function readLegacyAppearanceDocument(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): string | null {
  return storage.getItem(LEGACY_APPEARANCE_PREFERENCES_STORAGE_KEY);
}

export function removeLegacyAppearancePreferences(
  storage: Pick<Storage, "removeItem"> = window.localStorage,
): void {
  for (const key of LEGACY_APPEARANCE_STORAGE_KEYS) storage.removeItem(key);
}

export const LEGACY_APPEARANCE_STORAGE_KEYS = Object.freeze([
  LEGACY_APPEARANCE_PREFERENCES_STORAGE_KEY,
  INTERFACE_STYLE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  LIGHT_THEME_PRESET_STORAGE_KEY,
  DARK_THEME_PRESET_STORAGE_KEY,
  LEGACY_THEME_PRESET_STORAGE_KEY,
  LEGACY_SURFACE_THEME_PREFERENCES_STORAGE_KEY,
  LEGACY_TEXT_SIZE_STORAGE_KEY,
  TYPOGRAPHY_STORAGE_KEY,
  POINTER_CURSORS_STORAGE_KEY,
  LOADING_ANIMATION_STORAGE_KEY,
  MARKDOWN_PRESENTATION_STORAGE_KEY,
  MARKDOWN_EMPHASIS_STORAGE_KEY,
  FILE_ICON_THEME_STORAGE_KEY,
  SIDEBAR_NAVIGATION_LAYOUT_STORAGE_KEY,
] as const);
