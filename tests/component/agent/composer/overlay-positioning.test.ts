/** @vitest-environment happy-dom */

import { describe, expect, it } from "vitest";

import { resolveAnchoredOverlayPosition } from "../../../../src/features/app-shell/useAnchoredOverlayPosition";

describe("Desktop Agent renderer surfaces", () => {

  it("keeps anchored overlays inside the Agent boundary and prefers the available side", () => {
    const position = resolveAnchoredOverlayPosition({
      anchor: { top: 700, right: 430, bottom: 730, left: 400, width: 30, height: 30 },
      boundary: { top: 0, right: 469, bottom: 800, left: 50, width: 419, height: 800 },
      viewportWidth: 1000,
      viewportHeight: 800,
      overlayHeight: 360,
    });

    expect(position.placement).toBe("above");
    expect(position.width).toBe(320);
    expect(position.left).toBe(137);
    expect(position.left + position.width).toBeLessThanOrEqual(457);
    expect(position.top).toBeGreaterThanOrEqual(12);
  });

  it("locks Composer pickers above the trigger even when the lower side has more room", () => {
    const position = resolveAnchoredOverlayPosition({
      anchor: { top: 250, right: 430, bottom: 280, left: 400, width: 30, height: 30 },
      boundary: { top: 0, right: 469, bottom: 800, left: 50, width: 419, height: 800 },
      viewportWidth: 1000,
      viewportHeight: 800,
      overlayHeight: 180,
      placementPreference: "above",
    });

    expect(position.placement).toBe("above");
    expect(position.top).toBe(62);
    expect(position.top + 180).toBeLessThanOrEqual(250 - 8);
  });
});
