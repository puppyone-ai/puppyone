import { describe, expect, it } from "vitest";
import { inspectStyleLayers } from "../../../../tooling/styles/style-layer-contract.mjs";

describe("feature stylesheet import edges", () => {
  it("finds normal rules even when a sibling is correctly layered", () => {
    expect(inspectStyleLayers("@layer features { .safe { color: red } } .leak { color: blue }").unlayeredRules).toEqual([".leak"]);
  });
  it("carries the named layer through transitive imports", () => {
    expect(inspectStyleLayers('@import "./child.css";', true)).toEqual({
      unlayeredRules: [], imports: [{ path: "./child.css", layered: true }],
    });
    expect(inspectStyleLayers('@import "vendor.css" layer(primitives);').imports[0].layered).toBe(true);
    expect(inspectStyleLayers('@import "vendor.css";').imports[0].layered).toBe(false);
  });
});
