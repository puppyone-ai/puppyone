import type { CSSProperties, ReactNode } from "react";
import { LoadingMark, type LoaderSize, type LoaderTone } from "@puppyone/shared-ui";

/**
 * Desktop page and inline loading layouts. The indicator itself is the shared
 * LoadingMark: a page or region loads with the area figure (gather), a line of
 * text with the inline figure (relay).
 */
const SIZE_TO_FONT: Record<LoaderSize, number> = {
  xs: 11,
  sm: 12,
  md: 13,
};

export function PageLoading({
  label = "Loading",
  ariaLabel,
  variant = "screen",
  size = "sm",
  tone = "neutral",
  className,
  style,
}: {
  label?: ReactNode | null;
  ariaLabel?: string;
  variant?: "screen" | "fill";
  size?: LoaderSize;
  tone?: LoaderTone;
  className?: string;
  style?: CSSProperties;
}) {
  const fontSize = SIZE_TO_FONT[size];
  const containerStyle: CSSProperties = {
    display: "flex",
    width: "100%",
    height: "100%",
    minHeight: variant === "screen" ? "100vh" : undefined,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    color: "var(--po-text-subtle)",
    background: variant === "screen" ? "var(--po-canvas)" : undefined,
    ...style,
  };

  return (
    <div className={className} style={containerStyle}>
      <LoadingMark
        layout="area"
        size={size}
        tone={tone}
        ariaLabel={ariaLabel || (typeof label === "string" ? label : "Loading")}
      />
      {label != null && <span style={{ fontSize, lineHeight: 1.4 }}>{label}</span>}
    </div>
  );
}

export function InlineLoading({
  label = "Loading",
  size = "xs",
  tone = "neutral",
  className,
  style,
  ariaLabel,
}: {
  label?: ReactNode | null;
  size?: LoaderSize;
  tone?: LoaderTone;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}) {
  return (
    <span
      className={className}
      role="status"
      aria-label={ariaLabel || (typeof label === "string" ? label : "Loading")}
      style={{ display: "inline-flex", alignItems: "center", gap: 7, ...style }}
    >
      <LoadingMark size={size} tone={tone} ariaHidden />
      {label != null && <span>{label}</span>}
    </span>
  );
}
