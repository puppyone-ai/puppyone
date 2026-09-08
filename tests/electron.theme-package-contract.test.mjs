import { describe, expect, it } from "vitest";
import { parseThemeManifest } from "../electron/main/themes/theme-package-contract.mjs";

describe("CSS theme package manifest", () => {
  it("normalizes a valid version 1 manifest", () => {
    const manifest = parseThemeManifest({
      schemaVersion: 1,
      id: "com.example.newsprint",
      name: "Newsprint",
      version: "1.2.0",
      author: "Example Studio",
      modes: ["light", "dark"],
      targets: ["markdown", "csv"],
      entrypoints: {
        markdown: "markdown.css",
        csv: "csv.css",
      },
    });

    expect(manifest).toEqual({
      schemaVersion: 1,
      contractVersion: 1,
      id: "com.example.newsprint",
      name: "Newsprint",
      version: "1.2.0",
      author: "Example Studio",
      modes: ["light", "dark"],
      targets: ["markdown", "csv"],
      compatibleRootThemeIds: ["default"],
      entrypoints: {
        markdown: "markdown.css",
        csv: "csv.css",
      },
    });
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.entrypoints)).toBe(true);
  });

  it("declares which Root Themes a Sub Theme can extend", () => {
    const manifest = parseThemeManifest(validManifest({
      compatibleRootThemeIds: ["windows-xp"],
    }));

    expect(manifest.contractVersion).toBe(1);
    expect(manifest.compatibleRootThemeIds).toEqual(["windows-xp"]);
    expect(Object.isFrozen(manifest.compatibleRootThemeIds)).toBe(true);
  });

  it("accepts an optional typography target with its own entrypoint", () => {
    const manifest = parseThemeManifest(validManifest({
      targets: ["typography", "markdown"],
      entrypoints: { typography: "typography.css", markdown: "markdown.css" },
    }));

    expect(manifest.targets).toEqual(["typography", "markdown"]);
    expect(manifest.entrypoints.typography).toBe("typography.css");
  });

  it.each([[[]], [["Default"]], [["windows xp"]], [["default", "default"]]])
    ("rejects invalid Root Theme compatibility %j", (compatibleRootThemeIds) => {
      expect(() => parseThemeManifest(validManifest({ compatibleRootThemeIds })))
        .toThrow("compatibleRootThemeIds");
    });

  it("rejects unsupported schema versions", () => {
    expect(() => parseThemeManifest(validManifest({ schemaVersion: 2 })))
      .toThrow("Unsupported theme schema version");
  });

  it.each([
    "newsprint",
    "Com.Example.Newsprint",
    "com.example.news print",
    "com/example/newsprint",
    "com..example.newsprint",
  ])("rejects unsafe or unstable theme id %s", (id) => {
    expect(() => parseThemeManifest(validManifest({ id })))
      .toThrow("Theme id must be a reverse-domain identifier");
  });

  it.each([
    "../markdown.css",
    "styles/markdown.css",
    "/tmp/markdown.css",
    "markdown.scss",
  ])("rejects unsafe entrypoint %s", (entrypoint) => {
    expect(() => parseThemeManifest(validManifest({
      entrypoints: { markdown: entrypoint },
    }))).toThrow("Theme entrypoint must be a direct relative CSS filename");
  });

  it("requires targets and entrypoints to describe the same surfaces", () => {
    expect(() => parseThemeManifest(validManifest({
      targets: ["markdown", "csv"],
      entrypoints: { markdown: "markdown.css" },
    }))).toThrow("Theme targets and entrypoints must match");
  });

  it("rejects unknown targets and invalid modes", () => {
    expect(() => parseThemeManifest(validManifest({
      targets: ["terminal"],
      entrypoints: { terminal: "terminal.css" },
    }))).toThrow("Unsupported theme target");

    expect(() => parseThemeManifest(validManifest({ modes: ["system"] })))
      .toThrow("Unsupported theme color mode");
  });
});

function validManifest(overrides = {}) {
  return {
    schemaVersion: 1,
    id: "com.example.newsprint",
    name: "Newsprint",
    version: "1.0.0",
    modes: ["light"],
    targets: ["markdown"],
    entrypoints: { markdown: "markdown.css" },
    ...overrides,
  };
}
