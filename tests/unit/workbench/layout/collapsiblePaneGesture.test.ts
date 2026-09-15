import { describe, expect, it } from "vitest";
import {
  beginCollapsiblePaneGesture,
  finishCollapsiblePaneGesture,
  moveCollapsiblePaneGesture,
  resolveCollapsiblePaneGestureConfig,
} from "../../../../packages/shared-ui/src/primitives/collapsiblePaneGesture";

const rightPane = resolveCollapsiblePaneGestureConfig({
  collapsedWidth: 0,
  collapseThreshold: 210,
  collapsible: true,
  direction: "ltr",
  maxWidth: 900,
  minWidth: 420,
  side: "inline-end",
});

describe("collapsible pane gesture state machine", () => {
  it("does not turn a collapsed resize edge click into an expand action", () => {
    const gesture = beginCollapsiblePaneGesture(
      rightPane,
      { clientX: 0, clientY: 0 },
      true,
      0,
    );

    expect(finishCollapsiblePaneGesture(gesture, rightPane)).toBeNull();
  });

  it("shows a temporary collapse through release jitter and emits one final commit", () => {
    let gesture = beginCollapsiblePaneGesture(
      rightPane,
      { clientX: 0, clientY: 0 },
      false,
      700,
    );

    gesture = moveCollapsiblePaneGesture(gesture, rightPane, { clientX: 490, clientY: 0 });
    expect(gesture.phase).toBe("collapse-preview");
    expect(gesture.previewCollapsed).toBe(true);
    expect(gesture.previewWidth).toBe(0);

    gesture = moveCollapsiblePaneGesture(gesture, rightPane, { clientX: 480, clientY: 0 });
    expect(gesture.phase).toBe("collapse-preview");
    expect(gesture.previewCollapsed).toBe(true);
    expect(gesture.previewWidth).toBe(0);
    expect(finishCollapsiblePaneGesture(gesture, rightPane)).toEqual({
      type: "collapse",
      restoreWidth: 420,
    });
  });

  it("requires a deliberate retreat beyond hysteresis to disarm collapse", () => {
    let gesture = beginCollapsiblePaneGesture(
      rightPane,
      { clientX: 0, clientY: 0 },
      false,
      700,
    );
    gesture = moveCollapsiblePaneGesture(gesture, rightPane, { clientX: 490, clientY: 0 });
    gesture = moveCollapsiblePaneGesture(gesture, rightPane, { clientX: 450, clientY: 0 });

    expect(gesture.phase).toBe("expand-preview");
    expect(gesture.previewCollapsed).toBe(false);
    expect(gesture.previewWidth).toBe(420);
    expect(finishCollapsiblePaneGesture(gesture, rightPane)).toEqual({
      type: "resize",
      width: 420,
    });
  });

  it("previews expansion locally and commits only after sufficient travel", () => {
    let shortGesture = beginCollapsiblePaneGesture(
      rightPane,
      { clientX: 0, clientY: 0 },
      true,
      0,
    );
    shortGesture = moveCollapsiblePaneGesture(
      shortGesture,
      rightPane,
      { clientX: -20, clientY: 0 },
    );
    expect(shortGesture.previewCollapsed).toBe(false);
    expect(finishCollapsiblePaneGesture(shortGesture, rightPane)).toBeNull();

    let committedGesture = beginCollapsiblePaneGesture(
      rightPane,
      { clientX: 0, clientY: 0 },
      true,
      0,
    );
    committedGesture = moveCollapsiblePaneGesture(
      committedGesture,
      rightPane,
      { clientX: -220, clientY: 0 },
    );
    expect(finishCollapsiblePaneGesture(committedGesture, rightPane)).toEqual({
      type: "expand",
      width: 420,
    });
  });

  it.each([
    ["inline-start", "ltr", 56, 160, 1],
    ["inline-start", "rtl", 56, 160, -1],
    ["inline-end", "ltr", 0, 320, -1],
    ["inline-end", "rtl", 0, 320, 1],
  ] as const)("hands off edge expansion to direct resize for %s in %s", (side, direction, collapsedWidth, minWidth, sign) => {
    const config = resolveCollapsiblePaneGestureConfig({
      collapsedWidth,
      collapseThreshold: minWidth / 2,
      collapsible: true,
      direction,
      maxWidth: 900,
      minWidth,
      side,
    });
    let gesture = beginCollapsiblePaneGesture(config, { clientX: 400, clientY: 20 }, true, collapsedWidth);
    const moveToWidth = (width: number) => {
      gesture = moveCollapsiblePaneGesture(gesture, config, {
        clientX: 400 + (width - collapsedWidth) * sign,
        clientY: 20,
      });
    };

    moveToWidth(collapsedWidth + 8);
    expect(gesture.phase).toBe("expand-preview");
    expect(gesture.previewWidth).toBe(minWidth);

    // The same held gesture must follow subsequent outward and inward moves
    // without repeatedly starting the snap animation.
    for (const width of [minWidth, minWidth + 32, minWidth + 96, minWidth + 48, minWidth]) {
      moveToWidth(width);
      expect(gesture.phase).toBe("resizing");
      expect(gesture.previewWidth).toBe(width);
      expect(gesture.previewCollapsed).toBe(false);
    }
    expect(finishCollapsiblePaneGesture(gesture, config)).toEqual({ type: "expand", width: minWidth });

    moveToWidth(collapsedWidth);
    expect(gesture.phase).toBe("collapse-preview");
    expect(gesture.previewCollapsed).toBe(true);
    expect(finishCollapsiblePaneGesture(gesture, config)).toBeNull();
  });

  it.each([
    ["inline-start", "ltr", -200],
    ["inline-end", "ltr", 200],
    ["inline-start", "rtl", 200],
    ["inline-end", "rtl", -200],
  ] as const)("uses the same collapse rule for %s in %s", (side, direction, clientX) => {
    const config = resolveCollapsiblePaneGestureConfig({
      collapsedWidth: 0,
      collapseThreshold: 120,
      collapsible: true,
      direction,
      maxWidth: 900,
      minWidth: 240,
      side,
    });
    let gesture = beginCollapsiblePaneGesture(
      config,
      { clientX: 0, clientY: 0 },
      false,
      320,
    );
    gesture = moveCollapsiblePaneGesture(gesture, config, { clientX, clientY: 0 });

    expect(finishCollapsiblePaneGesture(gesture, config)).toEqual({
      type: "collapse",
      restoreWidth: config.minWidth,
    });
  });
});
