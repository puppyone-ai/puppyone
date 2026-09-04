import { readFileSync, readdirSync } from "node:fs";
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
  TYPOGRAPHY_SCALE_METRICS,
  withTypographyFont,
  withTypographyScale,
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

    expect(migrated.version).toBe(10);
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
      version: 4,
      contentFont: { mode: "explicit", fontId: BUILTIN_FONT_IDS.systemSerif },
    })).contentFont).toEqual({ mode: "explicit", fontId: BUILTIN_FONT_IDS.systemSerif });
    expect(parseTypographyPreferences(JSON.stringify({
      version: 3,
      codeFontId: BUILTIN_FONT_IDS.geistMono,
    })).contentFont).toEqual({ mode: "follow-theme" });
    expect(parseTypographyPreferences(JSON.stringify({
      version: 4,
      contentFont: { mode: "explicit", fontId: "font-family: serif" },
    })).contentFont).toEqual({ mode: "follow-theme" });
  });

  it("coordinates semantic typography roles through four bounded surface scales", () => {
    expect(DEFAULT_TYPOGRAPHY_PREFERENCES.scales).toEqual({
      leftSidebar: "medium",
      header: "medium",
      editor: "medium",
      rightSidebar: "medium",
    });

    const preferences = withTypographyScale(withTypographyScale(withTypographyScale(
      withTypographyScale(DEFAULT_TYPOGRAPHY_PREFERENCES, "leftSidebar", "large"),
      "header",
      "small",
    ), "editor", "large"), "rightSidebar", "small");
    const props = createTypographyRootProps(resolveTypography(preferences));
    expect(props.style).toMatchObject({
      "--po-user-left-sidebar-font-size": "16px",
      "--po-user-left-sidebar-meta-font-size": "14px",
      "--po-user-left-sidebar-line-height": "21px",
      "--po-user-header-font-size": "14px",
      "--po-user-header-line-height": "19px",
      "--po-user-header-meta-font-size": "12px",
      "--po-user-header-meta-line-height": "17px",
      "--po-user-text-size-content": "16px",
      "--po-user-editor-line-height": "26px",
      "--po-user-text-size-data": "14px",
      "--po-user-code-font-size": "14px",
      "--po-user-editor-heading-1-font-size": "32px",
      "--po-user-editor-heading-2-font-size": "24px",
      "--po-user-editor-heading-3-font-size": "20px",
      "--po-user-editor-heading-4-font-size": "18px",
      "--po-user-editor-heading-5-font-size": "17px",
      "--po-user-editor-heading-6-font-size": "16px",
      "--po-user-text-size-conversation": "13px",
      "--po-user-right-sidebar-control-line-height": "18px",
      "--po-user-right-sidebar-meta-font-size": "12px",
      "--po-user-right-sidebar-meta-line-height": "18px",
      "--po-user-right-sidebar-caption-font-size": "11px",
      "--po-user-right-sidebar-caption-line-height": "16px",
      "--po-user-right-sidebar-micro-font-size": "10px",
      "--po-user-right-sidebar-micro-line-height": "14px",
      "--po-user-right-sidebar-code-font-size": "12px",
      "--po-user-terminal-font-size": "12px",
      "--po-user-right-sidebar-heading-1-font-size": "19px",
      "--po-user-right-sidebar-heading-2-font-size": "15px",
    });
    expect(props["data-typography-left-sidebar-scale"]).toBe("large");
    expect(props["data-typography-header-scale"]).toBe("small");
    expect(props["data-typography-editor-scale"]).toBe("large");
    expect(props["data-typography-right-sidebar-scale"]).toBe("small");
    expect(TYPOGRAPHY_SCALE_METRICS.medium).toEqual({
      leftSidebar: {
        content: 14,
        meta: 12,
        lineHeight: 19,
      },
      header: {
        content: 15,
        lineHeight: 20,
        meta: 13,
        metaLineHeight: 18,
      },
      editor: {
        content: 15,
        lineHeight: 24,
        data: 13,
        code: 13,
        heading1: 30,
        heading2: 23,
        heading3: 19,
        heading4: 17,
        heading5: 16,
        heading6: 15,
      },
      rightSidebar: {
        content: 14,
        controlLineHeight: 19,
        meta: 13,
        metaLineHeight: 19,
        caption: 12,
        captionLineHeight: 17,
        micro: 11,
        microLineHeight: 15,
        code: 13,
        terminal: 13,
        heading1: 20,
        heading2: 16,
      },
    });

    const migrated = parseTypographyPreferences(JSON.stringify({
      version: 5,
      sizes: {
        content: { mode: "explicit", sizePx: 18 },
        conversation: { mode: "explicit", sizePx: 13 },
        monospace: { mode: "explicit", sizePx: 14 },
      },
    }));
    expect(migrated.scales).toEqual({
      leftSidebar: "medium",
      header: "medium",
      editor: "large",
      rightSidebar: "small",
    });

    const normalized = parseTypographyPreferences(JSON.stringify({
      version: 10,
      scales: {
        leftSidebar: "large",
        header: "small",
        editor: "custom",
        rightSidebar: "large",
      },
    }));
    expect(normalized.scales).toEqual({
      leftSidebar: "large",
      header: "small",
      editor: "medium",
      rightSidebar: "large",
    });

    const migratedV9 = parseTypographyPreferences(JSON.stringify({
      version: 9,
      scales: {
        leftSidebar: "large",
        fileTree: "small",
        header: "large",
        editor: "small",
        rightSidebar: "large",
      },
    }));
    expect(migratedV9.scales).toEqual({
      leftSidebar: "small",
      header: "large",
      editor: "small",
      rightSidebar: "large",
    });

    const migratedV6 = parseTypographyPreferences(JSON.stringify({
      version: 6,
      contentFont: { mode: "follow-theme" },
      scales: { editor: "small", rightSidebar: "large" },
    }));
    expect(migratedV6.scales).toEqual({
      leftSidebar: "medium",
      header: "medium",
      editor: "small",
      rightSidebar: "large",
    });

    const migratedV7 = parseTypographyPreferences(JSON.stringify({
      version: 7,
      contentFont: { mode: "follow-theme" },
      scales: { appChrome: "large", editor: "small", rightSidebar: "large" },
    }));
    expect(migratedV7.scales).toEqual({
      leftSidebar: "large",
      header: "large",
      editor: "small",
      rightSidebar: "large",
    });

    const migratedV8 = parseTypographyPreferences(JSON.stringify({
      version: 8,
      contentFont: { mode: "follow-theme" },
      scales: {
        leftSidebar: "small",
        header: "large",
        editor: "large",
        rightSidebar: "small",
      },
    }));
    expect(migratedV8.scales).toEqual({
      leftSidebar: "small",
      header: "large",
      editor: "large",
      rightSidebar: "small",
    });
  });

  it("keeps every product-owned font size on the integer type scale", () => {
    for (const metrics of Object.values(TYPOGRAPHY_SCALE_METRICS)) {
      expect(Object.values(metrics.leftSidebar).every(Number.isInteger)).toBe(true);
      expect(Object.values(metrics.header).every(Number.isInteger)).toBe(true);
      expect(Object.values(metrics.editor).every(Number.isInteger)).toBe(true);
      expect(Object.values(metrics.rightSidebar).every(Number.isInteger)).toBe(true);
    }

    const fractionalCssTypeSize = /(?:font-size|--[\w-]*(?:font|text|type|heading|md-h\d)[\w-]*size)\s*:[^;\n}]*\d+\.\d+(?:px|em|rem|pt|vw)/i;
    const fractionalInlineTypeSize = /fontSize\s*[:=]\s*(?:["'{]\s*)?\d+\.\d+/;
    const relativeCssTypeSize = /font-size\s*:\s*(?:inherit|smaller|larger|[^;\n}]*(?:\d+(?:\.\d+)?(?:em|rem|%)|calc\())/i;
    const undersizedCssText = /font-size\s*:\s*[1-9]px/i;
    const roots = ["src", "packages", "electron", "local-api", "sub-themes", "public"];
    for (const root of roots) {
      for (const file of sourceFiles(new URL(`../${root}/`, import.meta.url))) {
        const contents = readFileSync(file, "utf8");
        expect(contents, file.pathname).not.toMatch(fractionalCssTypeSize);
        expect(contents, file.pathname).not.toMatch(fractionalInlineTypeSize);
        expect(contents, file.pathname).not.toMatch(relativeCssTypeSize);
        expect(contents, file.pathname).not.toMatch(undersizedCssText);
      }
    }

    const foundations = source("src/styles/typography/foundations.css");
    expect(foundations).toMatch(/small\s*\{[^}]*font-size:\s*var\(--po-type-ui-meta, 12px\)/s);
  });

  it("keeps Right sidebar text sizes behind semantic typography roles", () => {
    const roots = [
      "src/features/desktop-agent",
      "src/features/desktop-terminal",
      "src/features/app-shell/auxiliary-workbench",
    ];
    const directPixelTextSize = /(?:font-size|font)\s*:\s*\d+(?:\.\d+)?px/i;

    for (const root of roots) {
      for (const file of sourceFiles(new URL(`../${root}/`, import.meta.url))) {
        if (!file.pathname.endsWith(".css")) continue;
        expect(readFileSync(file, "utf8"), file.pathname).not.toMatch(directPixelTextSize);
      }
    }
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
    const editableTable = source("packages/shared-ui/src/styles/editor/editable-table.css");
    const officePreview = source("packages/shared-ui/src/styles/editor/media-office-preview.css");
    const agentTranscript = source("src/features/desktop-agent/ui/styles/transcript.css");
    const agentActivities = source("src/features/desktop-agent/ui/styles/activities.css");
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
    expect(foundations).toContain("var(--po-theme-text-size-content, 16px)");
    expect(foundations).toContain("--po-type-ui-control:");
    expect(foundations).toContain("--po-type-left-sidebar-content:");
    expect(foundations).toContain("--po-type-header-content:");
    expect(foundations).toContain("--po-type-editor-data:");
    expect(foundations).toContain("--po-type-right-sidebar-meta:");
    expect(foundations).toContain("--po-type-right-sidebar-caption:");
    expect(foundations).toContain("--po-type-right-sidebar-micro:");
    expect(foundations).toContain("--po-right-sidebar-code-font-size:");
    expect(foundations).toContain("--po-user-text-size-conversation");
    expect(foundations).toContain("--po-text-weight-medium: 500;");
    expect(foundations).toContain("--po-content-reading-line-height: var(--po-type-editor-line-height, 24px);");
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
    expect(plainText).toContain("font-size: var(--po-text-size-content, 16px);");
    expect(plainText).toContain("font-weight: var(--po-text-weight-medium);");
    expect(source("src/features/data-workspace/browser.css"))
      .toContain("--po-tree-row-font-size: var(--po-type-left-sidebar-content);");
    expect(source("src/features/data-workspace/browser.css"))
      .toContain("--po-tree-workspace-group-font-size: var(--po-type-left-sidebar-content);");
    expect(editableTable).toContain("--po-editable-table-font-size: var(--po-type-editor-data");
    expect(officePreview).toContain("--office-sheet-default-font-size: var(--po-type-editor-data");
    expect(officePreview).toContain("font-size: var(--po-type-editor-content");
    expect(agentTranscript).toContain("font-family: var(--po-font-content, var(--po-font-sans));");
    expect(agentTranscript).toContain("font-size: var(--agent-conversation-font-size);");
    expect(agentTranscript).toContain("font-size: var(--agent-font-size-meta);");
    expect(agentActivities).toContain("font-size: var(--agent-code-font-size);");
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

function sourceFiles(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "dist") return [];
    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) return sourceFiles(child);
    return /\.(?:css|ts|tsx|js|jsx|mjs|cjs|html|svg)$/.test(entry.name) ? [child] : [];
  });
}
