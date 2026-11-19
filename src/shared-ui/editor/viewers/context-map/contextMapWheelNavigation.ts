export type ContextMapWheelGesture =
  | Readonly<{ kind: "pan"; x: number; y: number }>
  | Readonly<{ kind: "zoom"; factor: number; source: "mouse-wheel" | "trackpad-pinch" }>;

export type ContextMapWheelGestureState = Readonly<{
  trackpadPanUntil: number;
}>;

export type ContextMapWheelGestureInput = Readonly<{
  ctrlKey: boolean;
  deltaMode: number;
  deltaX: number;
  deltaY: number;
  legacyWheelDeltaY?: number;
  pageHeight: number;
  pageWidth: number;
  shiftKey: boolean;
  timestamp: number;
}>;

export const EMPTY_CONTEXT_MAP_WHEEL_GESTURE_STATE: ContextMapWheelGestureState = Object.freeze({
  trackpadPanUntil: 0,
});

const PIXEL_DELTA_MODE = 0;
const LINE_DELTA_MODE = 1;
const TRACKPAD_GESTURE_LOCK_MS = 180;
const TRACKPAD_FINE_DELTA_LIMIT = 50;
const MOUSE_WHEEL_ZOOM_SENSITIVITY = 0.0018;
const TRACKPAD_PINCH_ZOOM_SENSITIVITY = 0.012;

export function resolveContextMapWheelGesture(
  input: ContextMapWheelGestureInput,
  state: ContextMapWheelGestureState,
): Readonly<{
  gesture: ContextMapWheelGesture;
  state: ContextMapWheelGestureState;
}> {
  const pixelDelta = normalizeWheelDelta(input);

  if (input.ctrlKey) {
    return {
      gesture: {
        kind: "zoom",
        factor: getZoomFactor(pixelDelta.y, TRACKPAD_PINCH_ZOOM_SENSITIVITY),
        source: "trackpad-pinch",
      },
      state: EMPTY_CONTEXT_MAP_WHEEL_GESTURE_STATE,
    };
  }

  const trackpadPanActive = state.trackpadPanUntil > 0
    && input.timestamp <= state.trackpadPanUntil;
  const trackpadPanDetected = !isDiscreteMouseWheel(input) && (
    input.shiftKey
    || Math.abs(input.deltaX) > 0.01
    || input.deltaMode === PIXEL_DELTA_MODE && (
      Math.abs(input.deltaY) < TRACKPAD_FINE_DELTA_LIMIT
      || hasFractionalPart(input.deltaX)
      || hasFractionalPart(input.deltaY)
    )
  );

  if (trackpadPanActive || trackpadPanDetected) {
    const shiftPan = input.shiftKey && Math.abs(pixelDelta.x) < 0.01;
    return {
      gesture: {
        kind: "pan",
        x: shiftPan ? -pixelDelta.y : -pixelDelta.x,
        y: shiftPan ? 0 : -pixelDelta.y,
      },
      state: { trackpadPanUntil: input.timestamp + TRACKPAD_GESTURE_LOCK_MS },
    };
  }

  return {
    gesture: {
      kind: "zoom",
      factor: getZoomFactor(pixelDelta.y, MOUSE_WHEEL_ZOOM_SENSITIVITY),
      source: "mouse-wheel",
    },
    state: EMPTY_CONTEXT_MAP_WHEEL_GESTURE_STATE,
  };
}

function normalizeWheelDelta(input: ContextMapWheelGestureInput): Readonly<{ x: number; y: number }> {
  if (input.deltaMode === LINE_DELTA_MODE) {
    return { x: input.deltaX * 16, y: input.deltaY * 16 };
  }
  if (input.deltaMode !== PIXEL_DELTA_MODE) {
    return {
      x: input.deltaX * Math.max(1, input.pageWidth),
      y: input.deltaY * Math.max(1, input.pageHeight),
    };
  }
  return { x: input.deltaX, y: input.deltaY };
}

function isDiscreteMouseWheel(input: ContextMapWheelGestureInput): boolean {
  if (input.deltaMode !== PIXEL_DELTA_MODE) return true;
  const legacyDelta = Math.abs(input.legacyWheelDeltaY ?? 0);
  return legacyDelta >= 120 && legacyDelta % 120 === 0 && Math.abs(input.deltaX) < 0.01;
}

function hasFractionalPart(value: number): boolean {
  return Math.abs(value - Math.round(value)) > 0.001;
}

function getZoomFactor(deltaY: number, sensitivity: number): number {
  return Math.min(1.4, Math.max(0.7, Math.exp(-deltaY * sensitivity)));
}
