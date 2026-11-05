import { describe, expect, it } from "vitest";
import { parseExperimentalSettings } from "../../../../src/preferences";

describe("markdown heading rail default", () => {
  it("defaults to on when nothing is persisted", () => {
    expect(parseExperimentalSettings(null).enableMarkdownHeadingOutline).toBe(true);
  });

  it("defaults to on for a legacy record that predates the key", () => {
    expect(parseExperimentalSettings("{}").enableMarkdownHeadingOutline).toBe(true);
  });

  it("still honours an explicit opt-out", () => {
    expect(parseExperimentalSettings(
      JSON.stringify({ enableMarkdownHeadingOutline: false }),
    ).enableMarkdownHeadingOutline).toBe(false);
  });

  it("honours an explicit opt-in", () => {
    expect(parseExperimentalSettings(
      JSON.stringify({ enableMarkdownHeadingOutline: true }),
    ).enableMarkdownHeadingOutline).toBe(true);
  });
});
