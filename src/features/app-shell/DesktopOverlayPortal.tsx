import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { DarkThemePreset, DiffMarkers, LightThemePreset } from "../../preferences";
import {
  applyTypographyToElement,
  type ResolvedTypography,
} from "../typography";
import {
  applySurfaceAppearanceToElement,
  type ResolvedSurfaceAppearance,
} from "../appearance/AppearanceRuntime";
import {
  useNativeSurfaceOcclusionLease,
  useNativeSurfaceOcclusionObserver,
} from "../native-surfaces";

const DESKTOP_OVERLAY_ROOT_ID = "desktop-overlay-root";

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
    applyDesktopOverlayTheme(
      root,
      theme,
      subThemeId,
      lightThemePreset,
      darkThemePreset,
      typography,
      pointerCursors,
      diffMarkers,
    );
  }, [appearance, root, theme, subThemeId, lightThemePreset, darkThemePreset, typography, pointerCursors, diffMarkers]);

  if (!root) return null;
  return createPortal(children, root);
}

/** Portals feature-owned menus and dialogs into the shared, themed desktop overlay root. */
export function DesktopOverlayLayer({ children }: { children: ReactNode }) {
  useNativeSurfaceOcclusionLease();
  const root = useDesktopOverlayRoot();
  if (!root) return null;
  return createPortal(children, root);
}

function useDesktopOverlayRoot() {
  const [root, setRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setRoot(getDesktopOverlayRoot());
  }, []);

  return root;
}

function getDesktopOverlayRoot() {
  const existing = document.getElementById(DESKTOP_OVERLAY_ROOT_ID);
  if (existing instanceof HTMLElement) {
    existing.dataset.poOverlayRoot = "true";
    return existing;
  }

  const root = document.createElement("div");
  root.id = DESKTOP_OVERLAY_ROOT_ID;
  root.className = "desktop-overlay-root";
  root.dataset.poOverlayRoot = "true";
  document.body.appendChild(root);
  return root;
}

function applyDesktopOverlayTheme(
  root: HTMLElement,
  theme: DesktopOverlayTheme,
  subThemeId?: string,
  lightThemePreset?: LightThemePreset,
  darkThemePreset?: DarkThemePreset,
  typography?: ResolvedTypography,
  pointerCursors?: boolean,
  diffMarkers?: DiffMarkers,
) {
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
