import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_FONT_CATALOG,
  BUILTIN_FONT_IDS,
  DEFAULT_TYPOGRAPHY_PREFERENCES,
  buildTypographyCustomProperties,
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
  it("rebinds scale-derived control geometry at each appearance boundary", () => {
    const tokens = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
    expect(tokens).toMatch(
      /:where\(\.app-shell,[^}]+--desktop-sidebar-row-height:\s*var\(--po-control-size\);/s,
    );
    expect(tokens).toMatch(
      /:where\(\.app-shell,[^}]+--desktop-sidebar-virtual-row-size:\s*calc\(var\(--desktop-sidebar-row-height\) \+ 2px\);/s,
    );
  });

  it("discards legacy UI font preferences and pins the runtime UI font to the product default", () => {
    const migrated = parseTypographyPreferences(JSON.stringify({
      version: 2,
      uiFontId: BUILTIN_FONT_IDS.systemSans,
      contentFontId: "theme",
      codeFontId: BUILTIN_FONT_IDS.geistMono,
      terminalFontId: BUILTIN_FONT_IDS.terminalSystemMono,
    }));

    expect(migrated.version).toBe(11);
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

  it("coordinates every surface through one bounded application scale", () => {
    expect(DEFAULT_TYPOGRAPHY_PREFERENCES.scale).toBe("medium");

    const preferences = withTypographyScale(DEFAULT_TYPOGRAPHY_PREFERENCES, "large");
    const props = createTypographyRootProps(resolveTypography(preferences));
    expect(props.style).toMatchObject({
      "--po-control-size": "34px",
      "--po-user-ui-micro-font-size": "12px",
      "--po-user-ui-caption-font-size": "13px",
      "--po-user-ui-meta-font-size": "14px",
      "--po-user-ui-control-font-size": "16px",
      "--po-user-ui-body-font-size": "16px",
      "--po-user-ui-section-title-font-size": "18px",
      "--po-user-ui-page-title-font-size": "23px",
      "--po-user-left-sidebar-font-size": "16px",
      "--po-user-left-sidebar-meta-font-size": "14px",
      "--po-user-left-sidebar-line-height": "21px",
      "--po-user-header-font-size": "16px",
      "--po-user-header-line-height": "21px",
      "--po-user-header-meta-font-size": "14px",
      "--po-user-header-meta-line-height": "19px",
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
      "--po-user-text-size-conversation": "16px",
      "--po-user-right-sidebar-control-line-height": "21px",
      "--po-user-right-sidebar-meta-font-size": "14px",
      "--po-user-right-sidebar-meta-line-height": "20px",
      "--po-user-right-sidebar-caption-font-size": "13px",
      "--po-user-right-sidebar-caption-line-height": "18px",
      "--po-user-right-sidebar-micro-font-size": "12px",
      "--po-user-right-sidebar-micro-line-height": "16px",
      "--po-user-right-sidebar-code-font-size": "14px",
      "--po-user-terminal-font-size": "14px",
      "--po-user-right-sidebar-heading-1-font-size": "23px",
      "--po-user-right-sidebar-heading-2-font-size": "18px",
    });
    expect(props["data-typography-scale"]).toBe("large");
    expect(TYPOGRAPHY_SCALE_METRICS.medium).toEqual({
      geometry: {
        controlSize: 32,
      },
      ui: {
        glyph: 8,
        micro: 11,
        caption: 12,
        hint: 13,
        meta: 13,
        label: 14,
        control: 14,
        body: 14,
        bodyLarge: 15,
        sectionTitle: 16,
        title: 17,
        heading: 19,
        pageTitle: 21,
        display: 25,
        hero: 29,
      },
      leftSidebar: {
        content: 14,
        meta: 12,
        lineHeight: 19,
      },
      header: {
        content: 14,
        lineHeight: 19,
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
    expect(migrated.scale).toBe("large");

    const normalized = parseTypographyPreferences(JSON.stringify({
      version: 10,
      scales: {
        leftSidebar: "large",
        header: "small",
        editor: "custom",
        rightSidebar: "large",
      },
    }));
    expect(normalized.scale).toBe("medium");

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
    expect(migratedV9.scale).toBe("small");

    const migratedV6 = parseTypographyPreferences(JSON.stringify({
      version: 6,
      contentFont: { mode: "follow-theme" },
      scales: { editor: "small", rightSidebar: "large" },
    }));
    expect(migratedV6.scale).toBe("small");

    const migratedV7 = parseTypographyPreferences(JSON.stringify({
      version: 7,
      contentFont: { mode: "follow-theme" },
      scales: { appChrome: "large", editor: "small", rightSidebar: "large" },
    }));
    expect(migratedV7.scale).toBe("small");

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
    expect(migratedV8.scale).toBe("large");

    expect(parseTypographyPreferences(JSON.stringify({
      version: 11,
      scale: "custom",
    })).scale).toBe("medium");
  });

  it("keeps Header and Right Sidebar text aligned across all application presets", () => {
    for (const metrics of Object.values(TYPOGRAPHY_SCALE_METRICS)) {
      expect(metrics.header.content).toBe(metrics.rightSidebar.content);
      expect(metrics.header.lineHeight).toBe(metrics.rightSidebar.controlLineHeight);
      expect(metrics.ui.meta).toBeLessThan(metrics.ui.body);
    }
  });

  it("keeps every product-owned font size on the integer type scale", () => {
    for (const metrics of Object.values(TYPOGRAPHY_SCALE_METRICS)) {
      expect(Object.values(metrics.geometry).every(Number.isInteger)).toBe(true);
      expect(Object.values(metrics.ui).every(Number.isInteger)).toBe(true);
      expect(Object.values(metrics.leftSidebar).every(Number.isInteger)).toBe(true);
      expect(Object.values(metrics.header).every(Number.isInteger)).toBe(true);
      expect(Object.values(metrics.editor).every(Number.isInteger)).toBe(true);
      expect(Object.values(metrics.rightSidebar).every(Number.isInteger)).toBe(true);
    }

    const fractionalCssTypeSize = /(?:font-size|--[\w-]*(?:font|text|type|heading|md-h\d)[\w-]*size)\s*:[^;\n}]*\d+\.\d+(?:px|em|rem|pt|vw)/i;
    const fractionalInlineTypeSize = /fontSize\s*[:=]\s*(?:["'{]\s*)?\d+\.\d+/;
    const relativeCssTypeSize = /font-size\s*:\s*(?:inherit|smaller|larger|[^;\n}]*(?:\d+(?:\.\d+)?(?:em|rem|%)|calc\())/i;
    const directPixelCssTypeSize = /font-size\s*:\s*\d+(?:\.\d+)?px/i;
    const directPixelFontShorthand = /\bfont\s*:\s*[^;\n}]*\d+(?:\.\d+)?px/i;
    const directPixelCssTypeToken = /--[\w-]*(?:font|text|type|heading|meta|label)[\w-]*size\s*:\s*\d+(?:\.\d+)?px/i;
    const directNumericInlineTypeSize = /\bfontSize\s*(?::|=)\s*(?:\{\s*)?\d+(?:\.\d+)?\b/;
    const roots = ["src", "packages", "electron", "local-api", "sub-themes", "public"];
    for (const root of roots) {
      for (const file of sourceFiles(new URL(`../${root}/`, import.meta.url))) {
        const contents = readFileSync(file, "utf8");
        expect(contents, file.pathname).not.toMatch(fractionalCssTypeSize);
        expect(contents, file.pathname).not.toMatch(fractionalInlineTypeSize);
        expect(contents, file.pathname).not.toMatch(relativeCssTypeSize);
        if (file.pathname.endsWith(".css")) {
          expect(contents, file.pathname).not.toMatch(directPixelCssTypeSize);
          expect(contents, file.pathname).not.toMatch(directPixelFontShorthand);
          expect(contents, file.pathname).not.toMatch(directPixelCssTypeToken);
        }
        if (/\.[cm]?[jt]sx?$/.test(file.pathname)) {
          expect(contents, file.pathname).not.toMatch(directNumericInlineTypeSize);
        }
      }
    }

    const foundations = source("src/styles/typography/foundations.css");
    expect(foundations).toMatch(/small\s*\{[^}]*font-size:\s*var\(--po-type-ui-meta, 13px\)/s);
    expect(buildTypographyCustomProperties(resolveTypography(DEFAULT_TYPOGRAPHY_PREFERENCES)))
      .toEqual(createTypographyRootProps(resolveTypography(DEFAULT_TYPOGRAPHY_PREFERENCES)).style);
  });

  it("owns scaled control geometry at the shared design-token boundary", () => {
    const geometry = readFileSync(
      new URL("../packages/shared-ui/src/styles/control-geometry.css", import.meta.url),
      "utf8",
    );
    const geometryRuntime = readFileSync(
      new URL("../packages/shared-ui/src/core/controlGeometry.ts", import.meta.url),
      "utf8",
    );
    const tokens = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
    const stylesEntry = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    const viteConfig = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
    const sharedStylesEntry = readFileSync(
      new URL("../packages/shared-ui/src/styles/shared-ui.css", import.meta.url),
      "utf8",
    );
    const nodeActions = source("src/features/data-workspace/nodeActions.tsx");
    const agentTranscript = source("src/features/desktop-agent/ui/AgentTranscript.tsx");
    const agentTimelinePresentation = source(
      "src/features/desktop-agent/ui/transcript/transcript-rows.ts",
    );
    const agentToolGroupPresentation = source(
      "src/features/desktop-agent/ui/agent-tool-group-presentation.ts",
    );
    expect(geometry).toContain("--po-control-size: 32px;");
    expect(geometry).toContain("--po-control-size-compact: calc(var(--po-control-size) - 4px);");
    expect(geometry).toContain("--po-control-size-large: calc(var(--po-control-size) + 2px);");
    expect(geometryRuntime).toContain("STANDARD_CONTROL_SIZE = 32;");
    expect(Object.fromEntries(Object.entries(TYPOGRAPHY_SCALE_METRICS).map(
      ([scale, metrics]) => [scale, metrics.geometry.controlSize],
    ))).toEqual({ small: 30, medium: 32, large: 34 });
    expect(stylesEntry).toContain(
      '@import "@puppyone/shared-ui/control-geometry.css" layer(tokens);',
    );
    expect(viteConfig).toContain('find: "@puppyone/shared-ui/control-geometry.css"');
    expect(sharedStylesEntry).toContain('@import "./control-geometry.css";');
    expect(tokens).toContain("--desktop-chrome-control-size: var(--po-control-size);");
    expect(tokens).toContain("--desktop-sidebar-row-height: var(--po-control-size);");
    expect(source("src/styles/typography/foundations.css"))
      .toContain("--po-text-size-sidebar: var(--po-type-left-sidebar-content);");
    expect(nodeActions).toContain('"--po-menu-item-height"');
    expect(nodeActions).not.toMatch(/menuRowCount\s*\*\s*30/);
    expect(agentTranscript).toContain('"--agent-control-size"');
    expect(agentTimelinePresentation).toContain("compactRowHeight = STANDARD_CONTROL_SIZE");
    expect(agentToolGroupPresentation).toContain("compactRowHeight = STANDARD_CONTROL_SIZE");

    const rawControlDimension = /^\s*(?:width|height|min-height)\s*:\s*30px(?:\s*!important)?;/m;
    for (const root of ["src", "packages/shared-ui/src", "sub-themes"]) {
      for (const file of sourceFiles(new URL(`../${root}/`, import.meta.url))) {
        if (!file.pathname.endsWith(".css")) continue;
        const contents = readFileSync(file, "utf8");
        expect(contents, file.pathname).not.toMatch(rawControlDimension);
        if (!file.pathname.endsWith("src/styles/typography/foundations.css")) {
          expect(contents, file.pathname).not.toContain("var(--po-text-size-sidebar");
        }
      }
    }

    const rawRuntimeControlDimension = /(?:(?:ROW_HEIGHT|CONTROL_SIZE|rowHeight|controlSize)\s*=|estimatedHeight:)\s*30\b/;
    for (const root of ["src", "packages/shared-ui/src"]) {
      for (const file of sourceFiles(new URL(`../${root}/`, import.meta.url))) {
        if (!/\.tsx?$/.test(file.pathname) || file.pathname.endsWith("controlGeometry.ts")) continue;
        expect(readFileSync(file, "utf8"), file.pathname).not.toMatch(rawRuntimeControlDimension);
      }
    }
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
    const markdownMath = source("packages/shared-ui/src/styles/editor/markdown-math.css");
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
    expect(markdownContent).toContain(".cm-md-math-inline-widget");
    expect(markdownContent).not.toContain("font-family: revert");
    expect(markdownMath).not.toContain("font-family: revert");
    expect(markdownMath).not.toMatch(/font-family:\s*KaTeX_/);
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
    expect(terminalAppearanceSync).toContain("useEditorAppearanceRevision()");
    expect(terminalAppearanceSync).not.toContain("MutationObserver");
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
    expect(typographyRuntime).toContain("style: buildTypographyCustomProperties(resolved)");
    expect(typographyRuntime).toContain("const props = createTypographyRootProps(resolved)");
    expect(typographyRuntime).not.toContain('"--po-font-content": resolved.content.family');
    expect(app).toContain("fontCatalog,\n    locale,");
    expect(appearanceRuntime).not.toContain("data-content-text-size");
    expect(appearanceRuntime).not.toContain("appearance.textSize");
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
