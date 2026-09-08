(() => {
  try {
    const manifest = window.__PUPPYONE_INTERFACE_STYLE_MANIFEST__;
    const themes = window.__PUPPYONE_SUB_THEME_BOOTSTRAP__;
    if (!manifest || !themes || !Array.isArray(manifest.styles)) return;
    const styles = new Map(manifest.styles.map((style) => [style.id, style]));
    const defaultStyle = styles.get(manifest.defaultStyle);
    if (!defaultStyle) return;

    const storedAppearance = readJson(
      window.localStorage.getItem(manifest.storage.appearancePreferences),
    );
    const storedInterfaceStyle = window.localStorage.getItem(manifest.storage.interfaceStyle);
    const hasCanonicalAppearance = storedAppearance?.schemaVersion === 5
      || storedAppearance?.schemaVersion === 4;
    const requestedStyleId = hasCanonicalAppearance
      ? storedAppearance.activeRootThemeId
      : storedInterfaceStyle;
    const style = styles.get(requestedStyleId) ?? defaultStyle;
    const rootPreferences = hasCanonicalAppearance
      ? storedAppearance.byRootTheme?.[style.id]
      : null;
    const storedTheme = rootPreferences?.requestedColorMode
      ?? window.localStorage.getItem(manifest.storage.themeMode);
    const palette = style.palette;
    const activeMode = palette.kind === "fixed"
      ? palette.mode
      : palette.modes.includes(storedTheme) ? storedTheme : palette.fallbackMode;
    const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    const resolvedTheme = activeMode === "system"
      ? systemDark ? "dark" : "light"
      : activeMode;

    const requestedSubThemeId = rootPreferences?.requestedSubThemeIds?.[resolvedTheme]
      ?? resolveLegacySubThemeId(manifest, themes, resolvedTheme)
      ?? style.subThemes.defaultSubThemeIds[resolvedTheme]
      ?? themes.fallbackSubThemeId;
    const firstPaint = themes.firstPaintById?.[requestedSubThemeId]?.[resolvedTheme]
      ?? style.firstPaint?.[resolvedTheme]
      ?? themes.fallbackFirstPaint[resolvedTheme];

    document.documentElement.dataset.interfaceStyle = style.id;
    document.documentElement.dataset.interfaceStyleFamily = style.profile?.family ?? style.id;
    document.documentElement.dataset.interfaceStyleVariant = style.profile?.variant ?? "product";
    document.documentElement.dataset.interfaceStylePalette = style.profile?.palette ?? "adaptive";
    document.documentElement.dataset.initialTheme = resolvedTheme;
    document.documentElement.dataset.initialSubThemeId = requestedSubThemeId;
    document.documentElement.style.setProperty("--initial-shell-background", firstPaint.background);
    document.documentElement.style.setProperty("--initial-shell-color-scheme", firstPaint.colorScheme);
    window.puppyoneDesktop?.setWindowBackground?.({
      background: firstPaint.background,
      themeSource: activeMode === "system" ? "system" : firstPaint.colorScheme,
    });
  } catch {
    // Keep the generated fallback first paint when storage or a theme is damaged.
  }
})();

function readJson(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function resolveLegacySubThemeId(manifest, themes, mode) {
  const storageKey = mode === "light"
    ? manifest.storage.lightThemePreset
    : manifest.storage.darkThemePreset;
  const legacyPreset = window.localStorage.getItem(storageKey)
    ?? (mode === "light" ? window.localStorage.getItem(manifest.storage.legacyThemePreset) : null);
  const ids = themes.legacyPresetSubThemeIds?.[mode];
  return legacyPreset && ids && Object.hasOwn(ids, legacyPreset)
    ? ids[legacyPreset]
    : null;
}
