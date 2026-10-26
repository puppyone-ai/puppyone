import { useEffect, useLayoutEffect } from "react";
import { CREATE_NEW_MENU_STORAGE_KEY, DEFAULT_SIDEBAR_NAVIGATION_LAYOUT, LOCAL_AGENTS_STORAGE_KEY, parseCreateNewMenuSettings, parseLocalAgentsSettings } from "../../preferences";
import { APPEARANCE_PREFERENCES_STORAGE_KEY, getInterfaceStyleFirstPaint, readAppearancePreferences, supportsThemePreset } from "../appearance";
import type { SubThemeCatalogSnapshot } from "../themes";
import { BUILTIN_SUB_THEME_CATALOG, resolveDesktopAppearance, selectRootThemePreference } from "./appearanceSlice";
import { appearanceFields } from "./preferencesPersistence";
import { desktopPreferencesStore, useDesktopPreference } from "../../preferencesStore";
import { useDesktopAppearance } from "./useDesktopAppearance";

/** Mounted once per renderer; subscriptions belong to the window, not preference readers. */
export function useDesktopPreferenceEffects(catalog: SubThemeCatalogSnapshot = BUILTIN_SUB_THEME_CATALOG) {
  const interfaceStyle = useDesktopPreference(s => s.interfaceStyle);
  const indicators = useDesktopPreference(s => s.agentFileActivityIndicatorsEnabled);
  const { activeThemeMode, resolvedAppearance, resolvedTheme } = useDesktopAppearance();
  const activeThemePreset = resolvedAppearance.legacyThemePreset;
  useLayoutEffect(() => { desktopPreferencesStore.setState({ subThemeCatalog: catalog }); }, [catalog]);
  useLayoutEffect(() => {
    document.documentElement.dataset.agentFileActivity = indicators ? "visible" : "hidden";
  }, [indicators]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const firstPaint = getInterfaceStyleFirstPaint(
      interfaceStyle,
      resolvedTheme,
      resolvedAppearance.subTheme,
    );
    root.dataset.interfaceStyle = interfaceStyle;
    root.dataset.interfaceStyleFamily = resolvedAppearance.profile.family;
    root.dataset.interfaceStyleVariant = resolvedAppearance.profile.variant;
    root.dataset.interfaceStylePalette = resolvedAppearance.profile.palette;
    root.dataset.appearanceTokenSet = resolvedAppearance.tokenSet;
    root.dataset.shellComposition = resolvedAppearance.composition.shell;
    root.dataset.titlebarComposition = resolvedAppearance.composition.titlebar;
    root.dataset.navigationComposition = resolvedAppearance.composition.navigation;
    root.dataset.locationBarComposition = resolvedAppearance.composition.locationBar;
    root.dataset.scrollbarComposition = resolvedAppearance.composition.scrollbar;
    root.dataset.iconPack = resolvedAppearance.composition.iconPack;
    root.dataset.initialTheme = resolvedTheme;
    if (supportsThemePreset(interfaceStyle, resolvedTheme)) {
      root.dataset.initialThemePreset = activeThemePreset;
    } else {
      delete root.dataset.initialThemePreset;
    }
    root.style.setProperty("--initial-shell-background", firstPaint.background);
    root.style.setProperty("--initial-shell-color-scheme", firstPaint.colorScheme);
    const titlebar = document.querySelector<HTMLElement>(".desktop-titlebar");
    const titlebarBackground = titlebar
      ? window.getComputedStyle(titlebar).backgroundColor
      : undefined;
    window.puppyoneDesktop?.setWindowBackground?.({
      background: firstPaint.background,
      titlebarBackground,
      themeSource: activeThemeMode === "system" ? "system" : firstPaint.colorScheme,
    });
    void window.puppyoneDesktop?.setWindowChromeProfile?.({
      titlebar: resolvedAppearance.composition.titlebar,
    }).catch(() => undefined);
  }, [
    activeThemeMode,
    activeThemePreset,
    interfaceStyle,
    resolvedAppearance,
    resolvedTheme,
  ]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => desktopPreferencesStore.setState({ systemDark: query.matches });
    sync();
    query.addEventListener("change", sync);
    window.addEventListener("storage", syncPreferenceStorageEvent);
    const stopGit = subscribeGitAutoCommitPreference();
    return () => {
      query.removeEventListener("change", sync);
      window.removeEventListener("storage", syncPreferenceStorageEvent);
      stopGit();
    };
  }, []);
}
function subscribeGitAutoCommitPreference() {
  const desktop = window.puppyoneDesktop;
  if (!desktop?.getGitAutoCommitSettings) return () => {};
  let active = true;
  const apply = (snapshot: { experimentalOptIn: boolean }) => {
    if (!active) return;
    desktopPreferencesStore.setState(s => ({ experimentalSettings: {
      ...s.experimentalSettings, enableGitAutoCommit: snapshot.experimentalOptIn === true,
    } }));
  };
  void desktop.getGitAutoCommitSettings().then(apply).catch(() => undefined);
  const stop = desktop.onGitAutoCommitStateChanged?.(apply);
  return () => { active = false; stop?.(); };
}
function syncPreferenceStorageEvent(event: StorageEvent) {
  if (event.key === CREATE_NEW_MENU_STORAGE_KEY || event.key === null) {
    desktopPreferencesStore.getState().setCreateNewMenuSettings(parseCreateNewMenuSettings(event.key === null ? null : event.newValue));
  }
  if (event.key === LOCAL_AGENTS_STORAGE_KEY || event.key === null) {
    desktopPreferencesStore.getState().setLocalAgentsSettings(parseLocalAgentsSettings(event.key === null ? null : event.newValue));
  }
  if (event.key !== APPEARANCE_PREFERENCES_STORAGE_KEY || !event.newValue) return;
  const s = desktopPreferencesStore.getState();
  const root = selectRootThemePreference(s);
  const resolved = resolveDesktopAppearance(s);
  const light = s.subThemeCatalog.subThemes.find(t => t.id === root.requestedSubThemeIds.light);
  const dark = s.subThemeCatalog.subThemes.find(t => t.id === root.requestedSubThemeIds.dark);
  const result = readAppearancePreferences(event.newValue, {
    activeStyle: s.interfaceStyle, themeMode: root.requestedColorMode,
    lightThemePreset: light?.legacyPresets?.light ?? "neutral", darkThemePreset: dark?.legacyPresets?.dark ?? "default",
    legacySubThemeId: root.requestedSubThemeIds[resolved.effectiveColorMode], markdownPresentation: s.markdownPresentation,
    legacyTextSize: "default", typography: s.typographyPreferences, pointerCursors: s.pointerCursors,
    loadingAnimationPreset: s.loadingAnimationPreset, fileIconTheme: s.fileIconTheme,
    sidebarNavigationLayout: DEFAULT_SIDEBAR_NAVIGATION_LAYOUT,
  });
  if (result.source !== "future") desktopPreferencesStore.setState(appearanceFields(result.preferences));
}
