import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { resolveDesktopAppearance, selectRootThemePreference } from "./appearanceSlice";
import { useDesktopPreference } from "../../preferencesStore";
export function useDesktopAppearance() {
  const inputs = useDesktopPreference(useShallow(s => ({
    interfaceStyle: s.interfaceStyle, byRootTheme: s.byRootTheme, systemDark: s.systemDark,
    subThemeCatalog: s.subThemeCatalog, fileIconTheme: s.fileIconTheme,
  })));
  return useMemo(() => {
    const root = selectRootThemePreference(inputs);
    const resolvedAppearance = resolveDesktopAppearance(inputs);
    const { subThemes } = inputs.subThemeCatalog;
    return {
      resolvedAppearance, resolvedTheme: resolvedAppearance.effectiveColorMode,
      activeThemeMode: resolvedAppearance.themeMode, themeMode: root.requestedColorMode,
      requestedSubThemeIds: root.requestedSubThemeIds,
      requestedSubThemeId: root.requestedSubThemeIds[resolvedAppearance.effectiveColorMode],
      lightThemePreset: subThemes.find(t => t.id === root.requestedSubThemeIds.light)?.legacyPresets?.light ?? "neutral",
      darkThemePreset: subThemes.find(t => t.id === root.requestedSubThemeIds.dark)?.legacyPresets?.dark ?? "default",
      fileIconTheme: resolvedAppearance.fileIconTheme,
    };
  }, [inputs]);
}
