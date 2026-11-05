import { describe, expect, it } from "vitest";
import { shouldRouteToDocumentDrop } from "../../../../../src/features/editor-workbench/drag-and-drop/useExplorerFileDrop";

describe("shouldRouteToDocumentDrop", () => {
  it("routes an image dropped in the center onto a target", () => {
    expect(shouldRouteToDocumentDrop({ region: "center", payloadName: "a.png", hasTarget: true })).toBe(true);
  });
  it("keeps split behaviour for the edge", () => {
    expect(shouldRouteToDocumentDrop({ region: "edge", payloadName: "a.png", hasTarget: true })).toBe(false);
  });
  it("keeps split behaviour without a target", () => {
    expect(shouldRouteToDocumentDrop({ region: "center", payloadName: "a.png", hasTarget: false })).toBe(false);
  });
  it("keeps split behaviour for non-images", () => {
    expect(shouldRouteToDocumentDrop({ region: "center", payloadName: "a.pdf", hasTarget: true })).toBe(false);
  });
});
