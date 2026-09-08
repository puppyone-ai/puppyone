import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("appearance surface boundary", () => {
  it("keeps Root/Sub Theme identity in the product shell and out of shared editors", () => {
    const app = source("src/App.tsx");
    const markdown = source("packages/shared-ui/src/editor/markdown/MarkdownCodeMirrorEditor.tsx");
    const csv = source("packages/shared-ui/src/editor/viewers/csv/CsvTableEditor.tsx");
    const onboarding = source("src/components/MinimalOnboarding.tsx");
    const assetHome = source("src/components/AssetLibraryHome.tsx");
    const restoring = source("src/features/app-shell/RestoringWorkspaceScreen.tsx");
    const context = source("packages/shared-ui/src/core/appearance/EditorAppearanceContext.tsx");
    const runtime = source("src/features/appearance/AppearanceRuntime.tsx");

    expect(app).toContain("<SurfaceAppearanceProvider value={surfaceAppearance}>");
    expect(app).toContain("...surfaceAppearance.rootProps");
    expect(runtime).toContain("<EditorAppearanceProvider revision={value.revision}>");
    expect(runtime).toContain('"data-po-appearance-root": "true"');
    expect(runtime).toContain('"data-root-theme-id": appearance.rootThemeId');
    expect(runtime).toContain('"data-sub-theme-id": appearance.subThemeId');
    for (const appearanceRoot of [onboarding, assetHome, restoring]) {
      expect(appearanceRoot).toContain("appearance.rootProps");
      expect(appearanceRoot).not.toContain("createTypographyRootProps");
      expect(appearanceRoot).not.toContain("data-sub-theme-id={subThemeId}");
    }

    expect(context).toContain("EditorAppearanceProvider");
    expect(context).toContain("useEditorAppearanceRevision");
    expect(context).not.toMatch(/ThemeCatalog|SubThemeDefinition|rootThemeId|subThemeId/);
    for (const editor of [markdown, csv]) {
      expect(editor).not.toContain("data-po-appearance-root");
      expect(editor).not.toContain("data-root-theme-id");
      expect(editor).not.toContain("data-sub-theme-id");
      expect(editor).not.toContain("useThemeSurfaceId");
    }
    expect(markdown).toContain("useEditorAppearanceRevision");
    expect(csv).toContain("useEditorAppearanceRevision");
  });

  it("projects product styles through public host tokens consumed by editor-owned CSS", () => {
    const markdownCss = source("packages/shared-ui/src/styles/editor/markdown-content.css");
    const csvCss = source("packages/shared-ui/src/styles/editor/csv-table-editor.css");
    const compiler = source("electron/main/themes/theme-css-compiler.mjs");

    expect(markdownCss).toContain("--po-host-md-content-color");
    expect(markdownCss).toContain("--po-user-md-h1-size");
    expect(csvCss).toContain("--po-host-csv-surface-background");
    expect(compiler).toContain('["--po-md-content-color", "--po-host-md-content-color"]');
    expect(compiler).toContain('["--po-csv-surface-background", "--po-host-csv-surface-background"]');
    expect(compiler).toContain("may only declare root-level public tokens");
  });

  it("projects the complete Markdown syntax palette through public host tokens", () => {
    const markdownCss = source("packages/shared-ui/src/styles/editor/markdown-content.css");
    const compiler = source("electron/main/themes/theme-css-compiler.mjs");
    const semanticTokens = [
      "constant",
      "special",
      "type",
      "function",
      "property",
      "operator",
      "meta",
    ];

    for (const token of semanticTokens) {
      expect(compiler).toContain(
        `["--po-md-syntax-${token}", "--po-host-md-syntax-${token}"]`,
      );
      expect(markdownCss).toContain(`--po-host-md-syntax-${token}`);
    }
  });

  it("loads built-in Sub Theme CSS through the runtime host without private editor selectors", () => {
    const styles = source("src/styles.css");
    const registry = source("src/features/themes/builtinSubThemes.ts");
    const generated = source("src/features/themes/builtinSubThemes.generated.ts");
    const themeFiles = [
      "default-neutral",
      "default-warm",
      "default-graphite",
      "default-github",
      "default-newspaper",
      "windows-xp-luna-blue",
    ].map((name) => `sub-themes/${name}/theme.css`);

    expect(themeFiles.map((path) => existsSync(new URL(`../${path}`, import.meta.url))))
      .toEqual([true, true, true, true, true, true]);
    expect(existsSync(new URL("../src/styles/default.css", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../src/styles/github.css", import.meta.url))).toBe(false);
    expect(existsSync(new URL("../src/styles/newspaper.css", import.meta.url))).toBe(false);
    expect(styles).not.toContain("github.css");
    expect(styles).not.toContain("newspaper.css");
    expect(registry).toContain("./builtinSubThemes.generated");
    expect(registry).not.toContain("?raw");

    for (const path of themeFiles) {
      const css = source(path);
      expect(css).toContain("@puppyone-theme");
      expect(css).toContain("@puppyone ");
      expect(css).not.toMatch(/\.cm-|\.markdown-codemirror-editor|\.csv-table-editor/);
      expect(css).not.toContain("--po-host-");
    }
    expect(generated).toContain('[data-po-appearance-root][data-sub-theme-id=\\"default.github\\"]');
    expect(generated).toContain("--po-host-md-content-color");
  });

  it("gives Markdown-focused built-in themes a complete syntax palette in both modes", () => {
    const semanticTokens = [
      "keyword",
      "string",
      "comment",
      "constant",
      "special",
      "type",
      "function",
      "property",
      "operator",
      "meta",
    ];

    for (const name of ["default-github", "default-newspaper"]) {
      const css = source(`sub-themes/${name}/theme.css`);
      for (const token of semanticTokens) {
        expect(css.match(new RegExp(`--po-md-syntax-${token}:`, "g"))).toHaveLength(2);
      }
    }
  });

  it("keeps every Markdown-focused syntax color at accessible text contrast", () => {
    for (const name of ["default-github", "default-newspaper"]) {
      const css = source(`sub-themes/${name}/theme.css`);
      const backgrounds = [...css.matchAll(/--po-md-code-block-background:\s*(#[0-9a-f]{6})/gi)]
        .map((match) => match[1]);
      const syntaxColors = [...css.matchAll(/--po-md-syntax-[\w-]+:\s*(#[0-9a-f]{6})/gi)]
        .map((match) => match[1]);
      expect(backgrounds).toHaveLength(2);
      expect(syntaxColors).toHaveLength(20);

      for (let mode = 0; mode < 2; mode += 1) {
        for (const color of syntaxColors.slice(mode * 10, mode * 10 + 10)) {
          expect(contrastRatio(backgrounds[mode], color)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("keeps product fonts outside the untrusted Sub Theme CSS contract", () => {
    const foundations = source("src/styles/typography/foundations.css");
    expect(foundations).toContain('font-family: "PuppyOne Open Sans"');
    expect(foundations).toContain('font-family: "PuppyOne PT Serif"');
    for (const name of ["default-github", "default-newspaper"]) {
      expect(source(`sub-themes/${name}/theme.css`)).not.toContain("@font-face");
    }
  });
});

function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05)
    / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

function relativeLuminance(color: string): number {
  const channels = [1, 3, 5].map((offset) => (
    Number.parseInt(color.slice(offset, offset + 2), 16) / 255
  )).map((channel) => (
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
