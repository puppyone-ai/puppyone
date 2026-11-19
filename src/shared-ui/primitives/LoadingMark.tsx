import type { CSSProperties, ReactNode } from "react";
import { useLocalization } from "@puppyone/localization/react";
import { OrderedDither } from "./OrderedDither";
import { useLoadingPlaceholderStyle, type LoadingPlaceholderStyle } from "./LoadingPlaceholder";
import type { OrderedDitherLight } from "./orderedDitherField";

export type LoaderSize = "xs" | "sm" | "md";
export type LoaderTone = "neutral" | "info" | "success" | "warning" | "danger";

/**
 * Where the mark sits, which decides its figure:
 * - `inline`: inside a strip (beside text, in a button, row, notice or tab).
 *   Rounded draws the relay: a capsule hands itself along three dots.
 * - `area`: alone in a region (a blank page, panel or canvas). Rounded draws
 *   the gather: three dots in a row meet in the middle and part again.
 */
export type LoadingMarkLayout = "inline" | "area";

/** Relay dots and the gaps between them. */
const RELAY_SIZE: Readonly<Record<LoaderSize, { unit: number; gap: number }>> = {
  xs: { unit: 3, gap: 2 },
  sm: { unit: 4, gap: 3 },
  md: { unit: 5, gap: 4 },
};

/** The gather's height; its dots and row width scale from it. */
const GATHER_BOX: Readonly<Record<LoaderSize, number>> = {
  xs: 12,
  sm: 16,
  md: 24,
};

/**
 * Dither blocks are a little larger than relay dots so each holds enough
 * lattice cells for the ordered pattern to read as texture rather than noise.
 */
const DITHER_SIZE: Readonly<Record<LoaderSize, { unit: number; gap: number }>> = {
  xs: { unit: 4, gap: 2 },
  sm: { unit: 5, gap: 2 },
  md: { unit: 6, gap: 3 },
};

const TONE_INK: Readonly<Record<LoaderTone, string>> = {
  neutral: "var(--po-text-muted)",
  info: "var(--po-info, var(--po-accent))",
  success: "var(--po-success)",
  warning: "var(--po-warning)",
  danger: "var(--po-danger)",
};

const UNITS = [0, 1, 2] as const;

/**
 * The dither mark's light: a narrow band that sweeps the three blocks on a
 * one-pixel lattice. It shares the placeholder's Bayer field and clock; only
 * the band is scaled down to the mark.
 */
export const LOADING_MARK_DITHER_LIGHT: Readonly<OrderedDitherLight> = Object.freeze({
  base: 0.2,
  peak: 0.85,
  halo: 0,
  haloInk: 0,
  width: 5,
  angle: 0,
  period: 1.2,
});

export interface LoadingMarkProps {
  size?: LoaderSize;
  tone?: LoaderTone;
  layout?: LoadingMarkLayout;
  /** Overrides the Appearance loading style, as the settings preview does. */
  loadingStyle?: LoadingPlaceholderStyle;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  ariaHidden?: boolean;
}

/**
 * The one loading indicator. It follows the Appearance loading style shared
 * with loading placeholders and draws the figure its layout calls for
 * (`LoadingMarkLayout`). The dither style draws three pixel blocks lit by a
 * sweeping ordered-dither light in either layout.
 */
export function LoadingMark({
  size = "sm",
  tone = "neutral",
  layout = "inline",
  loadingStyle,
  className,
  style,
  ariaLabel,
  ariaHidden = false,
}: LoadingMarkProps) {
  const { t } = useLocalization();
  const preferredStyle = useLoadingPlaceholderStyle();
  const resolvedStyle = loadingStyle ?? preferredStyle;
  const dither = resolvedStyle === "dither";
  const figure = loadingMarkFigure(resolvedStyle, layout);
  const geometry: Record<string, string> = figure === "gather"
    ? { "--po-loading-mark-box": `${GATHER_BOX[size]}px` }
    : {
      "--po-loading-mark-unit": `${(dither ? DITHER_SIZE : RELAY_SIZE)[size].unit}px`,
      "--po-loading-mark-gap": `${(dither ? DITHER_SIZE : RELAY_SIZE)[size].gap}px`,
    };
  return (
    <span
      {...(ariaHidden ? { "aria-hidden": true } : { role: "status", "aria-label": ariaLabel ?? t("shared-ui.loading") })}
      data-puppy-loader="mark"
      data-loading-style={resolvedStyle}
      data-loading-layout={layout}
      data-loading-figure={figure}
      className={`po-loading-mark${dither ? " po-placeholder-surface" : ""}${className ? ` ${className}` : ""}`}
      style={{ ...geometry, "--po-loading-mark-ink": TONE_INK[tone], ...style } as CSSProperties}
    >
      {UNITS.map((index) => (
        <span key={index} data-loading-mark-unit={index} {...(dither ? { "data-placeholder-shape": "" } : {})} />
      ))}
      {figure === "relay" && <span data-loading-mark-baton="" />}
      {dither && <OrderedDither light={LOADING_MARK_DITHER_LIGHT} />}
    </span>
  );
}

/** The figure a style draws in a layout: dither keeps its blocks in either layout. */
function loadingMarkFigure(style: LoadingPlaceholderStyle, layout: LoadingMarkLayout): "blocks" | "gather" | "relay" {
  if (style === "dither") return "blocks";
  return layout === "area" ? "gather" : "relay";
}

/** A loading mark followed by its label, for inline status text. */
export function InlineLoading({
  label,
  ariaLabel,
  size = "xs",
  tone = "neutral",
  className,
  style,
}: {
  label?: ReactNode | null;
  ariaLabel?: string;
  size?: LoaderSize;
  tone?: LoaderTone;
  className?: string;
  style?: CSSProperties;
}) {
  const { t } = useLocalization();
  const resolvedLabel = label === undefined ? t("shared-ui.loading") : label;
  const resolvedAriaLabel = ariaLabel
    ?? (typeof resolvedLabel === "string" ? resolvedLabel : t("shared-ui.loading"));
  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: 8, ...style }}>
      <LoadingMark size={size} tone={tone} ariaLabel={resolvedAriaLabel} />
      {resolvedLabel != null && <span>{resolvedLabel}</span>}
    </span>
  );
}
