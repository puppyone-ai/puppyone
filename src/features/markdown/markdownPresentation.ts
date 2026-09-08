import type { CSSProperties } from "react";

export type MarkdownHeadingScale = "theme" | "compact" | "default" | "large";
export type MarkdownStrongColor = "theme" | "default" | "accent" | "warm";
export type MarkdownStrongWeight = "theme" | "medium" | "semibold" | "bold" | "heavy";

export type MarkdownPresentationSettings = Readonly<{
  headingScale: MarkdownHeadingScale;
  strongColor: MarkdownStrongColor;
  strongWeight: MarkdownStrongWeight;
}>;

export const DEFAULT_MARKDOWN_PRESENTATION_SETTINGS: MarkdownPresentationSettings = {
  headingScale: "theme",
  strongColor: "theme",
  strongWeight: "theme",
};

export const MARKDOWN_HEADING_SCALE_OPTIONS = [
  { id: "theme" as const, labelKey: "settings.editor.markdownPresentation.theme.label" },
  { id: "compact" as const, labelKey: "settings.editor.markdownPresentation.scale.compact.label" },
  { id: "default" as const, labelKey: "settings.editor.markdownPresentation.scale.default.label" },
  { id: "large" as const, labelKey: "settings.editor.markdownPresentation.scale.large.label" },
] satisfies readonly { id: MarkdownHeadingScale; labelKey: string }[];

export const MARKDOWN_STRONG_COLOR_OPTIONS = [
  {
    id: "theme" as const,
    labelKey: "settings.editor.markdownPresentation.theme.label",
    descriptionKey: "settings.editor.markdownPresentation.theme.description",
  },
  {
    id: "default" as const,
    labelKey: "settings.editor.markdownPresentation.strongColor.default.label",
    descriptionKey: "settings.editor.markdownPresentation.strongColor.default.description",
  },
  {
    id: "accent" as const,
    labelKey: "settings.editor.markdownPresentation.strongColor.accent.label",
    descriptionKey: "settings.editor.markdownPresentation.strongColor.accent.description",
  },
  {
    id: "warm" as const,
    labelKey: "settings.editor.markdownPresentation.strongColor.warm.label",
    descriptionKey: "settings.editor.markdownPresentation.strongColor.warm.description",
  },
] satisfies readonly {
  id: MarkdownStrongColor;
  labelKey: string;
  descriptionKey: string;
}[];

export const MARKDOWN_STRONG_WEIGHT_OPTIONS = [
  { id: "theme" as const, labelKey: "settings.editor.markdownPresentation.theme.label" },
  { id: "medium" as const, labelKey: "settings.editor.markdownPresentation.strongWeight.medium.label" },
  { id: "semibold" as const, labelKey: "settings.editor.markdownPresentation.strongWeight.semibold.label" },
  { id: "bold" as const, labelKey: "settings.editor.markdownPresentation.strongWeight.bold.label" },
  { id: "heavy" as const, labelKey: "settings.editor.markdownPresentation.strongWeight.heavy.label" },
] satisfies readonly { id: MarkdownStrongWeight; labelKey: string }[];

const MARKDOWN_HEADING_SIZE: Record<
  Exclude<MarkdownHeadingScale, "theme">,
  Readonly<{ h1: string; h2: string; h3: string }>
> = {
  compact: { h1: "26px", h2: "20px", h3: "17px" },
  default: { h1: "30px", h2: "23px", h3: "19px" },
  large: { h1: "34px", h2: "26px", h3: "21px" },
};

const MARKDOWN_STRONG_WEIGHT: Record<Exclude<MarkdownStrongWeight, "theme">, string> = {
  medium: "550",
  semibold: "600",
  bold: "650",
  heavy: "700",
};

const MARKDOWN_STRONG_COLOR: Record<Exclude<MarkdownStrongColor, "theme">, string> = {
  default: "var(--po-text)",
  accent: "var(--po-accent)",
  warm: "color-mix(in srgb, #c45c26 78%, var(--po-text))",
};

export function isMarkdownHeadingScale(value: string | null | undefined): value is MarkdownHeadingScale {
  return value === "theme" || value === "compact" || value === "default" || value === "large";
}

export function isMarkdownStrongColor(value: string | null | undefined): value is MarkdownStrongColor {
  return value === "theme" || value === "default" || value === "accent" || value === "warm";
}

export function isMarkdownStrongWeight(value: string | null | undefined): value is MarkdownStrongWeight {
  return value === "theme" || value === "medium" || value === "semibold" || value === "bold" || value === "heavy";
}

