import { describe, expect, it } from "vitest";
import {
  DEFAULT_MARKDOWN_PRESENTATION_SETTINGS,
  parseMarkdownPresentationSettings,
  resolveMarkdownPresentationStyle,
  serializeMarkdownPresentationSettings,
} from "../../../../../../src/features/markdown/markdownPresentation";

describe("Markdown presentation preferences", () => {
  it("uses stable defaults for missing or malformed values", () => {
    expect(parseMarkdownPresentationSettings(null)).toEqual(DEFAULT_MARKDOWN_PRESENTATION_SETTINGS);
    expect(parseMarkdownPresentationSettings("{")).toEqual(DEFAULT_MARKDOWN_PRESENTATION_SETTINGS);
    expect(parseMarkdownPresentationSettings(JSON.stringify({ headingScale: "unsupported" })))
      .toEqual(DEFAULT_MARKDOWN_PRESENTATION_SETTINGS);
  });

  it("uses the active theme for every property until the user chooses an override", () => {
    expect(DEFAULT_MARKDOWN_PRESENTATION_SETTINGS).toEqual({
      headingScale: "theme",
      strongColor: "theme",
      strongWeight: "theme",
    });
    expect(resolveMarkdownPresentationStyle(DEFAULT_MARKDOWN_PRESENTATION_SETTINGS)).toEqual({});
  });

  it("migrates the legacy emphasis color value", () => {
    expect(parseMarkdownPresentationSettings("warm")).toEqual({
      ...DEFAULT_MARKDOWN_PRESENTATION_SETTINGS,
      strongColor: "warm",
    });
  });

  it("round-trips versioned preferences and resolves only explicit CSS token overrides", () => {
    const settings = {
      headingScale: "large",
      strongColor: "accent",
      strongWeight: "heavy",
    } as const;

    expect(serializeMarkdownPresentationSettings(settings)).toBe(JSON.stringify({
      version: 2,
      ...settings,
    }));
    expect(parseMarkdownPresentationSettings(serializeMarkdownPresentationSettings(settings)))
      .toEqual(settings);
    expect(resolveMarkdownPresentationStyle(settings)).toEqual({
      "--po-md-h1-size": "34px",
      "--po-md-h2-size": "26px",
      "--po-md-h3-size": "21px",
      "--po-md-strong-weight": "700",
      "--po-md-strong-color": "var(--po-accent)",
    });
  });

  it("preserves explicit values in version 2, including values that used to be defaults", () => {
    expect(parseMarkdownPresentationSettings(JSON.stringify({
      version: 2,
      headingScale: "default",
      strongColor: "default",
      strongWeight: "semibold",
    }))).toEqual({
      headingScale: "default",
      strongColor: "default",
      strongWeight: "semibold",
    });
  });

  it("migrates unversioned qubits defaults to Follow theme without losing non-default choices", () => {
    expect(parseMarkdownPresentationSettings(JSON.stringify({
      headingScale: "default",
      strongColor: "accent",
      strongWeight: "semibold",
    }))).toEqual({
      headingScale: "theme",
      strongColor: "accent",
      strongWeight: "theme",
    });
  });

  it("migrates a consistent legacy heading scale and normalizes mixed legacy scales", () => {
    expect(parseMarkdownPresentationSettings(JSON.stringify({
      h1Scale: "compact",
      h2Scale: "compact",
      h3Scale: "compact",
      strongWeight: "bold",
    }))).toEqual({
      ...DEFAULT_MARKDOWN_PRESENTATION_SETTINGS,
      headingScale: "compact",
      strongWeight: "bold",
    });

    expect(parseMarkdownPresentationSettings(JSON.stringify({
      h1Scale: "large",
      h2Scale: "compact",
      h3Scale: "large",
    }))).toEqual(DEFAULT_MARKDOWN_PRESENTATION_SETTINGS);
  });
});
