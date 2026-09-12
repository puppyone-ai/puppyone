import { describe, expect, it } from "vitest";
import {
  isSubThemeId,
  normalizeSubThemeId,
  readLegacySurfaceSubThemeId,
} from "../../../../src/features/themes/subThemePreferences";

describe("sub-theme preference migration", () => {
  it.each([
    ["default", "default.neutral"],
    ["builtin.pack.github", "default.github"],
    ["builtin.pack.newsprint", "default.newspaper"],
    ["builtin.pack.newspaper", "default.newspaper"],
    ["builtin.markdown.newsprint", "default.newspaper"],
  ])("normalizes retired id %s", (legacyId, expected) => {
    expect(normalizeSubThemeId(legacyId)).toBe(expected);
  });

  it("reads the coordinated pack from legacy preference documents", () => {
    expect(readLegacySurfaceSubThemeId(JSON.stringify({
      version: 5,
      pack: "builtin.pack.github",
    }))).toBe("default.github");
  });

  it("migrates version 1 only when every surface selected the same theme", () => {
    expect(readLegacySurfaceSubThemeId(JSON.stringify({
      version: 1,
      application: "com.example.forest",
      markdown: "com.example.forest",
      csv: "com.example.forest",
    }))).toBe("com.example.forest");

    expect(readLegacySurfaceSubThemeId(JSON.stringify({
      version: 1,
      application: "default",
      markdown: "builtin.pack.github",
      csv: "default",
    }))).toBeNull();
  });

  it.each([null, "", "{", "[]", '{"version":5}', '{"version":1}'])
    ("ignores malformed legacy input %s", (value) => {
      expect(readLegacySurfaceSubThemeId(value)).toBeNull();
    });

  it("rejects managed Custom CSS and malformed ids", () => {
    expect(readLegacySurfaceSubThemeId(JSON.stringify({
      version: 5,
      pack: "local.puppyone.custom-css",
    }))).toBeNull();
    expect(isSubThemeId("default.github")).toBe(true);
    expect(isSubThemeId("github")).toBe(false);
    expect(isSubThemeId("Default.GitHub")).toBe(false);
  });
});
