import { describe, expect, it } from "vitest";
import {
  getEdgeScrollVelocity,
  pickDropBoundary,
} from "../../../../../../src/shared-ui/editor/markdown/addons/block-drag/blockDragGeometry";

describe("pickDropBoundary", () => {
  const blocks = [{ top: 0, bottom: 100 }, { top: 120, bottom: 140 }, { top: 160, bottom: 400 }];
  const pick = (height: number) => pickDropBoundary(
    blocks.length,
    height,
    (index) => blocks[index].top,
    (index) => blocks[index].bottom,
  );

  it("splits each block at its midpoint", () => {
    expect(pick(49)).toBe(0);
    expect(pick(50)).toBe(1);
    expect(pick(129)).toBe(1);
    expect(pick(130)).toBe(2);
    expect(pick(279)).toBe(2);
    expect(pick(280)).toBe(3);
  });

  it("clamps outside the group", () => {
    expect(pick(-500)).toBe(0);
    expect(pick(9000)).toBe(3);
  });

  it("reads only logarithmically many blocks", () => {
    let reads = 0;
    const count = 100_000;
    const boundary = pickDropBoundary(count, 5_000_000, (index) => {
      reads += 1;
      return index * 100;
    }, (index) => index * 100 + 50);
    expect(boundary).toBe(50_000);
    expect(reads).toBeLessThanOrEqual(18);
  });
});

describe("getEdgeScrollVelocity", () => {
  it("rests outside the edge zones", () => {
    expect(getEdgeScrollVelocity(300, 0, 600)).toBe(0);
    expect(getEdgeScrollVelocity(48, 0, 600)).toBe(0);
    expect(getEdgeScrollVelocity(552, 0, 600)).toBe(0);
  });

  it("ramps with depth and caps past the edge", () => {
    expect(getEdgeScrollVelocity(24, 0, 600)).toBe(-420);
    expect(getEdgeScrollVelocity(576, 0, 600)).toBe(420);
    expect(getEdgeScrollVelocity(-200, 0, 600)).toBe(-840);
    expect(getEdgeScrollVelocity(900, 0, 600)).toBe(840);
  });
});
