import { describe, expect, it } from "vitest";
import { parseSingleFileThemeCss } from "../../../../electron/main/themes/theme-single-file-contract.mjs";

describe("single-file CSS theme contract", () => {
  it("extracts metadata and one stylesheet per declared target", () => {
    const theme = parseSingleFileThemeCss(`
      /* Portable PuppyOne theme */
      @puppyone-theme {
        id: com.example.forest;
        name: Forest Reader;
        version: 1.2.0;
        author: Example Studio;
        modes: light dark;
        compatible-root-themes: default;
      }
      @puppyone application {
        .theme-root { --po-surface-canvas: #f1f7f4; }
      }
      @puppyone markdown {
        .theme-root { --po-md-heading-color: #234; }
      }
      @puppyone csv {
        .theme-root { --po-csv-surface-background: #fff; }
      }
    `, { sourcePath: "forest.css" });

    expect(theme).toMatchObject({
      id: "com.example.forest",
      name: "Forest Reader",
      version: "1.2.0",
      author: "Example Studio",
      modes: ["light", "dark"],
      contractVersion: 1,
      compatibleRootThemeIds: ["default"],
      targets: ["application", "markdown", "csv"],
    });
    expect(theme.stylesheets.application).toContain("--po-surface-canvas: #f1f7f4");
    expect(theme.stylesheets.markdown).toContain("--po-md-heading-color: #234");
    expect(theme.stylesheets.csv).toContain("--po-csv-surface-background: #fff");
    expect(Object.isFrozen(theme)).toBe(true);
    expect(Object.isFrozen(theme.stylesheets)).toBe(true);
  });

  it("leaves metadata-free CSS on the legacy Typora-style path", () => {
    expect(parseSingleFileThemeCss("body { color: #222 }", { sourcePath: "paper.css" }))
      .toBeNull();
  });

  it("keeps reserved built-in identity and compatibility metadata behind the generator boundary", () => {
    const css = `
      @puppyone-theme {
        id: default.warm;
        name: Warm;
        version: 1.0.0;
        modes: light dark;
        compatible-root-themes: default;
        builtin-order: 20;
        legacy-light-preset: warm;
        legacy-dark-preset: warm;
      }
      @puppyone application {}
      @puppyone markdown {}
      @puppyone csv {}
    `;

    expect(() => parseSingleFileThemeCss(css)).toThrow("Unsupported theme metadata");
    const theme = parseSingleFileThemeCss(css, {
      allowReservedBuiltinId: true,
      allowBuiltinCompatibilityMetadata: true,
    });
    expect(theme).toMatchObject({
      id: "default.warm",
      builtinOrder: 20,
      legacyPresets: { light: "warm", dark: "warm" },
      targets: ["application", "markdown", "csv"],
    });
  });

  it.each([
    ["duplicate metadata", `${metadata()} ${metadata()}`],
    ["duplicate target", `${metadata()} @puppyone markdown {} @puppyone markdown {}`],
    ["unknown target", `${metadata()} @puppyone terminal {}`],
    ["rules outside targets", `${metadata()} body { color: red } @puppyone markdown {}`],
    ["unknown metadata", `@puppyone-theme { id: com.example.test; name: Test; version: 1.0.0; modes: light; website: example.com; } @puppyone markdown {}`],
  ])("rejects coordinated CSS with %s", (_case, css) => {
    expect(() => parseSingleFileThemeCss(css, { sourcePath: "broken.css" })).toThrow();
  });

  it("rejects nested PuppyOne control blocks", () => {
    expect(() => parseSingleFileThemeCss(`
      ${metadata()}
      @puppyone markdown {
        @media (min-width: 600px) {
          @puppyone csv { .theme-root { color: red } }
        }
      }
    `, { sourcePath: "nested.css" })).toThrow("top-level");
  });

  it("requires valid stable metadata and at least one target", () => {
    expect(() => parseSingleFileThemeCss(`
      @puppyone-theme { id: forest; name: Forest; version: 1.0.0; modes: light; }
      @puppyone markdown { .theme-root { color: #222 } }
    `)).toThrow("reverse-domain");
    expect(() => parseSingleFileThemeCss(metadata())).toThrow("at least one target");
  });
});

function metadata() {
  return "@puppyone-theme { id: com.example.test; name: Test; version: 1.0.0; modes: light dark; }";
}
