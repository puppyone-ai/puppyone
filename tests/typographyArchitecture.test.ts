import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_FONT_CATALOG,
  BUILTIN_FONT_IDS,
  DEFAULT_TYPOGRAPHY_PREFERENCES,
  createCatalogFontFamily,
  createTypographyRootProps,
  getFontCatalogEntries,
  isValidFontCatalogEntry,
  parseTypographyPreferences,
  resolveTypography,
  withTypographyFont,
  type FontCatalogEntry,
} from "../src/features/typography";

describe("typography architecture", () => {
  it("discards legacy UI font preferences and pins the runtime UI font to the product default", () => {
    const migrated = parseTypographyPreferences(JSON.stringify({
      version: 2,
      uiFontId: BUILTIN_FONT_IDS.systemSans,
      contentFontId: "theme",
      codeFontId: BUILTIN_FONT_IDS.geistMono,
      terminalFontId: BUILTIN_FONT_IDS.terminalSystemMono,
    }));

    expect(migrated.version).toBe(4);
    expect(migrated).not.toHaveProperty("uiFontId");
    expect(resolveTypography(migrated).ui.id).toBe(BUILTIN_FONT_IDS.geistSans);
  });

  it("defaults content typography to Theme and migrates the legacy default font", () => {
    expect(DEFAULT_TYPOGRAPHY_PREFERENCES.contentFont).toEqual({ mode: "follow-theme" });
    expect(parseTypographyPreferences(JSON.stringify({
      version: 1,
      uiFontId: BUILTIN_FONT_IDS.geistSans,
      contentFontId: BUILTIN_FONT_IDS.geistSans,
      codeFontId: BUILTIN_FONT_IDS.geistMono,
      terminalFontId: BUILTIN_FONT_IDS.terminalSystemMono,
    })).contentFont).toEqual({ mode: "follow-theme" });
    expect(parseTypographyPreferences(JSON.stringify({
      version: 2,
      contentFontId: BUILTIN_FONT_IDS.geistSans,
      codeFontId: BUILTIN_FONT_IDS.geistMono,
      terminalFontId: BUILTIN_FONT_IDS.terminalSystemMono,
    })).contentFont).toEqual({ mode: "follow-theme" });
    expect(parseTypographyPreferences(JSON.stringify({
      version: 1,
      contentFontId: BUILTIN_FONT_IDS.systemSerif,
    })).contentFont).toEqual({ mode: "explicit", fontId: BUILTIN_FONT_IDS.systemSerif });
    expect(parseTypographyPreferences(JSON.stringify({
      version: 3,
      contentFontId: BUILTIN_FONT_IDS.geistSans,
      codeFontId: BUILTIN_FONT_IDS.geistMono,
      terminalFontId: BUILTIN_FONT_IDS.terminalSystemMono,
    })).contentFont).toEqual({ mode: "explicit", fontId: BUILTIN_FONT_IDS.geistSans });
    expect(parseTypographyPreferences(JSON.stringify({
      version: 4,
      contentFont: { mode: "follow-theme" },
    })).contentFont).toEqual({ mode: "follow-theme" });
    expect(parseTypographyPreferences(JSON.stringify({
      version: 3,
      codeFontId: BUILTIN_FONT_IDS.geistMono,
    })).contentFont).toEqual({ mode: "follow-theme" });
    expect(parseTypographyPreferences(JSON.stringify({
      version: 4,
      contentFont: { mode: "explicit", fontId: "font-family: serif" },
    })).contentFont).toEqual({ mode: "follow-theme" });
  });

  it("keeps preferences source-agnostic and resolves unavailable fonts safely", () => {
    const importedId = "imported:9f2b2dc0-regular";
    const preferences = parseTypographyPreferences(JSON.stringify({
      version: 1,
      uiFontId: BUILTIN_FONT_IDS.geistSans,
      contentFontId: importedId,
      codeFontId: BUILTIN_FONT_IDS.geistMono,
    }));

    expect(preferences.contentFont).toEqual({ mode: "explicit", fontId: importedId });
    expect(resolveTypography(preferences).editorContentDecision).toMatchObject({
      effectiveFontId: BUILTIN_FONT_IDS.geistSans,
      source: "fallback",
    });

    const importedEntry: FontCatalogEntry = {
      id: importedId,
      label: "Imported reading font",
      description: "Test font",
      family: '"PuppyOne Imported 9f2b2dc0"',
      category: "serif",
      source: "imported",
      roles: ["content"],
    };
    const resolved = resolveTypography(preferences, [...BUILTIN_FONT_CATALOG, importedEntry]);
    expect(resolved.content.id).toBe(BUILTIN_FONT_IDS.geistSans);
    expect(resolved.editorContentOverride).toBe(importedEntry);
    expect(createTypographyRootProps(resolved)).toMatchObject({
      "data-font-content": BUILTIN_FONT_IDS.geistSans,
      "data-font-content-category": "sans",
      "data-font-editor-content-mode": "explicit",
      "data-font-editor-content": importedId,
      style: {
        "--po-font-content-primary": '"Geist Sans"',
        "--po-font-editor-content-user": expect.stringContaining(importedEntry.family),
      },
    });
  });

  it("changes one semantic role without coupling the other typography roles", () => {
    const defaults = resolveTypography(DEFAULT_TYPOGRAPHY_PREFERENCES);
    expect(defaults.ui.family).toContain('"Geist Sans"');
    expect(defaults.content.family).toBe('"Geist Sans"');
    expect(defaults.content.category).toBe("sans");
    expect(defaults.content.family).toBe(defaults.ui.family);
    expect(defaults.editorContentOverride).toBeNull();
    expect(createTypographyRootProps(defaults).style)
      .not.toHaveProperty("--po-font-editor-content-user");
    expect(defaults.code.family).toContain('"Geist Mono"');
    expect(defaults.code.category).toBe("monospace");
    expect(defaults.terminal.family).toBe(
      '"SF Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono"',
    );
    expect(createCatalogFontFamily(defaults.content)).toBe(
      '"Geist Sans", var(--po-font-locale-sans), var(--po-font-emoji), sans-serif',
    );

    const next = withTypographyFont(
      DEFAULT_TYPOGRAPHY_PREFERENCES,
      "content",
      BUILTIN_FONT_IDS.systemSerif,
    );

    expect(next).toEqual({
      ...DEFAULT_TYPOGRAPHY_PREFERENCES,
      contentFont: { mode: "explicit", fontId: BUILTIN_FONT_IDS.systemSerif },
    });
    const explicit = resolveTypography(next);
    expect(explicit.editorContentOverride?.id).toBe(BUILTIN_FONT_IDS.systemSerif);
    expect(createTypographyRootProps(explicit).style)
      .toHaveProperty("--po-font-editor-content-user");
    expect(getFontCatalogEntries("content").map((font) => font.id)).toEqual([
      BUILTIN_FONT_IDS.geistSans,
      BUILTIN_FONT_IDS.systemSans,
      BUILTIN_FONT_IDS.systemSerif,
    ]);
    expect(getFontCatalogEntries("code").map((font) => font.id)).toEqual([
      BUILTIN_FONT_IDS.geistMono,
    ]);
    expect(getFontCatalogEntries("terminal").map((font) => font.id)).toEqual([
      BUILTIN_FONT_IDS.terminalSystemMono,
    ]);
  });

  it("rejects CSS-like IDs before they can reach the font resolver", () => {
    const parsed = parseTypographyPreferences(JSON.stringify({
      version: 1,
      uiFontId: "url(https://example.invalid/font.woff2)",
      contentFontId: "font-family: serif",
      codeFontId: "../../font.ttf",
    }));
    expect(parsed).toEqual(DEFAULT_TYPOGRAPHY_PREFERENCES);
    expect(isValidFontCatalogEntry({
      id: "imported:unsafe",
      label: "Unsafe",
      description: "Unsafe test entry",
      family: "url(https://example.invalid/font.woff2)",
      category: "sans",
      source: "imported",
      roles: ["content"],
    })).toBe(false);
    expect(isValidFontCatalogEntry({
      id: "imported:token-hijack",
      label: "Unsafe variable",
      description: "Unsafe test entry",
      family: "var(--po-font-ui)",
      category: "sans",
      source: "imported",
      roles: ["content"],
    })).toBe(false);
  });

  it("binds content surfaces and metric-sensitive consumers to semantic contracts", () => {
    const styles = source("src/styles.css");
    const foundations = source("src/styles/typography/foundations.css");
    const locales = source("src/styles/typography/locales.css");
    const roles = source("src/styles/typography/roles.css");
    const base = source("src/styles/base.css");
    const markdown = source("packages/shared-ui/src/styles/editor/markdown-editor.css");
    const markdownContent = source("packages/shared-ui/src/styles/editor/markdown-content.css");
    const plainText = source("packages/shared-ui/src/styles/editor/editor-chrome.css");
    const agentTranscript = source("src/features/desktop-agent/ui/styles/transcript.css");
    const terminalAppearance = source("src/features/desktop-terminal/runtime/terminalAppearance.ts");
    const terminalAppearanceSync = source("src/features/desktop-terminal/runtime/useTerminalAppearanceSync.ts");
    const overlayPortal = source("src/features/app-shell/DesktopOverlayPortal.tsx");
    const markdownEditor = source("packages/shared-ui/src/editor/markdown/MarkdownCodeMirrorEditor.tsx");
    const codeEditor = source("packages/shared-ui/src/editor/viewers/code/CodeMirrorCodeEditor.tsx");
    const plainTextEditor = source("packages/shared-ui/src/editor/viewers/code/PlainTextEditor.tsx");
    const agentMarkdown = source("src/features/desktop-agent/ui/markdown/AgentMarkdownDocument.tsx");
    const typographyRuntime = source("src/features/typography/typographyRuntime.ts");
    const appearanceRuntime = source("src/features/appearance/AppearanceRuntime.tsx");
    const app = source("src/App.tsx");

    expect(styles).toContain('@import "./styles/typography/foundations.css" layer(tokens);');
    expect(styles).toContain('@import "./styles/typography/locales.css" layer(tokens);');
    expect(styles).toContain('@import "./styles/typography/roles.css" layer(tokens);');
    expect(foundations).toContain('font-family: "Geist Sans";');
    expect(foundations).toContain("--po-text-size-content: 14px;");
    expect(foundations).toContain("--po-text-weight-medium: 500;");
    expect(foundations).toContain("--po-content-reading-line-height: 1.7142857143;");
    expect(foundations).toContain("--po-content-reading-letter-spacing: 0;");
    expect(roles).toContain("--po-font-ui-primary: \"Geist Sans\";");
    expect(roles).toContain("--po-font-content-primary: \"Geist Sans\";");
    expect(roles).toContain("--po-font-code-primary: \"Geist Mono\";");
    expect(roles).toContain("--po-font-content: var(--po-font-content-primary), var(--po-font-content-fallback);");
    expect(roles).toContain("--po-font-content-fallback: var(--po-font-locale-sans), var(--po-font-emoji), sans-serif;");
    expect(roles).toContain("--po-font-sans: var(--po-font-ui);");
    expect(roles).toContain("--po-font-mono: var(--po-font-code);");
    expect(locales).toContain(':lang(zh-Hans)');
    expect(locales).toContain(':lang(zh-Hant)');
    expect(locales).toContain(':lang(ja)');
    expect(locales).toContain(':lang(ko)');
    expect(locales).toContain('"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC"');
    expect(locales).not.toContain('"Noto Sans CJK SC", sans-serif');
    expect(locales).toContain('"Hiragino Sans", "Yu Gothic", "Meiryo", "Noto Sans CJK JP"');
    expect(locales).toContain('"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK KR"');
    expect(locales).toContain("--po-content-reading-weight: 500;");
    expect(locales).not.toContain("--po-content-reading-letter-spacing:");
    expect(locales).not.toContain("--po-content-reading-line-height:");
    expect(base).toContain("font-feature-settings: normal;");
    expect(base).not.toContain("'cv02'");
    expect(markdownContent).toContain("--po-md-content-font-primary: var(--po-font-content-primary");
    expect(markdownContent).toContain("--po-md-content-font-fallback: var(--po-font-content-fallback");
    expect(markdownContent).toContain("--po-md-content-font: var(--po-host-md-content-font, var(--po-md-content-font-primary), var(--po-md-content-font-fallback));");
    expect(markdownContent).toContain("--po-editor-content-font: var(--po-font-editor-content-user, var(--po-md-content-font));");
    expect(markdownContent).toContain('[data-font-editor-content-mode="explicit"]');
    expect(markdownContent).toContain("font-family: var(--po-font-editor-content-user) !important;");
    expect(markdownContent).toContain(".cm-line:not(.cm-md-code-block-line)");
    expect(markdownContent).toContain('[data-po-theme-surface="markdown"] .cm-md-inline-code,');
    expect(markdownContent).toContain('[data-po-theme-surface="markdown"] .cm-md-code-textarea,');
    expect(markdownContent).toContain("font-family: var(--po-font-code) !important;");
    expect(markdown).toContain("font-family: var(--po-editor-content-font);");
    expect(markdown).toContain("font-weight: var(--po-md-content-weight);");
    expect(markdown).toContain("font-feature-settings: normal;");
    expect(plainText).toContain("font-family: var(--po-font-editor-content-user, var(--po-font-content, var(--po-font-sans)));");
    expect(plainText).toContain("font-size: var(--po-text-size-content, 14px);");
    expect(plainText).toContain("font-weight: var(--po-text-weight-medium);");
    expect(agentTranscript).toContain("font-family: var(--po-font-content, var(--po-font-sans));");
    expect(terminalAppearance).toContain('getPropertyValue("--po-font-terminal")');
    expect(terminalAppearance).toContain('getPropertyValue("--po-terminal-font-size")');
    expect(terminalAppearanceSync).toContain("subscribeTypographyChanges(document, applyAppearance)");
    expect(terminalAppearanceSync).toContain('"data-sub-theme-id"');
    expect(markdownEditor).toContain("subscribeTypographyChanges(host.ownerDocument");
    expect(markdownEditor).toContain('data-po-typography-role="content"');
    expect(markdownEditor).toContain("lang={contentLanguage.language}");
    expect(markdownEditor).toContain("resolveMarkdownContentLanguage(value, locale, documentLanguage)");
    expect(codeEditor).toContain("subscribeTypographyChanges(host.ownerDocument");
    expect(codeEditor).toContain('data-po-typography-role="code"');
    expect(plainTextEditor).toContain('data-po-typography-role="content"');
    expect(agentMarkdown).toContain('data-po-typography-role="content"');
    expect(typographyRuntime).toContain('"--po-font-content-primary": resolved.content.family');
    expect(typographyRuntime).toContain('"--po-font-editor-content-user"');
    expect(typographyRuntime).not.toContain('"--po-font-content": resolved.content.family');
    expect(app).toContain("fontCatalog,\n    locale,");
    expect(appearanceRuntime).toContain('"data-content-text-size": appearance.textSize');
    expect(appearanceRuntime).toContain("SurfaceAppearanceProvider");
    expect(app).toContain("...surfaceAppearance.rootProps");
    expect(app).not.toContain("data-interface-text-size={textSize}");
    expect(app).not.toContain("data-terminal-text-size={textSize}");
    expect(app).not.toContain("data-text-size={textSize}");
    expect(terminalAppearanceSync).not.toContain('"data-terminal-text-size"');
    expect(terminalAppearanceSync).not.toContain('"data-text-size"');
    expect(overlayPortal).toContain("applySurfaceAppearanceToElement(root, appearance)");
    expect(overlayPortal).not.toContain("root.dataset.interfaceTextSize");
    expect(overlayPortal).not.toContain("root.dataset.terminalTextSize");
    expect(overlayPortal).not.toContain("root.dataset.textSize");
  });
});

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}
