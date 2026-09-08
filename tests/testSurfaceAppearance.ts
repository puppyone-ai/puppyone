import type { FileIconThemeId } from "@puppyone/shared-ui";
import {
  resolveSurfaceAppearance,
  type ResolvedSurfaceAppearance,
} from "../src/features/appearance/AppearanceRuntime";
import { resolveAppearance } from "../src/features/appearance/resolveAppearance";
import { DEFAULT_MARKDOWN_PRESENTATION_SETTINGS } from "../src/features/markdown/markdownPresentation";
import {
  DEFAULT_TYPOGRAPHY_PREFERENCES,
  resolveTypography,
  type ResolvedTypography,
} from "../src/features/typography";
import type {
  DiffMarkers,
  LoadingAnimationPreset,
  ThemeMode,
} from "../src/preferences";

export function createTestSurfaceAppearance(input: Readonly<{
  themeMode?: ThemeMode;
  subThemeId?: string;
  typography?: ResolvedTypography;
  loadingAnimationPreset?: LoadingAnimationPreset;
  pointerCursors?: boolean;
  diffMarkers?: DiffMarkers;
  fileIconTheme?: FileIconThemeId;
}> = {}): ResolvedSurfaceAppearance {
  const themeMode = input.themeMode ?? "dark";
  const subThemeId = input.subThemeId ?? "default.neutral";
  const appearance = resolveAppearance({
    interfaceStyle: "default",
    themeMode,
    systemColorMode: "dark",
    requestedSubThemeIds: { light: subThemeId, dark: subThemeId },
    sidebarNavigationLayout: "bottom-horizontal",
    fileIconTheme: input.fileIconTheme ?? "default",
  });
  return resolveSurfaceAppearance({
    appearance,
    typography: input.typography ?? resolveTypography(DEFAULT_TYPOGRAPHY_PREFERENCES),
    markdownPresentation: DEFAULT_MARKDOWN_PRESENTATION_SETTINGS,
    loadingAnimationPreset: input.loadingAnimationPreset ?? "ikun",
    lightThemePreset: "neutral",
    darkThemePreset: "default",
    pointerCursors: input.pointerCursors ?? false,
    diffMarkers: input.diffMarkers ?? "color",
  });
}
