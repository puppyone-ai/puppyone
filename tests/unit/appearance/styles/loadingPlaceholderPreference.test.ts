import { describe, expect, it } from "vitest";
import {
  readAppearancePreferences,
  readLegacyAppearanceSnapshot,
  serializeAppearancePreferences,
} from "../../../../src/features/appearance";
import {
  DEFAULT_LOADING_PLACEHOLDER_STYLE,
  SELECTABLE_LOADING_STYLES,
  parseLoadingPlaceholderStyle,
  parseSelectableLoadingStyle,
} from "../../../../src/preferences";

const legacy = readLegacyAppearanceSnapshot({ getItem: () => null });

function withSharedStyle(style: unknown) {
  const base = readAppearancePreferences(null, legacy).preferences;
  return JSON.stringify({ ...base, shared: { ...base.shared, loadingPlaceholderStyle: style } });
}

describe("loading placeholder style preference", () => {
  it("defaults to the rounded style", () => {
    expect(DEFAULT_LOADING_PLACEHOLDER_STYLE).toBe("rounded");
    expect(readAppearancePreferences(null, legacy).preferences.shared.loadingPlaceholderStyle).toBe("rounded");
  });

  it("accepts only the known styles", () => {
    expect(parseLoadingPlaceholderStyle("dither")).toBe("dither");
    expect(parseLoadingPlaceholderStyle("rounded")).toBe("rounded");
    expect(parseLoadingPlaceholderStyle("shimmer")).toBe("rounded");
    expect(parseLoadingPlaceholderStyle(undefined)).toBe("rounded");
  });

  it("offers only the rounded style while dither stays implemented", () => {
    expect(SELECTABLE_LOADING_STYLES).toEqual(["rounded"]);
    expect(parseSelectableLoadingStyle("dither")).toBe("rounded");
    expect(parseSelectableLoadingStyle("rounded")).toBe("rounded");
  });

  it("persists with the shared appearance preferences and reads an unoffered style as the default", () => {
    const read = readAppearancePreferences(withSharedStyle("rounded"), legacy);
    expect(read.source).toBe("v6");
    expect(read.preferences.shared.loadingPlaceholderStyle).toBe("rounded");
    const again = readAppearancePreferences(serializeAppearancePreferences(read.preferences), legacy);
    expect(again.preferences.shared.loadingPlaceholderStyle).toBe("rounded");
    expect(readAppearancePreferences(withSharedStyle("dither"), legacy).preferences.shared.loadingPlaceholderStyle).toBe("rounded");
  });

  it("falls back to the default for unknown values and to the current value when absent", () => {
    expect(readAppearancePreferences(withSharedStyle("sparkle"), legacy).preferences.shared.loadingPlaceholderStyle).toBe("rounded");
    const written = readAppearancePreferences(null, legacy).preferences;
    const { loadingPlaceholderStyle: _omitted, ...sharedWithoutStyle } = written.shared;
    void _omitted;
    const olderWrite = JSON.stringify({ ...written, shared: sharedWithoutStyle });
    const current = { ...legacy, loadingPlaceholderStyle: "rounded" as const };
    expect(readAppearancePreferences(olderWrite, current).preferences.shared.loadingPlaceholderStyle).toBe("rounded");
  });
});
