import { DEFAULT_SIDEBAR_NAVIGATION_LAYOUT, type InterfaceStyle } from "../../preferences";
import { getDefaultSubThemeId, readAppearancePreferences, readLegacyAppearanceSnapshot, resolveAppearance, type RootThemeAppearancePreferences } from "../appearance";
import { BUILTIN_SUB_THEMES, type SubThemeCatalogSnapshot } from "../themes";
import { applyPreferenceUpdate, type PreferenceSlice } from "./preferenceActions";
import type { AppearanceSlice } from "./preferenceTypes";
export const BUILTIN_SUB_THEME_CATALOG: SubThemeCatalogSnapshot = Object.freeze({
  subThemes: BUILTIN_SUB_THEMES, diagnostics: Object.freeze([]),
});
const defaults = readAppearancePreferences(null, readLegacyAppearanceSnapshot({ getItem: () => null })).preferences;

export const createAppearanceSlice: PreferenceSlice<AppearanceSlice> = (set) => ({
  interfaceStyle: defaults.activeRootThemeId,
  byRootTheme: defaults.byRootTheme,
  typographyPreferences: defaults.shared.typography,
  pointerCursors: defaults.shared.pointerCursors,
  showFileIcons: defaults.shared.showFileIcons,
  loadingPlaceholderStyle: defaults.shared.loadingPlaceholderStyle,
  fileIconTheme: defaults.shared.fileIconTheme,
  systemDark: false,
  subThemeCatalog: BUILTIN_SUB_THEME_CATALOG,
  appearanceWritable: true,
  setInterfaceStyle: (update) => set(s => ({ interfaceStyle: applyPreferenceUpdate(update, s.interfaceStyle) })),
  setTypographyPreferences: (update) => set(s => ({ typographyPreferences: applyPreferenceUpdate(update, s.typographyPreferences) })),
  setPointerCursors: (update) => set(s => ({ pointerCursors: applyPreferenceUpdate(update, s.pointerCursors) })),
  setShowFileIcons: (update) => set(s => ({ showFileIcons: applyPreferenceUpdate(update, s.showFileIcons) })),
  setLoadingPlaceholderStyle: (update) => set(s => ({ loadingPlaceholderStyle: applyPreferenceUpdate(update, s.loadingPlaceholderStyle) })),
  setFileIconTheme: (update) => set(s => ({ fileIconTheme: applyPreferenceUpdate(update, s.fileIconTheme) })),
  setThemeMode: (requestedColorMode) => set(s => ({
    byRootTheme: updateRootThemePreference(s.byRootTheme, s.interfaceStyle, { requestedColorMode }),
  })),
  setSubThemeId: (id) => set(s => ({
    byRootTheme: updateRootThemeSubTheme(s.byRootTheme, s.interfaceStyle, resolveDesktopAppearance(s).effectiveColorMode, id),
  })),
});
export function selectRootThemePreference(state: Pick<AppearanceSlice, "interfaceStyle" | "byRootTheme" | "systemDark" | "subThemeCatalog" | "fileIconTheme">) {
  return state.byRootTheme[state.interfaceStyle] ?? createDefaultRootThemePreference(state.interfaceStyle);
}
export function resolveDesktopAppearance(state: Pick<AppearanceSlice, "interfaceStyle" | "byRootTheme" | "systemDark" | "subThemeCatalog" | "fileIconTheme">) {
  const root = selectRootThemePreference(state);
  return resolveAppearance({
    interfaceStyle: state.interfaceStyle, themeMode: root.requestedColorMode,
    systemColorMode: state.systemDark ? "dark" : "light", requestedSubThemeIds: root.requestedSubThemeIds,
    subThemeCatalog: state.subThemeCatalog, sidebarNavigationLayout: DEFAULT_SIDEBAR_NAVIGATION_LAYOUT,
    fileIconTheme: state.fileIconTheme,
  });
}

function updateRootThemePreference(
  current: Readonly<Record<string, RootThemeAppearancePreferences>>,
  rootThemeId: InterfaceStyle,
  patch: Partial<RootThemeAppearancePreferences>,
): Readonly<Record<string, RootThemeAppearancePreferences>> {
  const existing = current[rootThemeId] ?? createDefaultRootThemePreference(rootThemeId);
  return Object.freeze({
    ...current,
    [rootThemeId]: Object.freeze({ ...existing, ...patch }),
  });
}

function updateRootThemeSubTheme(
  current: Readonly<Record<string, RootThemeAppearancePreferences>>,
  rootThemeId: InterfaceStyle,
  colorMode: "light" | "dark",
  subThemeId: string,
): Readonly<Record<string, RootThemeAppearancePreferences>> {
  const existing = current[rootThemeId] ?? createDefaultRootThemePreference(rootThemeId);
  return updateRootThemePreference(current, rootThemeId, {
    requestedSubThemeIds: Object.freeze({
      ...existing.requestedSubThemeIds,
      [colorMode]: subThemeId,
    }),
  });
}

function createDefaultRootThemePreference(
  rootThemeId: InterfaceStyle,
): RootThemeAppearancePreferences {
  return Object.freeze({
    requestedColorMode: rootThemeId === "windows-xp" ? "light" : "system",
    requestedSubThemeIds: Object.freeze({
      light: getDefaultSubThemeId(rootThemeId, "light"),
      dark: getDefaultSubThemeId(rootThemeId, "dark"),
    }),
  });
}

export function selectFileIconTheme(state: Parameters<typeof resolveDesktopAppearance>[0]) {
  return resolveDesktopAppearance(state).fileIconTheme;
}
