import { describe, expect, it } from "vitest";
import {
  getArrowResizedSidebarWidth,
  getPointerResizedSidebarWidth,
} from "../../../../src/components/auxiliarySidebarGeometry";

describe("auxiliary sidebar logical resize geometry", () => {
  it("grows toward the application content in both writing directions", () => {
    expect(getPointerResizedSidebarWidth({
      currentX: 90,
      direction: "ltr",
      startWidth: 500,
      startX: 100,
    })).toBe(510);
    expect(getPointerResizedSidebarWidth({
      currentX: 110,
      direction: "rtl",
      startWidth: 500,
      startX: 100,
    })).toBe(510);
  });

  it("maps physical arrow keys to the mirrored separator movement", () => {
    expect(getArrowResizedSidebarWidth({
      currentWidth: 500,
      direction: "ltr",
      key: "ArrowLeft",
      step: 12,
    })).toBe(512);
    expect(getArrowResizedSidebarWidth({
      currentWidth: 500,
      direction: "rtl",
      key: "ArrowRight",
      step: 12,
    })).toBe(512);
  });
});
