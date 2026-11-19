import type {
  ExplorerRevealPhase,
  ExplorerRowMotionInstruction,
} from "./explorerMotionPlan";

export const EXPLORER_MOTION_DURATION_MS = 220;
export const EXPLORER_MOTION_RAMP_FRACTION = 0.22;

const EXPLORER_MOTION_EASING_SAMPLE_COUNT = 24;
const REVEAL_HIDDEN_CLIP = "inset(0 0 100% 0)";
const REVEAL_VISIBLE_CLIP = "inset(0 0 0 0)";

/**
 * Samples a symmetric, jerk-limited trapezoidal velocity profile:
 * smooth acceleration, a constant-speed middle, then smooth deceleration.
 * The returned position is normalized to [0, 1].
 */
export function getExplorerMotionProgress(timeFraction: number): number {
  const time = clamp(timeFraction, 0, 1);
  const ramp = EXPLORER_MOTION_RAMP_FRACTION;
  const plateauVelocity = 1 / (1 - ramp);

  if (time < ramp) {
    const rampProgress = time / ramp;
    return ramp * plateauVelocity * (
      rampProgress ** 3 - 0.5 * rampProgress ** 4
    );
  }

  if (time > 1 - ramp) {
    return 1 - getExplorerMotionProgress(1 - time);
  }

  const accelerationDistance = ramp * plateauVelocity * 0.5;
  return accelerationDistance + (time - ramp) * plateauVelocity;
}

export const EXPLORER_MOTION_EASING = createSampledLinearEasing(
  EXPLORER_MOTION_EASING_SAMPLE_COUNT,
);

export type ExplorerMotionAnimationDefinition = {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
};

export function createExplorerMotionAnimation({
  instruction,
  exitPhase,
}: {
  instruction?: ExplorerRowMotionInstruction;
  exitPhase?: ExplorerRevealPhase;
}): ExplorerMotionAnimationDefinition | null {
  if (!instruction && !exitPhase) return null;

  const keyframes = exitPhase
    ? createPhasedClipKeyframes(exitPhase, REVEAL_VISIBLE_CLIP, REVEAL_HIDDEN_CLIP)
    : instruction?.kind === "move"
      ? [
          { transform: `translateY(${instruction.offsetY}px)` },
          { transform: "translateY(0)" },
        ]
      : createPhasedClipKeyframes(
          instruction?.reveal ?? { start: 0, end: 1 },
          REVEAL_HIDDEN_CLIP,
          REVEAL_VISIBLE_CLIP,
        );

  return {
    keyframes,
    options: {
      duration: EXPLORER_MOTION_DURATION_MS,
      easing: EXPLORER_MOTION_EASING,
      fill: "both",
    },
  };
}

function createPhasedClipKeyframes(
  phase: ExplorerRevealPhase,
  from: string,
  to: string,
): Keyframe[] {
  const start = clamp(phase.start, 0, 1);
  const end = clamp(Math.max(phase.end, start), 0, 1);
  const keyframes: Keyframe[] = [{ clipPath: from, offset: 0 }];

  if (start > 0) keyframes.push({ clipPath: from, offset: start });
  keyframes.push({ clipPath: to, offset: end });
  if (end < 1) keyframes.push({ clipPath: to, offset: 1 });

  return keyframes;
}

function createSampledLinearEasing(sampleCount: number): string {
  const points = Array.from({ length: sampleCount + 1 }, (_, index) => {
    const time = index / sampleCount;
    const position = getExplorerMotionProgress(time);
    return `${formatNumber(position)} ${formatNumber(time * 100)}%`;
  });
  return `linear(${points.join(", ")})`;
}

function formatNumber(value: number): string {
  return value.toFixed(5).replace(/\.?0+$/, "");
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
