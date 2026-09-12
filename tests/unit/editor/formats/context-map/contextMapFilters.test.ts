import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONTEXT_MAP_LINE_FILTERS,
  isContextMapReferenceVisible,
  updateContextMapLineFilter,
} from "../../../../../packages/shared-ui/src/editor/viewers/context-map/contextMapFilters";

describe("Context Map line filters", () => {
  it("shows every line category by default", () => {
    expect(DEFAULT_CONTEXT_MAP_LINE_FILTERS).toEqual({
      oneWayLinks: true,
      bidirectionalLinks: true,
    });
    expect(isContextMapReferenceVisible(
      { bidirectional: false },
      DEFAULT_CONTEXT_MAP_LINE_FILTERS,
    )).toBe(true);
    expect(isContextMapReferenceVisible(
      { bidirectional: true },
      DEFAULT_CONTEXT_MAP_LINE_FILTERS,
    )).toBe(true);
  });

  it("filters one-way and bidirectional references independently", () => {
    const withoutOneWay = updateContextMapLineFilter(
      DEFAULT_CONTEXT_MAP_LINE_FILTERS,
      "oneWayLinks",
      false,
    );
    expect(isContextMapReferenceVisible({ bidirectional: false }, withoutOneWay)).toBe(false);
    expect(isContextMapReferenceVisible({ bidirectional: true }, withoutOneWay)).toBe(true);

    const withoutBidirectional = updateContextMapLineFilter(
      DEFAULT_CONTEXT_MAP_LINE_FILTERS,
      "bidirectionalLinks",
      false,
    );
    expect(isContextMapReferenceVisible({ bidirectional: false }, withoutBidirectional)).toBe(true);
    expect(isContextMapReferenceVisible({ bidirectional: true }, withoutBidirectional)).toBe(false);
  });
});
