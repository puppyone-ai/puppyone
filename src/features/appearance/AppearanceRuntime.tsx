import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { EditorAppearanceProvider } from "@puppyone/shared-ui";
import type {
  DarkThemePreset,
  DiffMarkers,
  LightThemePreset,
  LoadingAnimationPreset,
} from "../../preferences";
import { LoadingAnimationProvider } from "../../components/loading";
import type { MarkdownPresentationSettings } from "../markdown/markdownPresentation";
import { serializeMarkdownPresentationSettings } from "../markdown/markdownPresentation";
import { SubThemeStyleHost } from "../themes/SubThemeStyleHost";
import {
  applyTypographyToElement,
  createTypographyRootProps,
  type ResolvedContentFontDecision,
  type ResolvedTypography,
  type TypographyRootProps,
} from "../typography";
import type { ResolvedAppearance } from "./resolveAppearance";

export type SurfaceAppearanceRootProps = TypographyRootProps & Readonly<{
  "data-po-appearance-root": "true";
  "data-root-theme-id": string;
  "data-sub-theme-id": string;
  "data-theme-mode": string;
  "data-interface-style": string;
  "data-interface-style-family": string;
  "data-interface-style-variant": string;
  "data-interface-style-palette": string;
  "data-appearance-token-set": string;
  "data-shell-composition": string;
  "data-titlebar-composition": string;
  "data-navigation-composition": string;
  "data-location-bar-composition": string;
  "data-scrollbar-composition": string;
  "data-icon-pack": string;
  "data-light-theme-preset": LightThemePreset;
  "data-dark-theme-preset": DarkThemePreset;
  "data-content-text-size": string;
  "data-loading-animation-preset": LoadingAnimationPreset;
  "data-pointer-cursors": "true" | "false";
  "data-diff-markers": DiffMarkers;
  style: TypographyRootProps["style"] & CSSProperties;
}>;

export type ResolvedSurfaceAppearance = Readonly<{
  revision: string;
  appearance: ResolvedAppearance;
  typography: ResolvedTypography;
  markdownPresentation: MarkdownPresentationSettings;
  markdownContentFont: ResolvedContentFontDecision;
  loadingAnimationPreset: LoadingAnimationPreset;
  rootProps: SurfaceAppearanceRootProps;
}>;

type ResolveSurfaceAppearanceInput = Readonly<{
  appearance: ResolvedAppearance;
  typography: ResolvedTypography;
  markdownPresentation: MarkdownPresentationSettings;
  loadingAnimationPreset: LoadingAnimationPreset;
  lightThemePreset: LightThemePreset;
  darkThemePreset: DarkThemePreset;
  pointerCursors: boolean;
  diffMarkers: DiffMarkers;
}>;

const SurfaceAppearanceContext = createContext<ResolvedSurfaceAppearance | null>(null);

export function resolveSurfaceAppearance({
  appearance,
  typography,
  markdownPresentation,
  loadingAnimationPreset,
  lightThemePreset,
  darkThemePreset,
  pointerCursors,
  diffMarkers,
}: ResolveSurfaceAppearanceInput): ResolvedSurfaceAppearance {
  const typographyRootProps = createTypographyRootProps(typography);
  const revision = createSurfaceAppearanceRevision({
    appearance,
    typography,
    markdownPresentation,
    loadingAnimationPreset,
    lightThemePreset,
    darkThemePreset,
    pointerCursors,
    diffMarkers,
  });
  const rootProps: SurfaceAppearanceRootProps = Object.freeze({
    "data-po-appearance-root": "true",
    "data-root-theme-id": appearance.rootThemeId,
    "data-sub-theme-id": appearance.subThemeId,
    "data-theme-mode": appearance.themeMode,
    "data-interface-style": appearance.interfaceStyle,
    "data-interface-style-family": appearance.profile.family,
    "data-interface-style-variant": appearance.profile.variant,
    "data-interface-style-palette": appearance.profile.palette,
    "data-appearance-token-set": appearance.tokenSet,
    "data-shell-composition": appearance.composition.shell,
    "data-titlebar-composition": appearance.composition.titlebar,
    "data-navigation-composition": appearance.composition.navigation,
    "data-location-bar-composition": appearance.composition.locationBar,
    "data-scrollbar-composition": appearance.composition.scrollbar,
    "data-icon-pack": appearance.composition.iconPack,
    "data-light-theme-preset": lightThemePreset,
    "data-dark-theme-preset": darkThemePreset,
    "data-content-text-size": appearance.textSize,
    "data-loading-animation-preset": loadingAnimationPreset,
    "data-pointer-cursors": pointerCursors ? "true" : "false",
    "data-diff-markers": diffMarkers,
    ...typographyRootProps,
    style: Object.freeze({ ...typographyRootProps.style }),
  });

  return Object.freeze({
    revision,
    appearance,
    typography,
    markdownPresentation,
    markdownContentFont: typography.editorContentDecision,
    loadingAnimationPreset,
    rootProps,
  });
}

export function SurfaceAppearanceProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: ResolvedSurfaceAppearance;
}) {
  return (
    <SurfaceAppearanceContext.Provider value={value}>
      <LoadingAnimationProvider preset={value.loadingAnimationPreset}>
        <EditorAppearanceProvider revision={value.revision}>
          <SubThemeStyleHost
            subTheme={value.appearance.subTheme}
            colorMode={value.appearance.effectiveColorMode}
            markdownPresentation={value.markdownPresentation}
          />
          {children}
        </EditorAppearanceProvider>
      </LoadingAnimationProvider>
    </SurfaceAppearanceContext.Provider>
  );
}

export function useSurfaceAppearance(): ResolvedSurfaceAppearance {
  const value = useContext(SurfaceAppearanceContext);
  if (!value) throw new Error("Surface appearance is unavailable outside SurfaceAppearanceProvider.");
  return value;
}

/** Applies the same resolved boundary to a portal or an independently mounted
 * host without letting that consumer reconstruct theme precedence. */
export function applySurfaceAppearanceToElement(
  element: HTMLElement,
  value: ResolvedSurfaceAppearance,
): void {
  element.classList.toggle("dark", value.appearance.effectiveColorMode === "dark");
  applyTypographyToElement(element, value.typography);
  for (const [name, rawValue] of Object.entries(value.rootProps)) {
    if (name === "style") continue;
    if (rawValue === undefined) element.removeAttribute(name);
    else element.setAttribute(name, String(rawValue));
  }
  for (const [name, rawValue] of Object.entries(value.rootProps.style)) {
    if (rawValue === undefined || rawValue === null) element.style.removeProperty(name);
    else element.style.setProperty(name, String(rawValue));
  }
}

function createSurfaceAppearanceRevision({
  appearance,
  typography,
  markdownPresentation,
  loadingAnimationPreset,
  lightThemePreset,
  darkThemePreset,
  pointerCursors,
  diffMarkers,
}: ResolveSurfaceAppearanceInput) {
  return [
    appearance.appearanceRevision,
    `size:${appearance.textSize}`,
    `content:${typography.editorContentDecision.source}:${typography.editorContentDecision.effectiveFontId ?? "follow-theme"}`,
    `code:${typography.code.id}:${typography.code.family}`,
    `terminal:${typography.terminal.id}:${typography.terminal.family}`,
    `markdown:${serializeMarkdownPresentationSettings(markdownPresentation)}`,
    `loading:${loadingAnimationPreset}`,
    `pointer:${pointerCursors ? "true" : "false"}`,
    `diff:${diffMarkers}`,
    `legacy-presets:${lightThemePreset}:${darkThemePreset}`,
  ].join("|");
}
