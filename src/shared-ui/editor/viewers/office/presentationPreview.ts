export const PRESENTATION_FONT_SETTLE_TIMEOUT_MS = 1_500;
export const PRESENTATION_WHEEL_IDLE_RESET_MS = 180;
export const PRESENTATION_WHEEL_THRESHOLD_PX = 36;

export type PresentationWheelGestureState = Readonly<{
  accumulatedDelta: number;
  consumed: boolean;
  direction: -1 | 0 | 1;
  lastEventAt: number;
}>;

export type PresentationWheelGestureResult = Readonly<{
  handled: boolean;
  state: PresentationWheelGestureState;
  target: number | null;
}>;

export function createPresentationWheelGestureState(): PresentationWheelGestureState {
  return {
    accumulatedDelta: 0,
    consumed: false,
    direction: 0,
    lastEventAt: Number.NEGATIVE_INFINITY,
  };
}

/**
 * Converts a wheel/trackpad stream into one slide change per physical gesture.
 * The state machine is DOM-independent so both rendered and text-fallback
 * presentations share the same behavior and the edge cases remain testable.
 */
export function reducePresentationWheelGesture({
  state,
  activeSlide,
  slideCount,
  deltaX,
  deltaY,
  deltaMode,
  eventTime,
}: {
  state: PresentationWheelGestureState;
  activeSlide: number;
  slideCount: number;
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  eventTime: number;
}): PresentationWheelGestureResult {
  if (
    slideCount <= 0
    || !Number.isFinite(deltaX)
    || !Number.isFinite(deltaY)
    || deltaY === 0
    || Math.abs(deltaX) > Math.abs(deltaY)
  ) {
    return { handled: false, state, target: null };
  }

  const normalizedDelta = deltaY * getWheelDeltaScale(deltaMode);
  const direction = Math.sign(normalizedDelta) as -1 | 1;
  const startsNewGesture = (
    !Number.isFinite(state.lastEventAt)
    || eventTime < state.lastEventAt
    || eventTime - state.lastEventAt > PRESENTATION_WHEEL_IDLE_RESET_MS
  );
  const gesture = startsNewGesture ? createPresentationWheelGestureState() : state;

  if (gesture.consumed) {
    return {
      handled: true,
      state: { ...gesture, lastEventAt: eventTime },
      target: null,
    };
  }

  const accumulatedDelta = gesture.direction !== 0 && gesture.direction !== direction
    ? normalizedDelta
    : gesture.accumulatedDelta + normalizedDelta;
  const reachedThreshold = Math.abs(accumulatedDelta) >= PRESENTATION_WHEEL_THRESHOLD_PX;
  const nextState: PresentationWheelGestureState = {
    accumulatedDelta,
    consumed: reachedThreshold,
    direction,
    lastEventAt: eventTime,
  };

  if (!reachedThreshold) {
    return { handled: true, state: nextState, target: null };
  }

  const target = Math.max(0, Math.min(slideCount - 1, activeSlide + direction));
  return {
    handled: true,
    state: nextState,
    target: target === activeSlide ? null : target,
  };
}

function getWheelDeltaScale(deltaMode: number): number {
  // WheelEvent.DOM_DELTA_LINE and DOM_DELTA_PAGE are 1 and 2 respectively.
  if (deltaMode === 1) return 16;
  if (deltaMode === 2) return 320;
  return 1;
}

export function getPresentationFitZoomPercent({
  availableWidth,
  availableHeight,
  slideWidth,
  slideHeight,
}: {
  availableWidth: number;
  availableHeight: number;
  slideWidth: number;
  slideHeight: number;
}): number | null {
  if (
    !Number.isFinite(availableWidth)
    || !Number.isFinite(availableHeight)
    || !Number.isFinite(slideWidth)
    || !Number.isFinite(slideHeight)
    || availableWidth <= 0
    || availableHeight <= 0
    || slideWidth <= 0
    || slideHeight <= 0
  ) {
    return null;
  }

  const scale = Math.min(availableWidth / slideWidth, availableHeight / slideHeight);
  // The renderer accepts zoom percentages from 10–400. Round down so a
  // fractional device pixel never creates a clipped edge in a tight viewport.
  return Math.max(10, Math.min(400, Math.floor(scale * 10_000) / 100));
}

export async function settlePresentationFonts(
  fontsReady: PromiseLike<unknown> | undefined,
  signal: AbortSignal,
  timeoutMs = PRESENTATION_FONT_SETTLE_TIMEOUT_MS,
): Promise<void> {
  signal.throwIfAborted();
  if (!fontsReady) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      signal.removeEventListener("abort", finish);
      resolve();
    };

    timeoutId = setTimeout(finish, Math.max(0, timeoutMs));
    signal.addEventListener("abort", finish, { once: true });
    void Promise.resolve(fontsReady).then(finish, finish);
  });

  signal.throwIfAborted();
}

export function getPresentationNavigationTarget({
  key,
  activeSlide,
  slideCount,
}: {
  key: string;
  activeSlide: number;
  slideCount: number;
}): number | null {
  if (slideCount <= 0) return null;

  switch (key) {
    case "ArrowLeft":
    case "ArrowUp":
    case "PageUp":
      return Math.max(0, activeSlide - 1);
    case "ArrowRight":
    case "ArrowDown":
    case "PageDown":
      return Math.min(slideCount - 1, activeSlide + 1);
    case "Home":
      return 0;
    case "End":
      return slideCount - 1;
    default:
      return null;
  }
}
