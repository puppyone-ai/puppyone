import { useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { DarkThemePreset, DiffMarkers, LightThemePreset } from "../preferences";
import {
  applyTypographyToElement,
  type ResolvedTypography,
} from "../features/typography";
import {
  applySurfaceAppearanceToElement,
  type ResolvedSurfaceAppearance,
} from "../features/appearance/AppearanceRuntime";
import {
  useNativeSurfaceOcclusionObserver,
} from "../features/native-surfaces";

import { useDesktopOverlayRoot } from "./DesktopOverlayLayer";
export { DesktopOverlayLayer } from "./DesktopOverlayLayer";

export type DesktopOverlayTheme = "light" | "dark";

export type DesktopOverlayPortalProps = {
  children: ReactNode;
  theme?: DesktopOverlayTheme;
  subThemeId?: string;
  lightThemePreset?: LightThemePreset;
  darkThemePreset?: DarkThemePreset;
  typography?: ResolvedTypography;
  pointerCursors?: boolean;
  diffMarkers?: DiffMarkers;
  appearance?: ResolvedSurfaceAppearance;
};

export function DesktopOverlayPortal({
  children,
  theme,
  subThemeId,
  lightThemePreset,
  darkThemePreset,
  typography,
  pointerCursors,
  diffMarkers,
  appearance,
}: DesktopOverlayPortalProps) {
  useNativeSurfaceOcclusionObserver();
  const root = useDesktopOverlayRoot();

  useLayoutEffect(() => {
    if (!root) return;
    if (appearance) {
      applySurfaceAppearanceToElement(root, appearance);
      return;
    }
    if (!theme) return;
    applyDesktopOverlayTheme(root, {
      theme,
      subThemeId,
      lightThemePreset,
      darkThemePreset,
      typography,
      pointerCursors,
      diffMarkers,
    });
  }, [appearance, root, theme, subThemeId, lightThemePreset, darkThemePreset, typography, pointerCursors, diffMarkers]);

  if (!root) return null;
  return createPortal(children, root);
}

function applyDesktopOverlayTheme(root: HTMLElement, {
  theme,
  subThemeId,
  lightThemePreset,
  darkThemePreset,
  typography,
  pointerCursors,
  diffMarkers,
}: Readonly<{
  theme: DesktopOverlayTheme;
  subThemeId?: string;
  lightThemePreset?: LightThemePreset;
  darkThemePreset?: DarkThemePreset;
  typography?: ResolvedTypography;
  pointerCursors?: boolean;
  diffMarkers?: DiffMarkers;
}>) {
  root.className = `desktop-overlay-root ${theme === "dark" ? "dark" : ""}`.trim();
  root.dataset.themeMode = theme;
  root.dataset.poAppearanceRoot = "true";
  if (subThemeId) root.dataset.subThemeId = subThemeId;
  else delete root.dataset.subThemeId;
  if (lightThemePreset) root.dataset.lightThemePreset = lightThemePreset;
  if (darkThemePreset) root.dataset.darkThemePreset = darkThemePreset;
  if (typography) applyTypographyToElement(root, typography);
  if (pointerCursors !== undefined) root.dataset.pointerCursors = pointerCursors ? "true" : "false";
  if (diffMarkers) root.dataset.diffMarkers = diffMarkers;
}
