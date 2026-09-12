import { describe, expect, it } from "vitest";
import {
  EMPTY_CONTEXT_MAP_WHEEL_GESTURE_STATE,
  resolveContextMapWheelGesture,
  type ContextMapWheelGestureInput,
} from "../../../../../packages/shared-ui/src/editor/viewers/context-map/contextMapWheelNavigation";

describe("Context Map wheel gesture intent", () => {
  it("pans with two-axis high-resolution trackpad scrolling", () => {
    const result = resolveContextMapWheelGesture(input({ deltaX: 12.5, deltaY: -8.25 }),
      EMPTY_CONTEXT_MAP_WHEEL_GESTURE_STATE);

    expect(result.gesture).toEqual({ kind: "pan", x: -12.5, y: 8.25 });
    expect(result.state.trackpadPanUntil).toBeGreaterThan(100);
  });

  it("locks a continuing trackpad gesture to pan during a fast swipe", () => {
    const first = resolveContextMapWheelGesture(input({ deltaY: 4, timestamp: 100 }),
      EMPTY_CONTEXT_MAP_WHEEL_GESTURE_STATE);
    const continued = resolveContextMapWheelGesture(
      input({ deltaY: 92, timestamp: 150 }),
      first.state,
    );

    expect(first.gesture.kind).toBe("pan");
    expect(continued.gesture).toEqual({ kind: "pan", x: -0, y: -92 });
  });

  it("zooms a discrete mouse wheel instead of panning it", () => {
    const result = resolveContextMapWheelGesture(input({
      deltaY: 100,
      legacyWheelDeltaY: -120,
    }), EMPTY_CONTEXT_MAP_WHEEL_GESTURE_STATE);

    expect(result.gesture.kind).toBe("zoom");
    expect(result.gesture.kind === "zoom" ? result.gesture.source : null).toBe("mouse-wheel");
  });

  it("uses a more sensitive focal zoom for trackpad pinch gestures", () => {
    const pinch = resolveContextMapWheelGesture(input({ ctrlKey: true, deltaY: -10 }),
      EMPTY_CONTEXT_MAP_WHEEL_GESTURE_STATE);

    expect(pinch.gesture.kind).toBe("zoom");
    expect(pinch.gesture.kind === "zoom" ? pinch.gesture.source : null).toBe("trackpad-pinch");
    expect(pinch.gesture.kind === "zoom" ? pinch.gesture.factor : 1).toBeGreaterThan(1.1);
  });

  it("maps shift-wheel to horizontal panning", () => {
    const result = resolveContextMapWheelGesture(input({ deltaY: 24, shiftKey: true }),
      EMPTY_CONTEXT_MAP_WHEEL_GESTURE_STATE);

    expect(result.gesture).toEqual({ kind: "pan", x: -24, y: 0 });
  });
});

function input(
  overrides: Partial<ContextMapWheelGestureInput>,
): ContextMapWheelGestureInput {
  return {
    ctrlKey: false,
    deltaMode: 0,
    deltaX: 0,
    deltaY: 0,
    pageHeight: 800,
    pageWidth: 1200,
    shiftKey: false,
    timestamp: 100,
    ...overrides,
  };
}
