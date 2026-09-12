import { describe, expect, it } from "vitest";
import { resolveFeatureFlags } from "../../../../src/features/flags";

describe("feature flag release gates", () => {
  it("keeps the Cloud billing control plane unavailable unless a build opts in", () => {
    expect(resolveFeatureFlags({}).cloudBilling).toBe(false);
    expect(resolveFeatureFlags({ cloudBilling: true }).cloudBilling).toBe(true);
  });

  it("keeps the Asset Library homepage unavailable unless a build opts in", () => {
    expect(resolveFeatureFlags({}).assetLibraryHome).toBe(false);
    expect(resolveFeatureFlags({ assetLibraryHome: true }).assetLibraryHome).toBe(true);
  });

});
