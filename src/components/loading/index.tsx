import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import {
  DEFAULT_PULSE_GRID_FRAME_DURATION_MS,
  PULSE_GRID_PRESET_FRAMES,
  getPulseGridPointAppearance,
  usePulseGridPlayback,
  type PulseGridFrames,
  type PulseGridPoint,
} from "@puppyone/shared-ui";
import { DEFAULT_LOADING_ANIMATION_PRESET, type LoadingAnimationPreset } from "../../preferences";

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

const PULSE_GRID_TRANSITION_MS = 70;
const PULSE_GRID_POINT_COUNT = 9;
const PULSE_GRID_IDLE_OPACITY = 0.18;
const LoadingAnimationContext = createContext<LoadingAnimationPreset>(
  DEFAULT_LOADING_ANIMATION_PRESET,
);

export function LoadingAnimationProvider({
  children,
  preset,
}: {
  children: ReactNode;
  preset: LoadingAnimationPreset;
}) {
  return (
    <LoadingAnimationContext.Provider value={preset}>
      {children}
    </LoadingAnimationContext.Provider>
  );
}

export function PulseGrid({
  size = "sm",
  tone = "neutral",
  className,
  style,
  ariaLabel = "Loading",
  ariaHidden = false,
  frames,
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
  const { cell, gap } = PULSE_GRID_SIZE[size];
  const { active } = TONE_MAP[tone];
  const preferredFrames = usePreferredPulseGridFrames(frames);
  const playback = usePulseGridPlayback(preferredFrames, frameDurationMs);

  return (
    <span
      {...(ariaHidden ? { "aria-hidden": true } : { role: "status", "aria-label": ariaLabel })}
      data-puppy-loader="pulse-grid"
      data-pulse-grid-frame={playback.frameIndex}
      className={className}
      style={{
        display: "inline-grid",
        gridTemplateColumns: `repeat(3, ${cell}px)`,
        gridAutoRows: `${cell}px`,
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
              width: cell,
              height: cell,
              borderRadius: Math.max(1, cell / 2),
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

function usePreferredPulseGridFrames(frames: PulseGridFrames | undefined): PulseGridFrames {
  const preset = useContext(LoadingAnimationContext);
  return frames ?? PULSE_GRID_PRESET_FRAMES[preset];
}

export function Dots({
  size = "sm",
  tone = "neutral",
  className,
  style,
  ariaLabel = "Loading",
  ariaHidden = false,
}: {
  size?: LoaderSize;
  tone?: LoaderTone;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  ariaHidden?: boolean;
}) {
  const { dot, gap } = DOTS_SIZE[size];
  const { active } = TONE_MAP[tone];

  return (
    <span
      {...(ariaHidden ? { "aria-hidden": true } : { role: "status", "aria-label": ariaLabel })}
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
  ariaLabel,
  variant = "screen",
  size = "sm",
  tone = "neutral",
  className,
  style,
  frames,
  frameDurationMs,
}: {
  label?: ReactNode | null;
  ariaLabel?: string;
  variant?: "screen" | "fill";
  size?: LoaderSize;
  tone?: LoaderTone;
  className?: string;
  style?: CSSProperties;
  frames?: PulseGridFrames;
  frameDurationMs?: number;
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
      <PulseGrid
        size={size}
        tone={tone}
        ariaLabel={ariaLabel || (typeof label === "string" ? label : "Loading")}
        frames={frames}
        frameDurationMs={frameDurationMs}
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
      <Dots size={size} tone={tone} ariaHidden />
      {label != null && <span>{label}</span>}
    </span>
  );
}
