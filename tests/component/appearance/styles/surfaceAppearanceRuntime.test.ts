// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
  applySurfaceAppearanceToElement,
  resolveSurfaceAppearance,
} from "../../../../src/features/appearance/AppearanceRuntime";
import { resolveAppearance } from "../../../../src/features/appearance/resolveAppearance";
import {
  BUILTIN_FONT_IDS,
  DEFAULT_TYPOGRAPHY_PREFERENCES,
  resolveTypography,
  withTypographyFont,
  withTypographyScale,
} from "../../../../src/features/typography";
import { DEFAULT_MARKDOWN_PRESENTATION_SETTINGS } from "../../../../src/features/markdown/markdownPresentation";

describe("resolved surface appearance", () => {
  it("publishes one typed follow-theme boundary with provenance", () => {
    const surface = createSurface();

    expect(surface.markdownContentFont).toEqual({
      requestedValue: { mode: "follow-theme" },
      effectiveFontId: null,
      source: "theme",
    });
    expect(surface.rootProps).toMatchObject({
      "data-po-appearance-root": "true",
      "data-root-theme-id": "default",
      "data-sub-theme-id": "default.neutral",
      "data-font-editor-content-mode": "follow-theme",
      "data-loading-animation-preset": "ikun",
    });
    expect(surface.rootProps).not.toHaveProperty("data-font-editor-content");
    expect(surface.rootProps.style).not.toHaveProperty("--po-font-editor-content-user");
  });

  it("applies and clears explicit user overrides without leaving stale portal state", () => {
    const explicit = createSurface({
      typography: resolveTypography(withTypographyFont(
        DEFAULT_TYPOGRAPHY_PREFERENCES,
        "content",
        BUILTIN_FONT_IDS.systemSerif,
      )),
    });
    const followTheme = createSurface();
    const host = document.createElement("div");

    applySurfaceAppearanceToElement(host, explicit);
    expect(host.dataset.fontEditorContentMode).toBe("explicit");
    expect(host.dataset.fontEditorContent).toBe(BUILTIN_FONT_IDS.systemSerif);
    expect(host.style.getPropertyValue("--po-font-editor-content-user")).toContain("ui-serif");
    expect(explicit.markdownContentFont.source).toBe("user");

    applySurfaceAppearanceToElement(host, followTheme);
    expect(host.dataset.fontEditorContentMode).toBe("follow-theme");
    expect(host.dataset.fontEditorContent).toBeUndefined();
    expect(host.style.getPropertyValue("--po-font-editor-content-user")).toBe("");
  });

  it("propagates scaled control geometry to independently mounted hosts", () => {
    const host = document.createElement("div");
    const large = createSurface({
      typography: resolveTypography(withTypographyScale(
        DEFAULT_TYPOGRAPHY_PREFERENCES,
        "large",
      )),
    });
    const small = createSurface({
      typography: resolveTypography(withTypographyScale(
        DEFAULT_TYPOGRAPHY_PREFERENCES,
        "small",
      )),
    });

    applySurfaceAppearanceToElement(host, large);
    expect(host.dataset.typographyScale).toBe("large");
    expect(host.style.getPropertyValue("--po-control-size")).toBe("34px");

    applySurfaceAppearanceToElement(host, small);
    expect(host.dataset.typographyScale).toBe("small");
    expect(host.style.getPropertyValue("--po-control-size")).toBe("30px");
  });

  it("changes the revision for theme, typography scale, font, and Markdown presentation inputs", () => {
    const baseline = createSurface();
    const newspaper = createSurface({ subThemeId: "default.newspaper" });
    const large = createSurface({
      typography: resolveTypography(withTypographyScale(
        DEFAULT_TYPOGRAPHY_PREFERENCES,
        "large",
      )),
    });
    const explicit = createSurface({
      typography: resolveTypography(withTypographyFont(
        DEFAULT_TYPOGRAPHY_PREFERENCES,
        "content",
        BUILTIN_FONT_IDS.systemSans,
      )),
    });
    const presentation = createSurface({
      markdownPresentation: {
        ...DEFAULT_MARKDOWN_PRESENTATION_SETTINGS,
        headingScale: "large",
      },
    });
    const loading = createSurface({ loadingAnimationPreset: "ymca" });

    expect(new Set([
      baseline.revision,
      newspaper.revision,
      large.revision,
      explicit.revision,
      presentation.revision,
      loading.revision,
    ]).size).toBe(6);
  });
});

function createSurface(overrides: {
  subThemeId?: string;
  typography?: ReturnType<typeof resolveTypography>;
  markdownPresentation?: typeof DEFAULT_MARKDOWN_PRESENTATION_SETTINGS;
  loadingAnimationPreset?: "ikun" | "ymca" | "siu";
} = {}) {
  const appearance = resolveAppearance({
    interfaceStyle: "default",
    themeMode: "light",
    requestedSubThemeIds: {
      light: overrides.subThemeId ?? "default.neutral",
      dark: overrides.subThemeId ?? "default.neutral",
    },
    sidebarNavigationLayout: "bottom-horizontal",
    fileIconTheme: "default",
  });
  return resolveSurfaceAppearance({
    appearance,
    typography: overrides.typography ?? resolveTypography(DEFAULT_TYPOGRAPHY_PREFERENCES),
    markdownPresentation: overrides.markdownPresentation ?? DEFAULT_MARKDOWN_PRESENTATION_SETTINGS,
    loadingAnimationPreset: overrides.loadingAnimationPreset ?? "ikun",
    lightThemePreset: "neutral",
    darkThemePreset: "default",
    pointerCursors: false,
    diffMarkers: "color",
  });
}
