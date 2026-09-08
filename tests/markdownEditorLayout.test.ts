import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const markdownEditorCss = readFileSync(
  new URL("../packages/shared-ui/src/styles/editor/markdown-editor.css", import.meta.url),
  "utf8",
);
const editorEntryCss = readFileSync(
  new URL("../packages/shared-ui/src/styles/editor.css", import.meta.url),
  "utf8",
);
const sharedTableCss = readFileSync(
  new URL("../packages/shared-ui/src/styles/editor/editable-table.css", import.meta.url),
  "utf8",
);
const markdownTableCss = readFileSync(
  new URL("../packages/shared-ui/src/styles/editor/markdown-table-widget.css", import.meta.url),
  "utf8",
);
const markdownTableWidgetSource = readFileSync(
  new URL("../packages/shared-ui/src/editor/markdown/features/table/tableWidget.ts", import.meta.url),
  "utf8",
);
const markdownHtmlCss = readFileSync(
  new URL("../packages/shared-ui/src/styles/editor/markdown-html-widget.css", import.meta.url),
  "utf8",
);
const markdownContentCss = readFileSync(
  new URL("../packages/shared-ui/src/styles/editor/markdown-content.css", import.meta.url),
  "utf8",
);
const markdownCodeCss = readFileSync(
  new URL("../packages/shared-ui/src/styles/editor/markdown-code-widgets.css", import.meta.url),
  "utf8",
);
const markdownInlineCss = readFileSync(
  new URL("../packages/shared-ui/src/styles/editor/markdown-inline-widgets.css", import.meta.url),
  "utf8",
);
const markdownCodeMirrorExtensionsSource = readFileSync(
  new URL("../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions.ts", import.meta.url),
  "utf8",
);

