import type { CSSProperties, ReactNode } from "react";

type LoaderSize = "xs" | "sm";
type LoaderTone = "neutral" | "info" | "success" | "danger";

const PULSE_GRID_SIZE: Record<LoaderSize, { cell: number; gap: number }> = {
  xs: { cell: 2, gap: 2 },
  sm: { cell: 3, gap: 2 },
};

const DOTS_SIZE: Record<LoaderSize, { dot: number; gap: number }> = {
  xs: { dot: 3, gap: 3 },
  sm: { dot: 4, gap: 4 },
};

const SIZE_TO_FONT: Record<LoaderSize, number> = {
  xs: 11,
  sm: 12,
};

const TONE_MAP: Record<LoaderTone, { active: string }> = {
  neutral: { active: "var(--po-text-subtle)" },
  info: { active: "var(--po-accent)" },
  success: { active: "var(--po-success)" },
  danger: { active: "var(--po-danger)" },
};

export function PulseGrid({
  size = "sm",
  tone = "neutral",
  className,
  style,
  ariaLabel = "Loading",
}: {
  size?: LoaderSize;
  tone?: LoaderTone;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}) {
  const { cell, gap } = PULSE_GRID_SIZE[size];
  const { active } = TONE_MAP[tone];

  return (
    <span
      role="status"
      aria-label={ariaLabel}
      data-puppy-loader="pulse-grid"
      className={className}
      style={{
        display: "inline-grid",
        gridTemplateColumns: `repeat(3, ${cell}px)`,
        gridAutoRows: `${cell}px`,
        gap,
        ...style,
      }}
    >
      {Array.from({ length: 9 }).map((_, index) => (
        <span
          key={index}
          style={{
            width: cell,
            height: cell,
            borderRadius: Math.max(1, cell / 2),
            background: active,
            animation: `puppy-pulse-grid 1.2s ease-in-out ${(index % 3) * 0.08 + Math.floor(index / 3) * 0.08}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

export function Dots({
  size = "sm",
  tone = "neutral",
  className,
  style,
  ariaLabel = "Loading",
}: {
  size?: LoaderSize;
  tone?: LoaderTone;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}) {
  const { dot, gap } = DOTS_SIZE[size];
  const { active } = TONE_MAP[tone];

  return (
    <span
      role="status"
      aria-label={ariaLabel}
      data-puppy-loader="dots"
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap, verticalAlign: "middle", ...style }}
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          style={{
            width: dot,
            height: dot,
            borderRadius: "50%",
            background: active,
            animation: `puppy-dot-bounce 1.2s ease-in-out ${index * 0.16}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

export function PageLoading({
  label = "Loading",
  variant = "screen",
  size = "sm",
  tone = "neutral",
  className,
  style,
}: {
  label?: ReactNode | null;
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
      <PulseGrid size={size} tone={tone} />
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
}: {
  label?: ReactNode | null;
  size?: LoaderSize;
  tone?: LoaderTone;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: 7, ...style }}>
      <Dots size={size} tone={tone} />
      {label != null && <span>{label}</span>}
    </span>
  );
}