export function parseMarkdownPresentationSettings(
  value: string | null | undefined,
): MarkdownPresentationSettings {
  if (!value) return DEFAULT_MARKDOWN_PRESENTATION_SETTINGS;

  if (isMarkdownStrongColor(value)) {
    return {
      ...DEFAULT_MARKDOWN_PRESENTATION_SETTINGS,
      strongColor: value === "default" ? "theme" : value,
    };
  }

  try {
    const parsed = JSON.parse(value) as (
      Partial<MarkdownPresentationSettings>
      & Partial<LegacyMarkdownPresentationSettings>
    ) | null;
    if (!parsed || typeof parsed !== "object") return DEFAULT_MARKDOWN_PRESENTATION_SETTINGS;
    if (parsed.version === 2) return parseVersionTwo(parsed);
    return migrateUnversionedSettings(parsed);
  } catch {
    return DEFAULT_MARKDOWN_PRESENTATION_SETTINGS;
  }
}

export function serializeMarkdownPresentationSettings(
  settings: MarkdownPresentationSettings,
): string {
  return JSON.stringify({ version: 2, ...settings });
}

export function resolveMarkdownPresentationStyle(
  settings: MarkdownPresentationSettings,
): CSSProperties {
  const style: CSSProperties = {};
  if (settings.headingScale !== "theme") {
    const headingSize = MARKDOWN_HEADING_SIZE[settings.headingScale];
    Object.assign(style, {
      "--po-md-h1-size": headingSize.h1,
      "--po-md-h2-size": headingSize.h2,
      "--po-md-h3-size": headingSize.h3,
    });
  }
  if (settings.strongWeight !== "theme") {
    Object.assign(style, {
      "--po-md-strong-weight": MARKDOWN_STRONG_WEIGHT[settings.strongWeight],
    });
  }
  if (settings.strongColor !== "theme") {
    Object.assign(style, {
      "--po-md-strong-color": MARKDOWN_STRONG_COLOR[settings.strongColor],
    });
  }
  return style;
}

type LegacyMarkdownPresentationSettings = Readonly<{
  version: number;
  h1Scale: Exclude<MarkdownHeadingScale, "theme">;
  h2Scale: Exclude<MarkdownHeadingScale, "theme">;
  h3Scale: Exclude<MarkdownHeadingScale, "theme">;
}>;

function parseVersionTwo(
  parsed: Partial<MarkdownPresentationSettings> & Partial<LegacyMarkdownPresentationSettings>,
): MarkdownPresentationSettings {
  return {
    headingScale: isMarkdownHeadingScale(parsed.headingScale)
      ? parsed.headingScale
      : DEFAULT_MARKDOWN_PRESENTATION_SETTINGS.headingScale,
    strongColor: isMarkdownStrongColor(parsed.strongColor)
      ? parsed.strongColor
      : DEFAULT_MARKDOWN_PRESENTATION_SETTINGS.strongColor,
    strongWeight: isMarkdownStrongWeight(parsed.strongWeight)
      ? parsed.strongWeight
      : DEFAULT_MARKDOWN_PRESENTATION_SETTINGS.strongWeight,
  };
}

function migrateUnversionedSettings(
  parsed: Partial<MarkdownPresentationSettings> & Partial<LegacyMarkdownPresentationSettings>,
): MarkdownPresentationSettings {
  const headingScale = isMarkdownHeadingScale(parsed.headingScale)
    ? parsed.headingScale
    : resolveLegacyHeadingScale(parsed);
  return {
    headingScale: headingScale === "default" ? "theme" : headingScale,
    strongColor: isMarkdownStrongColor(parsed.strongColor) && parsed.strongColor !== "default"
      ? parsed.strongColor
      : "theme",
    strongWeight: isMarkdownStrongWeight(parsed.strongWeight) && parsed.strongWeight !== "semibold"
      ? parsed.strongWeight
      : "theme",
  };
}

function resolveLegacyHeadingScale(
  settings: Partial<LegacyMarkdownPresentationSettings>,
): MarkdownHeadingScale {
  const legacyScales = [settings.h1Scale, settings.h2Scale, settings.h3Scale]
    .filter(isMarkdownHeadingScale);
  if (legacyScales.length === 0) return DEFAULT_MARKDOWN_PRESENTATION_SETTINGS.headingScale;

  const firstScale = legacyScales[0] ?? DEFAULT_MARKDOWN_PRESENTATION_SETTINGS.headingScale;
  return legacyScales.every((scale) => scale === firstScale)
    ? firstScale
    : DEFAULT_MARKDOWN_PRESENTATION_SETTINGS.headingScale;
}
