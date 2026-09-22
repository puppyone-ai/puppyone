import { describe, expect, it } from "vitest";
import { compileThemeCss } from "../../../../electron/main/themes/theme-css-compiler.mjs";

const compile = (css, target = "application") => compileThemeCss({
  css, target, themeId: "com.example.selection",
});

describe("theme selection color contract", () => {
  it("keeps old themes valid and derives an inactive color from an explicit active override", async () => {
    expect((await compile(":root { --po-accent: #9750dd }")).css).not.toContain("--po-text-selection-bg:");
    const result = await compile(":root { --po-text-selection-bg: color-mix(in srgb, var(--po-accent) 25%, transparent) }");
    expect(result.css).toContain("--po-text-selection-inactive-bg: color-mix(in srgb, var(--po-text-selection-bg) var(--po-text-selection-inactive-ratio), transparent)");
  });

  it.each(["markdown", "csv"])("projects %s overrides and color references together", async (target) => {
    const domain = target === "markdown" ? "md" : "csv";
    const color = `--po-${domain}-surface-${domain === "md" ? "background" : "color"}`;
    const result = await compile(`:root { ${color}: #765432; --po-${domain}-selection-bg: var(${color}) }`, target);
    expect(result.css).toContain(`--po-host-${domain}-selection-bg: var(--po-host-${domain}-surface-`);
    expect(result.css).toContain(`--po-host-${domain}-selection-inactive-bg: color-mix(in srgb, var(--po-host-${domain}-selection-bg)`);
  });

  it("preserves explicit inactive colors and the existing terminal override", async () => {
    const result = await compile(":root { --po-terminal-selection: #abcdef; --po-terminal-selection-inactive: #ccddee }");
    expect(result.css).toContain("--po-terminal-selection-inactive: #ccddee");
    expect(result.css).not.toContain("color-mix");
  });

  it("projects real domain references without rewriting quoted font names", async () => {
    const result = await compile(':root { --po-md-content-font: "var(--po-md-link-color)"; --po-md-selection-bg: var(--po-md-link-color, #abcdef) }', "markdown");
    expect(result.css).toContain('"var(--po-md-link-color)"');
    expect(result.css).toContain("var(--po-host-md-link-color, #abcdef)");
  });

  it.each([
    "banana", "12px", "rgb(nope)", "url(./paint.png)", "inherit", "initial",
    "Highlight", "AccentColor", "color-mix(in srgb, Highlight 20%, transparent)",
    "var(--po-unknown)", "var(--po-text-selection-bg)",
    "var(--po-accent, Highlight)", "device-cmyk(0 0 0 1)",
  ])("rejects invalid or system-dependent selection value %s", async (value) => {
    await expect(compile(`:root { --po-text-selection-bg: ${value} }`)).rejects.toThrow();
  });

  it("checks dependencies even when the theme relies on the default selection recipe", async () => {
    await expect(compile(":root { --po-accent: var(--po-text-selection-bg) }")).rejects.toThrow("cycle");
    await expect(compile(":root { --po-accent: AccentColor }")).rejects.toThrow("operating-system");
    await expect(compile(":root { --po-accent: 100px }")).rejects.toThrow("CSS color");
  });

  it("requires a defined or fallback domain color rather than emitting an unresolved var", async () => {
    await expect(compile("@media (min-width: 1000px) { :root { --po-md-link-color: red } } :root { --po-md-selection-bg: var(--po-md-link-color) }", "markdown"))
      .rejects.toThrow("value or fallback");
    await expect(compile(":root { --po-text-selection-inactive-bg: var(--po-terminal-selection-inactive) }"))
      .rejects.toThrow("value or fallback");
    expect((await compile(":root { --po-text-selection-inactive-bg: var(--po-terminal-selection-inactive, #abcdef) }")).css)
      .toContain("var(--po-terminal-selection-inactive, #abcdef)");
    expect((await compile(":root { --po-terminal-selection: #abcdef; --po-text-selection-inactive-bg: var(--po-terminal-selection-inactive) }")).css)
      .toContain("--po-terminal-selection-inactive: color-mix");
    await expect(compile(":root { --po-md-selection-bg: var(--po-md-link-color) }", "markdown"))
      .rejects.toThrow("value or fallback");
    expect((await compile(":root { --po-md-selection-bg: var(--po-md-link-color, #abcdef) }", "markdown")).css)
      .toContain("var(--po-host-md-link-color, #abcdef)");
  });

  it("rejects a color cycle confined to dark mode and invalid conditional values", async () => {
    await expect(compile("@media (min-width: 1px) { :root { --po-accent: Highlight } } :root { --po-accent: #123456 }"))
      .rejects.toThrow("operating-system");
    await expect(compile(":root { --po-text-selection-bg: #123456 } .dark .theme-root { --po-text-selection-bg: var(--po-accent); --po-accent: var(--po-text-selection-bg) }"))
      .rejects.toThrow("cycle");
    await expect(compile("@media (min-width: 1px) { :root { --po-text-selection-bg: Highlight } } :root { --po-text-selection-bg: #123456 }"))
      .rejects.toThrow("operating-system");
  });
});
