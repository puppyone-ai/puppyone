import type { CSSProperties, ReactNode } from "react";
import { useLocalization } from "@puppyone/localization/react";
import {
  DEFAULT_PULSE_GRID_FRAME_DURATION_MS,
  PULSE_GRID_DEFAULT_FRAMES,
  getPulseGridPointAppearance,
  usePulseGridPlayback,
  type PulseGridFrames,
  type PulseGridPoint,
} from "./pulseGridSequence";

export type LoaderSize = "xs" | "sm";
export type LoaderTone = "neutral" | "info" | "success" | "warning" | "danger";

const PULSE_GRID_SIZE: Record<LoaderSize, { dot: number; gap: number; radius: number }> = {
  xs: { dot: 2, gap: 1.5, radius: 0 },
  sm: { dot: 3, gap: 2, radius: 0 },
};

const DOTS_SIZE: Record<LoaderSize, { dot: number; gap: number }> = {
  xs: { dot: 3, gap: 3 },
  sm: { dot: 4, gap: 4 },
};

const TONE_MAP: Record<LoaderTone, { active: string }> = {
  neutral: { active: "var(--po-text-muted)" },
  info: { active: "var(--po-info, var(--po-accent))" },
  success: { active: "var(--po-success)" },
  warning: { active: "var(--po-warning)" },
  danger: { active: "var(--po-danger)" },
};

const DOT_BOUNCE_DURATION_S = 1.2;
const DOT_BOUNCE_STAGGER_S = 0.16;
const PULSE_GRID_TRANSITION_MS = 70;
const PULSE_GRID_POINT_COUNT = 9;
const PULSE_GRID_IDLE_OPACITY = 0.18;

export function PulseGridLoader({
  size = "sm",
  tone = "neutral",
  className,
  style,
  ariaLabel,
  ariaHidden = false,
  frames = PULSE_GRID_DEFAULT_FRAMES,
  frameDurationMs = DEFAULT_PULSE_GRID_FRAME_DURATION_MS,
}: {
  size?: LoaderSize;
  tone?: LoaderTone;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  ariaHidden?: boolean;
  frames?: PulseGridFrames;
  frameDurationMs?: number;
}) {
  const { t } = useLocalization();
  const { dot, gap, radius } = PULSE_GRID_SIZE[size];
  const { active } = TONE_MAP[tone];
  const resolvedAriaLabel = ariaLabel ?? t("shared-ui.loading");
  const playback = usePulseGridPlayback(frames, frameDurationMs);

  return (
    <span
      {...(ariaHidden ? { "aria-hidden": true } : { role: "status", "aria-label": resolvedAriaLabel })}
      data-puppy-loader="pulse-grid"
      data-pulse-grid-frame={playback.frameIndex}
      className={className}
      style={{
        display: "inline-grid",
        gridTemplateColumns: `repeat(3, ${dot}px)`,
        gridTemplateRows: `repeat(3, ${dot}px)`,
        gap,
        ...style,
      }}
    >
      {Array.from({ length: PULSE_GRID_POINT_COUNT }, (_, index) => {
        const point = index as PulseGridPoint;
        const appearance = getPulseGridPointAppearance(playback.frame, point);
        const isActive = appearance.brightness > 0;
        return (
          <span
            key={point}
            data-pulse-grid-point={point}
            data-active={isActive ? "true" : "false"}
            data-level={appearance.brightness === 1 ? "bright" : isActive ? "medium" : "dark"}
            style={{
              width: dot,
              height: dot,
              borderRadius: radius,
              background: active,
              opacity: isActive ? appearance.brightness : PULSE_GRID_IDLE_OPACITY,
              transition: `opacity ${PULSE_GRID_TRANSITION_MS}ms ease-out`,
            }}
          />
        );
      })}
    </span>
  );
}

export function DotsLoader({
  size = "sm",
  tone = "neutral",
  className,
  style,
  ariaLabel,
  ariaHidden = false,
}: {
  size?: LoaderSize;
  tone?: LoaderTone;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  ariaHidden?: boolean;
}) {
  const { t } = useLocalization();
  const { dot, gap } = DOTS_SIZE[size];
  const { active } = TONE_MAP[tone];
  const resolvedAriaLabel = ariaLabel ?? t("shared-ui.loading");

  return (
    <span
      {...(ariaHidden ? { "aria-hidden": true } : { role: "status", "aria-label": resolvedAriaLabel })}
      data-puppy-loader="dots"
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap,
        verticalAlign: "middle",
        ...style,
      }}
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          style={{
            display: "block",
            width: dot,
            height: dot,
            minWidth: dot,
            minHeight: dot,
            aspectRatio: "1 / 1",
            borderRadius: "50%",
            background: active,
            animation: `puppy-dot-bounce ${DOT_BOUNCE_DURATION_S}s ease-in-out ${index * DOT_BOUNCE_STAGGER_S}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

export function InlineLoading({
  label,
  ariaLabel,
  size = "xs",
  tone = "neutral",
  indicator = "pulse-grid",
  frames,
  frameDurationMs,
  className,
  style,
}: {
  label?: ReactNode | null;
  ariaLabel?: string;
  size?: LoaderSize;
  tone?: LoaderTone;
  indicator?: "pulse-grid" | "dots";
  frames?: PulseGridFrames;
  frameDurationMs?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const { t } = useLocalization();
  const resolvedLabel = label === undefined ? t("shared-ui.loading") : label;
  const resolvedAriaLabel = ariaLabel
    ?? (typeof resolvedLabel === "string" ? resolvedLabel : t("shared-ui.loading"));

  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: 8, ...style }}>
      {indicator === "dots" ? (
        <DotsLoader size={size} tone={tone} ariaLabel={resolvedAriaLabel} />
      ) : (
        <PulseGridLoader
          size={size}
          tone={tone}
          ariaLabel={resolvedAriaLabel}
          frames={frames}
          frameDurationMs={frameDurationMs}
        />
      )}
      {resolvedLabel != null && <span>{resolvedLabel}</span>}
    </span>
  );
}