describe("Markdown editor layout", () => {
  it("shares its reading width with other document-like product surfaces", () => {
    expect(markdownEditorCss).toContain(
      "--po-markdown-editor-text-width: var(--po-reading-content-width, 724px);",
    );
  });

  it("keeps the centered reading rail invariant when stacked panes cross the overflow threshold", () => {
    const scrollerRule = readCssRule(
      markdownEditorCss,
      ".markdown-codemirror-editor .cm-scroller",
    );

    // A classic product scrollbar consumes 12px. Reserving both logical edges
    // keeps the 724px reading rail centered and prevents pane focus reflow from
    // moving it by half a scrollbar width when overflow appears or disappears.
    expect(scrollerRule).toContain("scrollbar-gutter: stable both-edges;");
  });

  it("keeps canonical Markdown source invisible until Live Preview commits", () => {
    const pendingRule = readCssRule(
      markdownEditorCss,
      '.markdown-codemirror-editor[data-live-preview="true"][data-preview-state="pending"] .cm-editor',
    );

    expect(pendingRule).toContain("visibility: hidden;");
    expect(pendingRule).toContain("pointer-events: none;");
    expect(markdownEditorCss).not.toMatch(/data-preview-state="pending"[^}]*opacity\s*:/s);
    expect(markdownEditorCss).not.toMatch(/data-preview-state="pending"[^}]*display\s*:\s*none/s);
  });

  it("keeps Markdown source mode typography uniform", () => {
    expect(markdownEditorCss).toMatch(
      /\.markdown-codemirror-editor\[data-live-preview="false"\]\s*:is\([\s\S]*?\.cm-md-syntax-strong,[\s\S]*?\)\s*\{[\s\S]*?color:\s*inherit;/s,
    );
    expect(markdownEditorCss).toMatch(
      /\.markdown-codemirror-editor\[data-live-preview="false"\][\s\S]*?\{[\s\S]*?font-family:\s*inherit;/s,
    );
    expect(markdownEditorCss).toMatch(
      /\.markdown-codemirror-editor\[data-live-preview="false"\][\s\S]*?\{[\s\S]*?font-size:\s*var\(--po-type-editor-content, 15px\);/s,
    );
    expect(markdownEditorCss).toMatch(
      /\.markdown-codemirror-editor\[data-live-preview="false"\][\s\S]*?\{[\s\S]*?font-style:\s*normal;/s,
    );
    expect(markdownEditorCss).toMatch(
      /\.markdown-codemirror-editor\[data-live-preview="false"\][\s\S]*?\{[\s\S]*?font-weight:\s*inherit;/s,
    );
    expect(markdownEditorCss).toMatch(
      /\.markdown-codemirror-editor\[data-live-preview="false"\][\s\S]*?\{[\s\S]*?text-decoration:\s*none;/s,
    );
  });

  it("keeps vertical document padding fixed while the inline gutter responds to width", () => {
    const editorRule = readCssRule(markdownEditorCss, ".markdown-codemirror-editor");
    const scrollerRule = readCssRule(markdownEditorCss, ".markdown-codemirror-editor .cm-scroller");
    const contentRule = readCssRule(markdownEditorCss, ".markdown-codemirror-editor .cm-content");

    expect(editorEntryCss).toContain("--po-editor-content-edge-inset: 64px;");
    expect(editorRule).toContain("--po-markdown-editor-gutter-min: var(--po-editor-content-edge-inset, 64px);");
    expect(editorRule).toContain("--po-markdown-editor-content-padding-block: var(--po-editor-content-edge-inset, 64px);");
    expect(contentRule).toContain("--po-markdown-editor-content-gutter-inline: max(");
    expect(contentRule).toContain("padding-block: var(--po-markdown-editor-content-padding-block);");
    expect(contentRule).toContain("padding-inline: var(--po-markdown-editor-content-gutter-inline);");
    expect(contentRule).not.toMatch(/padding-(?:block|top):[^;]*content-gutter-inline/);
    expect(editorRule).toContain("container-type: inline-size;");
    expect(editorRule).toContain("--po-markdown-scroll-viewport-inline-size: 100cqw;");
    expect(editorRule).toContain("-webkit-font-smoothing: antialiased;");
    expect(editorRule).toContain("-moz-osx-font-smoothing: grayscale;");
    expect(scrollerRule).not.toContain("container-type: inline-size;");
  });

  it("keeps the full-width block edge separate from the document reading rail", () => {
    const editorRule = readCssRule(markdownEditorCss, ".markdown-codemirror-editor");

    expect(editorRule).toContain("--po-markdown-wide-block-edge-inset: 0px;");
    expect(editorRule).not.toContain("--po-markdown-wide-block-edge-inline-end-inset");
    expect(editorRule).not.toContain("--po-markdown-breakout-inline-inset");
    expect(editorRule).not.toContain("--po-markdown-breakout-max-width");
  });

  it("keeps ordinary editable-line geometry independent of empty-line DOM", () => {
    const livePreviewRule = readCssRule(
      markdownEditorCss,
      '.markdown-codemirror-editor[data-live-preview="true"]',
    );

    expect(livePreviewRule).toContain("--po-markdown-editor-line-spacing: 3px;");
    expect(markdownCodeMirrorExtensionsSource).toContain(
      'padding: "var(--po-markdown-editor-line-spacing, 0px) 0"',
    );
    expect(markdownEditorCss).not.toMatch(
      /\.cm-line:has\(\s*>\s*br:only-child\s*\)/,
    );
  });

  it("keeps task checkbox visuals compact inside a reliable desktop hit target", () => {
    const taskLineRule = readCssRule(
      markdownEditorCss,
      ".markdown-codemirror-editor .cm-md-task-line",
    );
    const controlRule = readCssRule(
      markdownEditorCss,
      ".markdown-codemirror-editor .cm-md-task-checkbox-widget",
    );
    const indicatorRule = readCssRule(
      markdownEditorCss,
      ".markdown-codemirror-editor .cm-md-task-checkbox",
    );
    expect(taskLineRule).toContain("--md-task-checkbox-hit-size: 24px;");
    expect(controlRule).toContain("width: var(--md-task-checkbox-hit-size);");
    expect(controlRule).toContain("height: var(--md-task-checkbox-hit-size);");
    expect(controlRule).toContain("font: inherit;");
    expect(indicatorRule).toContain("width: var(--md-task-checkbox-size);");
    expect(indicatorRule).toContain("pointer-events: none;");
    expect(markdownEditorCss).not.toMatch(/cm-md-task-checkbox-widget:hover/);
  });
});

describe("Markdown HTML media layout", () => {
  it("caps raw HTML images at the reading rail without replacing authored sizing", () => {
    const imageRule = readCssRule(
      markdownContentCss,
      ".markdown-codemirror-editor .cm-md-html-rendered-surface img",
    );

    expect(imageRule).toContain("max-width: 100%;");
    expect(imageRule).not.toMatch(/(^|\n)\s*width\s*:/);
  });

  it("uses one semantic presentation profile without a second HTML widget gap", () => {
    const profileRule = readCssRule(markdownContentCss, ".markdown-codemirror-editor");
    const darkProfileRule = readCssRule(
      markdownContentCss,
      ":where(.dark) .markdown-codemirror-editor",
    );
    const editorTextRule = readCssRule(
      markdownEditorCss,
      ".markdown-codemirror-editor .cm-editor",
    );
    const nativeHeadingRule = readCssRule(
      markdownContentCss,
      '.markdown-codemirror-editor[data-live-preview="true"] .cm-md-heading-1',
    );
    const htmlHeadingRule = readCssRule(
      markdownContentCss,
      ".markdown-codemirror-editor .cm-md-html-rendered-surface h1",
    );
    const nativeHeading2Rule = readCssRule(
      markdownContentCss,
      '.markdown-codemirror-editor[data-live-preview="true"] .cm-md-heading-2',
    );
    const nativeHeading3Rule = readCssRule(
      markdownContentCss,
      '.markdown-codemirror-editor[data-live-preview="true"] .cm-md-heading-3',
    );
    const htmlHeading2Rule = readCssRule(
      markdownContentCss,
      ".markdown-codemirror-editor .cm-md-html-rendered-surface h2",
    );
    const htmlHeading3Rule = readCssRule(
      markdownContentCss,
      ".markdown-codemirror-editor .cm-md-html-rendered-surface h3",
    );
    const htmlSurfaceRule = readCssRule(
      markdownContentCss,
      ".markdown-codemirror-editor .cm-md-html-rendered-surface",
    );
    const htmlPreRule = readCssRule(
      markdownContentCss,
      ".markdown-codemirror-editor .cm-md-html-rendered-surface pre",
    );
    const widgetRule = readCssRule(
      markdownHtmlCss,
      ".markdown-codemirror-editor .cm-md-html-widget",
    );

    expect(editorEntryCss).toContain('@import "./editor/markdown-content.css";');
    expect(profileRule).toContain("--po-md-presentation-version: 2;");
    expect(profileRule).toContain(
      "--po-md-content-size: var(--po-type-editor-content, var(--po-text-size-content, 15px));",
    );
    expect(profileRule).toContain(
      "--po-md-content-weight: var(--po-host-md-content-weight, var(--po-content-reading-weight, 450));",
    );
    expect(profileRule).toContain(
      "--po-md-content-letter-spacing: var(--po-host-md-content-letter-spacing, var(--po-content-reading-letter-spacing, 0));",
    );
    expect(profileRule).toContain(
      "--po-md-content-line-height: var(--po-type-editor-line-height, var(--po-content-reading-line-height, 24px));",
    );
    expect(profileRule).toContain("--po-md-content-color: var(--po-host-md-content-color, var(--po-text));");
    expect(darkProfileRule).toContain(
      "--po-md-content-color: var(\n    --po-host-md-content-color,\n    color-mix(in srgb, var(--po-text) 80%, var(--po-text-muted))",
    );
    expect(darkProfileRule).not.toContain("--po-md-content-weight:");
    expect(profileRule).toContain("--po-md-block-gap: var(--po-host-md-block-gap, 16px);");
    expect(profileRule).toContain("--po-md-heading-gap-before: var(--po-host-md-heading-gap-before, 24px);");
    expect(profileRule).toContain("--po-md-heading-gap-after: var(--po-host-md-heading-gap-after, 16px);");
    expect(editorTextRule).toContain("font-family: var(--po-editor-content-font);");
    expect(editorTextRule).toContain("font-size: var(--po-md-content-size);");
    expect(editorTextRule).toContain("font-weight: var(--po-md-content-weight);");
    expect(editorTextRule).toContain("letter-spacing: var(--po-md-content-letter-spacing);");
    expect(htmlSurfaceRule).toContain("font-size: var(--po-md-content-size);");
    expect(htmlSurfaceRule).toContain("font-weight: var(--po-md-content-weight);");
    expect(htmlSurfaceRule).toContain("line-height: var(--po-md-content-line-height);");
    expect(profileRule).toContain("--po-md-h1-weight: var(--po-host-md-h1-weight, 650);");
    expect(profileRule).toContain("--po-md-h2-weight: var(--po-host-md-h2-weight, 625);");
    expect(profileRule).toContain("--po-md-h3-weight: var(--po-host-md-h3-weight, 600);");
    expect(profileRule).toContain("--po-md-heading-line-height: var(--po-host-md-heading-line-height, 1.25);");
    expect(profileRule).toContain(
      "--po-md-h1-size: var(--po-user-md-h1-size, var(--po-type-editor-heading-1, 30px));",
    );
    expect(profileRule).toContain(
      "--po-md-strong-weight: var(--po-user-md-strong-weight, var(--po-host-md-strong-weight, 600));",
    );
    expect(profileRule).toContain(
      "--po-md-strong-color: var(--po-user-md-strong-color, var(--po-host-md-strong-color, var(--po-text)));",
    );
    expect(markdownContentCss).not.toMatch(/app-shell|onboarding-shell|desktop-overlay-root/);
    expect(profileRule).toContain(
      "--po-md-rule-color: var(--po-host-md-rule-color, color-mix(in srgb, var(--po-divider) 96%, var(--po-text-muted) 4%));",
    );
    expect(nativeHeadingRule).toContain("font-size: var(--po-md-h1-size);");
    expect(nativeHeadingRule).toContain(
      "--po-md-current-heading-weight: var(--po-md-h1-weight);",
    );
    expect(htmlHeadingRule).toContain("font-size: var(--po-md-h1-size);");
    expect(htmlHeadingRule).toContain("font-weight: var(--po-md-h1-weight);");
    expect(nativeHeading2Rule).toContain("font-size: var(--po-md-h2-size);");
    expect(nativeHeading2Rule).toContain(
      "--po-md-current-heading-weight: var(--po-md-h2-weight);",
    );
    expect(htmlHeading2Rule).toContain("font-size: var(--po-md-h2-size);");
    expect(htmlHeading2Rule).toContain("font-weight: var(--po-md-h2-weight);");
    expect(nativeHeading3Rule).toContain("font-size: var(--po-md-h3-size);");
    expect(nativeHeading3Rule).toContain(
      "--po-md-current-heading-weight: var(--po-md-h3-weight);",
    );
    expect(htmlHeading3Rule).toContain("font-size: var(--po-md-h3-size);");
    expect(htmlHeading3Rule).toContain("font-weight: var(--po-md-h3-weight);");
    for (const headingRule of [
      nativeHeadingRule,
      nativeHeading2Rule,
      nativeHeading3Rule,
      htmlHeadingRule,
      htmlHeading2Rule,
      htmlHeading3Rule,
    ]) {
      expect(headingRule).not.toContain("border-bottom");
      expect(headingRule).not.toContain("padding-bottom");
    }
    expect(htmlSurfaceRule).toContain("white-space: normal;");
    expect(htmlPreRule).toContain("white-space: pre-wrap;");
    expect(widgetRule).toContain("padding: 0;");
    expect(markdownHtmlCss).not.toContain("min-height: 80px;\n  border-radius: 5px;");
  });

  it("keeps emphasis weight consistent across Markdown presentation adapters", () => {
    expect(markdownContentCss).toContain(
      ".markdown-codemirror-editor .cm-md-syntax-strong,",
    );
    expect(markdownContentCss).toContain(
      ".markdown-codemirror-editor :is(strong, b).cm-md-inline-html,",
    );
    expect(markdownContentCss).toContain(
      ".markdown-codemirror-editor .cm-md-html-rendered-surface :where(strong, b)",
    );
    expect(markdownContentCss).toMatch(
      /\.cm-md-html-rendered-surface :where\(strong, b\)\s*\{[^}]*font-weight:\s*var\(--po-md-strong-weight\)/s,
    );
    expect(markdownTableCss).toMatch(
      /\.cm-md-table-cell-content b\s*\{[^}]*font-weight:\s*var\(--po-md-strong-weight\)/s,
    );
    expect(markdownContentCss).toMatch(
      /:where\(h1, h2, h3, h4, h5, h6\)[\s\S]*?:where\(strong, b\)\s*\{[^}]*font-weight:\s*inherit/s,
    );
    expect(markdownTableCss).toMatch(
      /\.cm-md-table-widget th \.cm-md-table-cell-content b\s*\{[^}]*font-weight:\s*inherit/s,
    );
    expect(markdownEditorCss).not.toMatch(
      /\.cm-md-syntax-strong\s*\{[^}]*font-weight:\s*650/s,
    );
  });
});

describe("Markdown image presentation", () => {
  it("fills the rich content rail for block images without a product pixel cap", () => {
    const baseImageRule = readCssRule(
      markdownInlineCss,
      ".markdown-codemirror-editor .cm-md-image-widget img",
    );
    const blockWidgetRule = readCssRule(
      markdownInlineCss,
      ".markdown-codemirror-editor .cm-md-image-widget.is-block",
    );
    const blockImageRule = readCssRule(
      markdownInlineCss,
      ".markdown-codemirror-editor .cm-md-image-widget.is-block img",
    );

    expect(baseImageRule).toContain("max-width: 100%;");
    expect(baseImageRule).not.toContain("520px");
    expect(blockWidgetRule).toContain("width: 100%;");
    expect(blockImageRule).toContain("width: 100%;");
    expect(blockImageRule).toContain("height: auto;");
    expect(blockImageRule).toContain("max-height: none;");
    expect(markdownInlineCss).not.toContain("max-width: min(100%, 520px);");
  });
});

describe("Markdown rich-block boundary affordance", () => {
  const richWidgetSelector = ".markdown-codemirror-editor :is(.cm-md-code-widget, .cm-md-mermaid-widget, .cm-md-html-widget, .cm-md-mdx-tabs-widget, .cm-md-image-widget, .cm-md-video-widget)";
  const richSurfaceSelector = ".markdown-codemirror-editor :is(.cm-md-code-panel, .cm-md-mermaid-body, .cm-md-html-widget-content, .cm-md-mdx-tabs-panels, .cm-md-image-widget, .cm-md-video-widget)";

  it("paints state on the inner surface so wrapper spacing stays outside the ring", () => {
    const editorRule = readCssRule(markdownEditorCss, ".markdown-codemirror-editor");
    const wrapperRule = readCssRule(markdownEditorCss, richWidgetSelector);
    const surfaceRule = readCssRule(markdownEditorCss, richSurfaceSelector);
    const hoverRule = readCssRule(
      markdownEditorCss,
      `${richWidgetSelector}:is(:hover, :focus-within):not(.is-doc-selected)`,
    );
    const selectedRule = readCssRule(
      markdownEditorCss,
      `${richWidgetSelector}.is-doc-selected`,
    );

    expect(editorRule).toContain("--cm-md-block-hover-ring:");
    expect(editorRule).toContain("--cm-md-block-selected-ring:");
    expect(wrapperRule).toContain("--cm-md-block-current-ring: transparent;");
    expect(wrapperRule).not.toContain("box-shadow:");
    expect(surfaceRule).toContain("box-shadow: 0 0 0 2px var(--cm-md-block-current-ring);");
    expect(surfaceRule).toContain("transition: box-shadow 140ms ease;");
    expect(hoverRule).toContain("--cm-md-block-current-ring: var(--cm-md-block-hover-ring);");
    expect(selectedRule).toContain("--cm-md-block-current-ring: var(--cm-md-block-selected-ring);");
    expect(surfaceRule).not.toMatch(/\bborder\s*:/);
  });

  it("keeps the outer table frame unchanged on hover and cell focus", () => {
    const selectedRule = readCssRule(
      markdownTableCss,
      ".markdown-codemirror-editor .cm-md-table-widget-wrap.is-doc-selected .cm-md-table-widget",
    );

    expect(markdownTableCss).not.toContain(
      ".cm-md-table-widget-wrap:hover:not(.is-doc-selected) .cm-md-table-widget",
    );
    expect(markdownTableCss).not.toContain(
      ".cm-md-table-widget-wrap:focus-within:not(.is-doc-selected) .cm-md-table-widget",
    );
    expect(selectedRule).toContain("border-color:");
    expect(selectedRule).toContain("box-shadow: 0 0 0 2px var(--cm-md-block-selected-ring);");
  });

  it("uses semantic fixed column tracks so cell focus cannot resize a Markdown table", () => {
    const tableRule = readCssRule(
      markdownTableCss,
      ".markdown-codemirror-editor .cm-md-table-widget",
    );

    expect(tableRule).toContain("table-layout: fixed;");
    expect(markdownTableWidgetSource).toMatch(
      /const colgroup = doc\.createElement\("colgroup"\);[\s\S]*table\.appendChild\(colgroup\);[\s\S]*if \(this\.execution\.mode === "windowed"\)/,
    );
  });

  it("keeps vertical scrolling at the document level for code blocks", () => {
    const textareaRule = readCssRule(
      markdownCodeCss,
      ".markdown-codemirror-editor .cm-md-code-textarea",
    );

    expect(textareaRule).toContain("box-sizing: border-box;");
    expect(textareaRule).toContain("field-sizing: content;");
    expect(textareaRule).toContain("overflow-x: auto;");
    expect(textareaRule).toContain("overflow-y: hidden;");
  });

  it("keeps editable and highlighted code glyph metrics identical", () => {
    const textareaRule = readCssRule(
      markdownCodeCss,
      ".markdown-codemirror-editor .cm-md-code-textarea",
    );
    const highlightRule = readCssRule(
      markdownCodeCss,
      ".markdown-codemirror-editor .cm-md-code-highlight",
    );

    for (const rule of [textareaRule, highlightRule]) {
      expect(rule).toContain("font-weight: 400;");
      expect(rule).toContain("font-variant-ligatures: none;");
      expect(rule).toContain("font-feature-settings: \"liga\" 0, \"calt\" 0;");
      expect(rule).toContain("letter-spacing: normal;");
    }
  });

  it("maps Markdown code tokens through theme-adaptive semantic colors", () => {
    const tokenMappings = [
      ["comment", "comment"],
      ["keyword", "keyword"],
      ["string", "string"],
      ["constant", "constant"],
      ["special", "special"],
      ["type", "type"],
      ["function", "function"],
      ["property", "property"],
      ["operator", "operator"],
      ["meta", "meta"],
    ] as const;

    for (const [className, tokenName] of tokenMappings) {
      const rule = readCssRule(
        markdownCodeCss,
        `.markdown-codemirror-editor .cm-md-code-highlight .cm-code-${className}`,
      );
      expect(rule).toContain(`color: var(--po-code-token-${tokenName});`);
      expect(rule).not.toContain("font-weight:");
    }
  });

  it("lays out code source metadata separately from the language field", () => {
    const headerRule = readCssRule(
      markdownCodeCss,
      ".markdown-codemirror-editor .cm-md-code-header",
    );
    const referenceRule = readCssRule(
      markdownCodeCss,
      ".markdown-codemirror-editor .cm-md-code-source-reference",
    );
    const languageRule = readCssRule(
      markdownCodeCss,
      ".markdown-codemirror-editor .cm-md-code-header.has-source-reference .cm-md-code-language",
    );

    expect(headerRule).toContain("display: flex;");
    expect(referenceRule).toContain("text-overflow: ellipsis;");
    expect(referenceRule).toContain("white-space: nowrap;");
    expect(languageRule).toContain("text-align: right;");
  });

  it("reveals the HTML source control only for hover, keyboard focus, or selection", () => {
    const toolbarRule = readCssRule(
      markdownHtmlCss,
      ".markdown-codemirror-editor .cm-md-html-widget-toolbar",
    );
    const revealRule = readCssRule(
      markdownHtmlCss,
      ".markdown-codemirror-editor .cm-md-html-widget:is(:hover, :focus-within, .is-doc-selected) .cm-md-html-widget-toolbar",
    );

    expect(toolbarRule).toContain("opacity: 0;");
    expect(toolbarRule).toContain("pointer-events: none;");
    expect(toolbarRule).toContain("transition: opacity 140ms ease, transform 140ms ease;");
    expect(revealRule).toContain("opacity: 1;");
    expect(revealRule).toContain("pointer-events: auto;");
  });
});

describe("Markdown table affordance layout", () => {
  it("uses one normal-state rule color for dividers and table lines", () => {
    const nativeDividerRule = readCssRule(
      markdownEditorCss,
      ".markdown-codemirror-editor .cm-md-hr-widget::before",
    );
    const htmlDividerRule = readCssRule(
      markdownContentCss,
      ".markdown-codemirror-editor .cm-md-html-rendered-surface hr",
    );
    const viewportRule = readCssRule(
      markdownTableCss,
      ".markdown-codemirror-editor .cm-md-table-widget-wrap",
    );
    const tableRule = readCssRule(
      markdownTableCss,
      ".markdown-codemirror-editor .cm-md-table-widget",
    );
    const cellRule = readCssRule(
      markdownTableCss,
      ".markdown-codemirror-editor .cm-md-table-widget th,\n.markdown-codemirror-editor .cm-md-table-widget td",
    );

    expect(nativeDividerRule).toContain("background: var(--po-md-rule-color);");
    expect(htmlDividerRule).toContain("background: var(--po-md-rule-color);");
    expect(viewportRule).toContain(
      "--po-editable-table-border: var(--po-surface-editable-table-border, var(--po-md-rule-color));",
    );
    expect(viewportRule).toContain("--po-surface-editable-table-cell-border");
    expect(viewportRule).toContain("var(--po-md-rule-color)");
    expect(tableRule).toContain("border: 1px solid var(--po-editable-table-border);");
    expect(cellRule).toContain("border-right: 1px solid var(--po-editable-table-cell-border);");
    expect(cellRule).toContain("border-bottom: 1px solid var(--po-editable-table-cell-border);");
    expect(markdownContentCss).not.toContain("--po-md-heading-rule");
  });

  it("splits the editor-edge scrollport from the reading-rail table track", () => {
    const rootRule = readCssRule(
      markdownTableCss,
      ".markdown-codemirror-editor .cm-md-table-widget-wrap",
    );
    const viewportRule = readCssRule(
      markdownTableCss,
      ".markdown-codemirror-editor .cm-md-table-scrollport",
    );
    const frameRule = readCssRule(
      markdownTableCss,
      ".markdown-codemirror-editor .cm-md-table-frame",
    );
    const surfaceRule = readCssRule(
      markdownTableCss,
      ".markdown-codemirror-editor .cm-md-table-surface",
    );
    const scrollbarRule = readCssRule(
      markdownTableCss,
      ".markdown-codemirror-editor .cm-md-table-scrollbar-rail",
    );
    const scrollbarContentRule = readCssRule(
      markdownTableCss,
      ".markdown-codemirror-editor .cm-md-table-scrollbar-content",
    );

    expect(rootRule).toContain("inline-size: 100%;");
    expect(rootRule).toContain("overflow: visible;");
    expect(rootRule).toContain("padding-block: 0 18px;");
    expect(rootRule).toContain(
      "--cm-md-table-interaction-gutter: var(--po-editable-table-interaction-gutter);",
    );
    expect(sharedTableCss).toContain("--po-editable-table-interaction-gutter: max(");
    expect(viewportRule).toContain(
      "--cm-md-table-interaction-start-inset: var(--cm-md-table-interaction-gutter);",
    );
    expect(viewportRule).toContain(
      "--cm-md-table-reading-rail-end-inset: var(--cm-md-table-interaction-gutter);",
    );
    expect(viewportRule).toContain(
      "margin-inline-start: calc(-1 * var(--cm-md-table-interaction-start-inset));",
    );
    expect(viewportRule).toContain(
      "+ var(--cm-md-table-interaction-start-inset)",
    );
    expect(viewportRule).toContain("overflow-x: auto;");
    expect(viewportRule).toContain("overflow-y: hidden;");
    expect(viewportRule).toContain(
      "padding-block: var(--cm-md-table-handle-gutter) 0;",
    );
    expect(viewportRule).toContain("touch-action: pan-x pan-y;");
    expect(markdownTableCss).toContain("--cm-md-table-viewport-inline-inset: clamp(");
    expect(markdownTableCss).toContain("var(--po-markdown-wide-block-edge-inset)");
    expect(markdownTableCss).toContain("var(--po-markdown-scroll-viewport-inline-size)");
    expect(markdownTableCss).toMatch(
      /--cm-md-table-interaction-start-inset:\s*calc\(\s*var\(--po-markdown-editor-gutter-inline\)\s*-\s*var\(--cm-md-table-viewport-inline-inset\)\s*\)/s,
    );
    expect(markdownTableCss).not.toContain("--cm-md-table-viewport-inline-end-gutter");
    expect(markdownTableCss).not.toMatch(/(?:max-)?inline-size:\s*calc\(\s*100cqw/s);
    expect(markdownTableCss).not.toContain("--po-markdown-breakout-inline-inset");
    expect(markdownTableCss).not.toContain("--po-markdown-breakout-max-width");
    expect(frameRule).toContain(
      "padding-inline-start: var(--cm-md-table-interaction-start-inset);",
    );
    expect(frameRule).toContain(
      "padding-inline-end: var(--cm-md-table-reading-rail-end-inset);",
    );
    expect(surfaceRule).toContain("margin-inline-start: 0;");
    expect(scrollbarRule).toContain("inline-size: 100%;");
    expect(scrollbarRule).toContain("overflow-x: auto;");
    expect(scrollbarRule).toContain("block-size: var(--po-scrollbar-size, 12px);");
    expect(scrollbarContentRule).toContain("inline-size: 1px;");
    expect(markdownTableWidgetSource).toContain('wrapper.dataset.mdTableInlineViewport = "true";');
    expect(markdownTableWidgetSource).toContain('scrollport.dataset.poScrollbar = "hidden";');
    expect(markdownTableWidgetSource).toContain('scrollport.dataset.mdTableScrollport = "true";');
    expect(markdownTableWidgetSource).toContain('scrollbar.dataset.poScrollbar = "horizontal";');
    expect(markdownTableWidgetSource).toContain('scrollbar.dataset.mdTableScrollbarRail = "true";');
    expect(markdownTableWidgetSource).toContain('frame.dataset.mdTableScrollTrack = "true";');
    expect(markdownTableWidgetSource).toContain('surface.dataset.mdTableSurface = "true";');
  });

  it("uses one shared, pixel-centered structure control for Markdown and CSV", () => {
    const frameRule = readCssRule(markdownTableCss, ".markdown-codemirror-editor .cm-md-table-frame");
    const visualRule = readCssRule(sharedTableCss, ".po-editable-table-structure-button-visual");
    const glyphGeometryRule = readCssRule(
      sharedTableCss,
      ".po-editable-table-structure-button-visual::before,\n.po-editable-table-structure-button-visual::after",
    );
    const horizontalStrokeRule = readCssRule(
      sharedTableCss,
      ".po-editable-table-structure-button-visual::before",
    );
    const verticalStrokeRule = readLastCssRule(
      sharedTableCss,
      ".po-editable-table-structure-button-visual::after",
    );
    const addRowRule = readCssRule(sharedTableCss, ".po-editable-table-add-row");
    const addRowVisualRule = readCssRule(
      sharedTableCss,
      ".po-editable-table-add-row .po-editable-table-structure-button-visual",
    );
    const addColumnRule = readCssRule(sharedTableCss, ".po-editable-table-add-column");
    const addColumnVisualRule = readCssRule(
      sharedTableCss,
      ".po-editable-table-add-column .po-editable-table-structure-button-visual",
    );

    expect(frameRule).toContain("--cm-md-table-action-gutter: var(--po-editable-table-action-gutter);");
    expect(visualRule).toContain("position: relative;");
    expect(visualRule).toContain("font-size: 0;");
    expect(visualRule).toContain("line-height: 0;");
    expect(visualRule).not.toContain("font-weight:");
    expect(glyphGeometryRule).toContain("top: 50%;");
    expect(glyphGeometryRule).toContain("left: 50%;");
    expect(glyphGeometryRule).toContain("background: currentColor;");
    expect(glyphGeometryRule).toContain("transform: translate(-50%, -50%);");
    expect(horizontalStrokeRule).toContain("width: 7px;");
    expect(horizontalStrokeRule).toContain("height: 1px;");
    expect(verticalStrokeRule).toContain("width: 1px;");
    expect(verticalStrokeRule).toContain("height: 7px;");
    expect(addRowRule).toContain("block-size: var(--po-editable-table-action-gutter);");
    expect(addRowRule).toContain("inset-block-end: calc(-1 * var(--po-editable-table-action-gutter));");
    expect(addRowVisualRule).toContain("block-size: 13px;");
    expect(addColumnRule).toContain("inline-size: var(--po-editable-table-action-gutter);");
    expect(addColumnRule).toContain("inset-inline-end: calc(-1 * var(--po-editable-table-action-gutter));");
    expect(addColumnVisualRule).toContain("inline-size: 13px;");
    expect(markdownTableCss).not.toContain(
      ".markdown-codemirror-editor .cm-md-table-structure-button {",
    );
    expect(markdownTableWidgetSource).not.toContain('visual.textContent = "+"');
  });

  it("keeps compact drag grips inside larger pointer targets", () => {
    const columnHandleRule = readCssRule(
      sharedTableCss,
      ".po-editable-table-column-handle",
    );
    const columnVisualRule = readCssRule(
      sharedTableCss,
      ".po-editable-table-column-handle .po-editable-table-drag-handle-visual",
    );
    const rowHandleRule = readCssRule(
      sharedTableCss,
      ".po-editable-table-row-handle",
    );
    const rowVisualRule = readCssRule(
      sharedTableCss,
      ".po-editable-table-row-handle .po-editable-table-drag-handle-visual",
    );

    expect(columnHandleRule).toContain("width: 32px;");
    expect(columnHandleRule).toContain("height: 24px;");
    expect(columnVisualRule).toContain("width: 26px;");
    expect(columnVisualRule).toContain("height: 13px;");
    expect(rowHandleRule).toContain("width: 24px;");
    expect(rowHandleRule).toContain("height: var(--po-control-size);");
    expect(rowVisualRule).toContain("width: 13px;");
    expect(rowVisualRule).toContain("height: 26px;");
    expect(markdownTableCss).not.toContain(
      ".markdown-codemirror-editor .cm-md-table-drag-handle {",
    );
  });
});

function readCssRule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing CSS rule for ${selector}`);
  const bodyStart = start + selector.length + 2;
  const end = css.indexOf("\n}", bodyStart);
  if (end < 0) throw new Error(`Unclosed CSS rule for ${selector}`);
  return css.slice(bodyStart, end);
}

function readLastCssRule(css: string, selector: string): string {
  const start = css.lastIndexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing CSS rule for ${selector}`);
  const bodyStart = start + selector.length + 2;
  const end = css.indexOf("\n}", bodyStart);
  if (end < 0) throw new Error(`Unclosed CSS rule for ${selector}`);
  return css.slice(bodyStart, end);
}
