import { describe, expect, it } from "vitest";
import {
  createPresentationWheelGestureState,
  getPresentationFitZoomPercent,
  getPresentationNavigationTarget,
  reducePresentationWheelGesture,
  settlePresentationFonts,
} from "../../../../../packages/shared-ui/src/editor/viewers/office/presentationPreview";

describe("PowerPoint preview fitting", () => {
  it("uses the tighter of the available width and height", () => {
    expect(getPresentationFitZoomPercent({
      availableWidth: 1_200,
      availableHeight: 300,
      slideWidth: 960,
      slideHeight: 540,
    })).toBe(55.55);
    expect(getPresentationFitZoomPercent({
      availableWidth: 480,
      availableHeight: 1_000,
      slideWidth: 960,
      slideHeight: 540,
    })).toBe(50);
  });

  it("rejects unavailable geometry and respects renderer zoom bounds", () => {
    expect(getPresentationFitZoomPercent({
      availableWidth: 0,
      availableHeight: 300,
      slideWidth: 960,
      slideHeight: 540,
    })).toBeNull();
    expect(getPresentationFitZoomPercent({
      availableWidth: 20,
      availableHeight: 20,
      slideWidth: 960,
      slideHeight: 540,
    })).toBe(10);
  });
});

describe("PowerPoint preview navigation", () => {
  it("supports familiar arrow, paging, and boundary keys", () => {
    const target = (key: string, activeSlide = 2, slideCount = 5) => (
      getPresentationNavigationTarget({ key, activeSlide, slideCount })
    );

    expect(target("ArrowLeft")).toBe(1);
    expect(target("ArrowUp")).toBe(1);
    expect(target("PageUp")).toBe(1);
    expect(target("ArrowRight")).toBe(3);
    expect(target("ArrowDown")).toBe(3);
    expect(target("PageDown")).toBe(3);
    expect(target("Home")).toBe(0);
    expect(target("End")).toBe(4);
    expect(target("Enter")).toBeNull();
  });

  it("clamps navigation at the first and last slide", () => {
    expect(getPresentationNavigationTarget({ key: "ArrowLeft", activeSlide: 0, slideCount: 3 })).toBe(0);
    expect(getPresentationNavigationTarget({ key: "ArrowRight", activeSlide: 2, slideCount: 3 })).toBe(2);
    expect(getPresentationNavigationTarget({ key: "Home", activeSlide: 0, slideCount: 0 })).toBeNull();
  });

  it("turns vertical wheel gestures into one slide change", () => {
    const first = reducePresentationWheelGesture({
      state: createPresentationWheelGestureState(),
      activeSlide: 1,
      slideCount: 4,
      deltaX: 0,
      deltaY: 100,
      deltaMode: 0,
      eventTime: 100,
    });
    const momentum = reducePresentationWheelGesture({
      state: first.state,
      activeSlide: 2,
      slideCount: 4,
      deltaX: 0,
      deltaY: 80,
      deltaMode: 0,
      eventTime: 120,
    });

    expect(first).toMatchObject({ handled: true, target: 2 });
    expect(momentum).toMatchObject({ handled: true, target: null });
  });

  it("accumulates trackpad movement and resets after the gesture becomes idle", () => {
    const first = reducePresentationWheelGesture({
      state: createPresentationWheelGestureState(),
      activeSlide: 2,
      slideCount: 5,
      deltaX: 0,
      deltaY: -12,
      deltaMode: 0,
      eventTime: 100,
    });
    const second = reducePresentationWheelGesture({
      state: first.state,
      activeSlide: 2,
      slideCount: 5,
      deltaX: 0,
      deltaY: -24,
      deltaMode: 0,
      eventTime: 120,
    });
    const nextGesture = reducePresentationWheelGesture({
      state: second.state,
      activeSlide: 1,
      slideCount: 5,
      deltaX: 0,
      deltaY: 40,
      deltaMode: 0,
      eventTime: 400,
    });

    expect(first.target).toBeNull();
    expect(second.target).toBe(1);
    expect(nextGesture.target).toBe(2);
  });

  it("ignores horizontal gestures and clamps wheel navigation at boundaries", () => {
    const horizontal = reducePresentationWheelGesture({
      state: createPresentationWheelGestureState(),
      activeSlide: 1,
      slideCount: 3,
      deltaX: 80,
      deltaY: 20,
      deltaMode: 0,
      eventTime: 100,
    });
    const boundary = reducePresentationWheelGesture({
      state: createPresentationWheelGestureState(),
      activeSlide: 2,
      slideCount: 3,
      deltaX: 0,
      deltaY: 3,
      deltaMode: 1,
      eventTime: 100,
    });

    expect(horizontal).toMatchObject({ handled: false, target: null });
    expect(boundary).toMatchObject({ handled: true, target: null });
  });
});

describe("PowerPoint preview font settling", () => {
  it("waits for available fonts without holding the preview forever", async () => {
    const controller = new AbortController();
    const startedAt = Date.now();
    await settlePresentationFonts(new Promise(() => undefined), controller.signal, 5);
    expect(Date.now() - startedAt).toBeLessThan(100);
  });

  it("honors preview cancellation while fonts are settling", async () => {
    const controller = new AbortController();
    const result = settlePresentationFonts(new Promise(() => undefined), controller.signal, 1_000);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });
});
