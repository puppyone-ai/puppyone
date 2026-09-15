import { describe, expect, it } from "vitest";
import { isAssetLibraryHomeEnabled } from "../../../../src/features/app-shell/homeFeatureGate";

describe("Asset Library homepage experiment gate", () => {
  it("requires both release availability and explicit local opt-in", () => {
    expect(isAssetLibraryHomeEnabled({ available: false, optedIn: false })).toBe(false);
    expect(isAssetLibraryHomeEnabled({ available: false, optedIn: true })).toBe(false);
    expect(isAssetLibraryHomeEnabled({ available: true, optedIn: false })).toBe(false);
    expect(isAssetLibraryHomeEnabled({ available: true, optedIn: true })).toBe(true);
  });
});
