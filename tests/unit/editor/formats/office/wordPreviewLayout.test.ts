import { describe, expect, it } from "vitest";
import {
  resolveWordPreviewScale,
  stepWordPreviewScale,
} from "../../../../../packages/shared-ui/src/editor/viewers/office/word/wordPreviewLayout";

describe("Word preview layout", () => {
  it("fits wide pages without enlarging narrow pages", () => {
    expect(resolveWordPreviewScale({
      availableWidth: 600,
      pageWidth: 800,
      zoom: "fit",
    })).toBe(0.75);
    expect(resolveWordPreviewScale({
      availableWidth: 1000,
      pageWidth: 800,
      zoom: "fit",
    })).toBe(1);
    expect(resolveWordPreviewScale({
      availableWidth: 280,
      pageWidth: 800,
      zoom: "fit",
    })).toBe(0.35);
  });

  it("clamps explicit zoom and steps from the effective fit scale", () => {
    expect(resolveWordPreviewScale({ availableWidth: 1, pageWidth: 1, zoom: 3 })).toBe(2);
    expect(resolveWordPreviewScale({ availableWidth: 1, pageWidth: 1, zoom: 0.1 })).toBe(0.5);
    expect(stepWordPreviewScale(0.75, 1)).toBe(0.8);
    expect(stepWordPreviewScale(0.75, -1)).toBe(0.67);
    expect(stepWordPreviewScale(0.35, 1)).toBe(0.5);
  });
});
