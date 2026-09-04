import { describe, expect, it, vi } from "vitest";
import { compileThemeCss } from "../electron/main/themes/theme-css-compiler.mjs";

describe("Sub Theme CSS compiler", () => {
  it("maps public Markdown tokens onto the host boundary", async () => {
    const result = await compileThemeCss({
      css: ":root { --po-md-content-color: #332f2a; --po-md-h1-size: 32px; --po-md-h1-weight: 700 }",
      themeId: "com.example.newsprint",
      target: "markdown",
    });

    const host = '[data-po-appearance-root][data-sub-theme-id="com.example.newsprint"]';
    expect(result.css).toContain(`${host} {`);
    expect(result.css).toContain("--po-host-md-content-color: #332f2a");
    expect(result.css).toContain("--po-host-md-h1-size: 32px");
    expect(result.css).toContain("--po-host-md-h1-weight: 700");
    expect(result.css).not.toContain("--po-md-content-color:");
  });

  it("maps public CSV tokens without exposing editor selectors", async () => {
    const result = await compileThemeCss({
      css: ".theme-root { --po-csv-surface-background: #fff; --po-editable-table-border: #ddd }",
      themeId: "com.example.spreadsheet",
      target: "csv",
    });

    expect(result.css).toContain("--po-host-csv-surface-background: #fff");
    expect(result.css).toContain("--po-host-csv-table-border: #ddd");
    expect(result.css).not.toMatch(/\.csv-table-editor|\.editable-table/);
  });

  it("maps bounded typography defaults onto a private theme layer", async () => {
    const result = await compileThemeCss({
      css: ":root { --po-text-size-content: 17px; --po-text-size-conversation: 15px; --po-terminal-font-size: 13px }",
      themeId: "com.example.readable",
      target: "typography",
      supportedModes: ["light", "dark"],
    });

    expect(result.css).toContain("--po-theme-text-size-content: 17px");
    expect(result.css).toContain("--po-theme-text-size-conversation: 15px");
    expect(result.css).toContain("--po-theme-terminal-font-size: 13px");
    expect(result.css).not.toContain("--po-text-size-content:");
  });

  it.each(["13.5px", "100px", "1rem", "calc(10px + 1vw)"])(
    "rejects unsafe or unbounded typography size %s",
    async (size) => {
      await expect(compileThemeCss({
        css: `:root { --po-text-size-content: ${size} }`,
        themeId: "com.example.unsafe-type",
        target: "typography",
      })).rejects.toThrow("plain pixel value");
    },
  );

  it.each(["1.5em", "23.5px", "clamp(20px, 3vw, 32px)"])(
    "rejects non-integer Markdown size %s",
    async (size) => {
      await expect(compileThemeCss({
        css: `:root { --po-md-h2-size: ${size} }`,
        themeId: "com.example.unsafe-markdown-type",
        target: "markdown",
      })).rejects.toThrow("plain integer pixel value");
    },
  );

  it("inlines package-local token imports", async () => {
    const loadImport = vi.fn(async (specifier) => {
      expect(specifier).toBe("./shared.css");
      return ":root { --po-md-link-color: #8b2f24 }";
    });
    const result = await compileThemeCss({
      css: '@charset "UTF-8"; @import "./shared.css";',
      themeId: "com.example.newsprint",
      target: "markdown",
      loadImport,
    });

    expect(loadImport).toHaveBeenCalledOnce();
    expect(result.css).toContain("--po-host-md-link-color: #8b2f24");
    expect(result.css).not.toContain("@charset");
    expect(result.css).not.toContain("@import");
  });

  it("limits application variants to the public color-token allowlist", async () => {
    const result = await compileThemeCss({
      css: ".theme-root { --po-surface-canvas: #101114; --po-text: #f7f7f8 }",
      themeId: "com.example.graphite",
      target: "application",
    });
    expect(result.css).toContain("--po-surface-canvas: #101114");

    await expect(compileThemeCss({
      css: ".theme-root { --po-font-ui: Papyrus }",
      themeId: "com.example.graphite",
      target: "application",
    })).rejects.toThrow("Application Sub Themes may only declare public color tokens");
  });

  it("derives mode-specific first paint only from opaque public canvas tokens", async () => {
    const result = await compileThemeCss({
      css: [
        ":root { --po-canvas: #abc; --po-surface-canvas: #ffffff }",
        ".dark .theme-root { --po-canvas: #101114; --po-surface-canvas: #101114 }",
      ].join("\n"),
      themeId: "com.example.first-paint",
      target: "application",
      supportedModes: ["light", "dark"],
    });

    expect(result.firstPaint).toEqual({
      light: { background: "#aabbcc", colorScheme: "light" },
      dark: { background: "#101114", colorScheme: "dark" },
    });

    const derived = await compileThemeCss({
      css: ":root { --po-canvas: var(--po-surface-editor) }",
      themeId: "com.example.derived-paint",
      target: "application",
      supportedModes: ["light"],
    });
    expect(derived).not.toHaveProperty("firstPaint");
  });

  it("supports root-level dark variants while retaining the same host boundary", async () => {
    const result = await compileThemeCss({
      css: ".theme-root.dark, .dark .theme-root { --po-surface-canvas: #111827 }",
      themeId: "com.example.forest",
      target: "application",
    });

    const host = '[data-po-appearance-root][data-sub-theme-id="com.example.forest"]:where(.dark)';
    expect(result.css).toBe(`${host}, ${host} { --po-surface-canvas: #111827 }`);
  });

  it("enforces declared Color Mode capabilities instead of allowing hidden mode branches", async () => {
    await expect(compileThemeCss({
      css: ".dark .theme-root { --po-surface-canvas: #111827 }",
      themeId: "com.example.light-only",
      target: "application",
      supportedModes: ["light"],
    })).rejects.toThrow("light-only Sub Theme cannot declare dark selectors");

    await expect(compileThemeCss({
      css: "@media (prefers-color-scheme: dark) { :root { --po-surface-canvas: #111827 } }",
      themeId: "com.example.system-query",
      target: "application",
      supportedModes: ["light", "dark"],
    })).rejects.toThrow("declared light/dark variants");

    await expect(compileThemeCss({
      css: ":root { --po-surface-canvas: #ffffff; --po-text: #111111 }",
      themeId: "com.example.incomplete-dual-mode",
      target: "application",
      supportedModes: ["light", "dark"],
    })).rejects.toThrow("must declare explicit dark root tokens");
  });

  it("prevents static application colors from leaking from light into dark mode", async () => {
    await expect(compileThemeCss({
      css: [
        ":root { --po-canvas: #ffffff; --po-surface-chrome: #f8f8f8; --po-header: #f5f5f5; --po-sidebar: #eeeeee; --po-text: #111111 }",
        ".dark .theme-root { --po-canvas: #111111 }",
      ].join("\n"),
      themeId: "com.example.leaking-shell",
      target: "application",
      supportedModes: ["light", "dark"],
    })).rejects.toThrow(
      "must override static color tokens in its dark variant: --po-header, --po-sidebar, --po-surface-chrome, --po-text",
    );

    const result = await compileThemeCss({
      css: [
        ":root { --po-canvas: #ffffff; --po-header: var(--po-surface-chrome); --po-sidebar: color-mix(in srgb, var(--po-surface-chrome) 40%, var(--po-surface-editor)); --po-text: light-dark(#111111, #f5f5f5) }",
        ".dark .theme-root { --po-canvas: #111111 }",
      ].join("\n"),
      themeId: "com.example.adaptive-shell",
      target: "application",
      supportedModes: ["light", "dark"],
    });
    expect(result.css).toContain("--po-header: var(--po-surface-chrome)");
    expect(result.css).toContain("--po-sidebar: color-mix(");
    expect(result.css).toContain("--po-text: light-dark(");
  });

  it.each([
    ":root h1 { --po-md-content-color: red }",
    ".cm-editor { --po-md-content-color: red }",
    ".markdown-codemirror-editor { --po-md-content-color: red }",
    ".theme-root + .outside { --po-md-content-color: red }",
    ".theme-root { color: red }",
    ".theme-root { --po-md-unknown-token: red }",
  ])("rejects CSS that crosses the semantic token contract: %s", async (css) => {
    await expect(compileThemeCss({
      css,
      themeId: "com.example.escape",
      target: "markdown",
    })).rejects.toThrow();
  });

  it.each([
    '@import url("https://example.com/theme.css");',
    '@font-face { font-family: Reader; src: url("./reader.woff2") }',
    ':global(body) { --po-md-content-color: red }',
    ':root { --po-md-h1-size: 4em !important }',
  ])("rejects unsupported or forceful CSS: %s", async (css) => {
    await expect(compileThemeCss({
      css,
      themeId: "com.example.newsprint",
      target: "markdown",
    })).rejects.toThrow();
  });
});
