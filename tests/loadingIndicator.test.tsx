/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PULSE_GRID_DEFAULT_FRAMES,
  PULSE_GRID_IKUN_FRAMES,
  PULSE_GRID_ORBIT_FRAMES,
  PULSE_GRID_POINTS,
  PULSE_GRID_PRESET_FRAMES,
  PULSE_GRID_PRESET_IDS,
  PULSE_GRID_SIU_FRAMES,
  PULSE_GRID_YMCA_FRAMES,
  PulseGridLoader,
  getPulseGridPointAppearance,
  pulseGridFrame,
  type PulseGridFrames,
} from "@puppyone/shared-ui";
import {
  LoadingAnimationProvider,
  PulseGrid as DesktopPulseGrid,
} from "../src/components/loading";
import { withTestLocalization } from "./testLocalization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("PulseGridLoader frame sequencing", () => {
  it("keeps the simple clockwise orbit available as an alternate preset", () => {
    expect(PULSE_GRID_ORBIT_FRAMES).toEqual([
      [PULSE_GRID_POINTS.topLeft],
      [PULSE_GRID_POINTS.topCenter],
      [PULSE_GRID_POINTS.topRight],
      [PULSE_GRID_POINTS.middleRight],
      [PULSE_GRID_POINTS.bottomRight],
      [PULSE_GRID_POINTS.bottomCenter],
      [PULSE_GRID_POINTS.bottomLeft],
      [PULSE_GRID_POINTS.middleLeft],
    ]);
  });

  it("maps readable 3 by 3 sprites to dark, medium, and bright lights", () => {
    const frame = pulseGridFrame(
      ".oO",
      "oo.",
      "o.o",
    );

    expect(getPulseGridPointAppearance(frame, PULSE_GRID_POINTS.topLeft)).toEqual({
      brightness: 0,
    });
    expect(getPulseGridPointAppearance(frame, PULSE_GRID_POINTS.topCenter)).toEqual({
      brightness: 0.52,
    });
    expect(getPulseGridPointAppearance(frame, PULSE_GRID_POINTS.middleLeft)).toEqual({
      brightness: 0.52,
    });
    expect(getPulseGridPointAppearance(frame, PULSE_GRID_POINTS.topRight)).toEqual({
      brightness: 1,
    });
  });

  it("registers ikun, ymca, and siu as three-level animation presets", () => {
    expect(PULSE_GRID_PRESET_IDS).toEqual(["ikun", "ymca", "siu"]);
    expect(PULSE_GRID_PRESET_FRAMES).toEqual({
      ikun: PULSE_GRID_IKUN_FRAMES,
      ymca: PULSE_GRID_YMCA_FRAMES,
      siu: PULSE_GRID_SIU_FRAMES,
    });

    for (const frames of Object.values(PULSE_GRID_PRESET_FRAMES)) {
      expect(frames.length).toBeGreaterThanOrEqual(12);
      for (const frame of frames) {
        for (const entry of frame) {
          if (typeof entry === "number") continue;
          expect([0.52, 1]).toContain(entry.brightness);
        }
      }
    }
  });

  it("gives YMCA raised-arm poses and SIU a run-up plus wide landing pose", () => {
    expect(brightPointsInFrame(PULSE_GRID_YMCA_FRAMES[0])).toEqual([
      PULSE_GRID_POINTS.topLeft,
      PULSE_GRID_POINTS.topRight,
    ]);
    expect(brightPointsInFrame(PULSE_GRID_YMCA_FRAMES[3])).toEqual([
      PULSE_GRID_POINTS.bottomLeft,
    ]);
    expect(brightPointsInFrame(PULSE_GRID_SIU_FRAMES[0])).toEqual([
      PULSE_GRID_POINTS.middleLeft,
    ]);
    expect(brightPointsInFrame(PULSE_GRID_SIU_FRAMES[9])).toEqual([
      PULSE_GRID_POINTS.middleLeft,
      PULSE_GRID_POINTS.middleRight,
    ]);
  });

  it("uses the ikun choreography by default and moves its bright point", () => {
    vi.useFakeTimers();
    expect(PULSE_GRID_DEFAULT_FRAMES).toBe(PULSE_GRID_IKUN_FRAMES);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => root?.render(withTestLocalization(
      <PulseGridLoader frameDurationMs={50} ariaLabel="Working" />,
    )));

    expect(brightPoint(container)).toBe(PULSE_GRID_POINTS.topRight);
    act(() => vi.advanceTimersByTime(100));
    expect(brightPoint(container)).toBe(PULSE_GRID_POINTS.middleRight);
    act(() => vi.advanceTimersByTime(100));
    expect(brightPoint(container)).toBe(PULSE_GRID_POINTS.bottomCenter);
    act(() => vi.advanceTimersByTime(150));
    expect(brightPoint(container)).toBe(PULSE_GRID_POINTS.topLeft);
  });

  it("plays caller-defined frames, including frames with more than one active point", () => {
    vi.useFakeTimers();
    const frames: PulseGridFrames = [
      [PULSE_GRID_POINTS.topLeft],
      [PULSE_GRID_POINTS.topCenter, PULSE_GRID_POINTS.center],
      [PULSE_GRID_POINTS.bottomRight],
    ];
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => root?.render(withTestLocalization(
      <PulseGridLoader frames={frames} frameDurationMs={50} ariaLabel="Working" />,
    )));

    expect(activePoints(container)).toEqual([PULSE_GRID_POINTS.topLeft]);
    expect(container.querySelector("[data-puppy-loader]")?.getAttribute("data-pulse-grid-frame")).toBe("0");

    act(() => vi.advanceTimersByTime(50));
    expect(activePoints(container)).toEqual([PULSE_GRID_POINTS.topCenter, PULSE_GRID_POINTS.center]);
    expect(container.querySelector("[data-puppy-loader]")?.getAttribute("data-pulse-grid-frame")).toBe("1");

    act(() => vi.advanceTimersByTime(100));
    expect(activePoints(container)).toEqual([PULSE_GRID_POINTS.topLeft]);
    expect(container.querySelector("[data-puppy-loader]")?.getAttribute("data-pulse-grid-frame")).toBe("0");
  });

  it("switches the desktop loader immediately when the resolved Appearance changes", () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => root?.render(
      <LoadingAnimationProvider preset="ymca">
        <DesktopPulseGrid frameDurationMs={1000} ariaLabel="Working" />
      </LoadingAnimationProvider>,
    ));
    expect(brightPoints(container)).toEqual([
      PULSE_GRID_POINTS.topLeft,
      PULSE_GRID_POINTS.topRight,
    ]);

    act(() => {
      root?.render(
        <LoadingAnimationProvider preset="siu">
          <DesktopPulseGrid frameDurationMs={1000} ariaLabel="Working" />
        </LoadingAnimationProvider>,
      );
    });
    expect(brightPoints(container)).toEqual([PULSE_GRID_POINTS.middleLeft]);
  });
});

function activePoints(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-active="true"]'))
    .map((point) => Number(point.dataset.pulseGridPoint));
}

function brightPoint(container: HTMLElement): number | null {
  const point = container.querySelector<HTMLElement>('[data-level="bright"]');
  return point ? Number(point.dataset.pulseGridPoint) : null;
}

function brightPoints(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-level="bright"]'))
    .map((point) => Number(point.dataset.pulseGridPoint));
}

function brightPointsInFrame(frame: (typeof PULSE_GRID_YMCA_FRAMES)[number]): number[] {
  return Object.values(PULSE_GRID_POINTS).filter((point) => (
    getPulseGridPointAppearance(frame, point).brightness === 1
  ));
}
