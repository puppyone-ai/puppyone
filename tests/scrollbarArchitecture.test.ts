import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const indexHtml = readCss("index.html");
const stylesEntry = readCss("src/styles.css");
const tokensCss = readCss("src/styles/tokens.css");
const scrollbarsCss = readCss("src/styles/scrollbars.css");
const scrollbarActivitySource = readCss("src/components/ScrollbarActivity.tsx");
const terminalSessionSource = readCss(
  "src/features/desktop-terminal/ui/TerminalSessionView.tsx",
);
const terminalCss = readCss("src/features/desktop-terminal/ui/styles/terminal-surface.css")
  + readCss("src/features/desktop-terminal/ui/styles/xterm-adapter.css");
const interfaceSkinContractCss = readCss("src/styles/interface-skin-contract.css");
const dataWorkspaceCss = readCss("packages/shared-ui/src/styles/data-workspace.css");
const dataWorkspaceSource = readCss("packages/shared-ui/src/data/DataWorkspace.tsx");
const desktopDataShellCss = readCss("src/features/data-workspace/data-shell.css");
const sidebarPrimitivesCss = readCss("packages/shared-ui/src/styles/sidebar-primitives.css");
const sidebarResizeHandleSource = readCss(
  "packages/shared-ui/src/sidebar/SidebarResizeHandle.tsx",
);
const auxiliaryPanelSource = readCss(
  "src/features/app-shell/auxiliary/AuxiliaryPanelHost.tsx",
);
const gitSidebarSource = readCss("src/features/source-control/SourceControlSidebar.tsx");
const gitSidebarLayoutCss = readCss("src/features/source-control/styles/sidebar-layout.css");
const gitSidebarPanelsCss = readCss("src/features/source-control/styles/sidebar-panels.css");
const layoutCss = readCss("src/styles/layout.css");
const baseCss = readCss("src/styles/base.css");
const markdownEditorCss = readCss("packages/shared-ui/src/styles/editor/markdown-editor.css");

describe("scrollbar architecture", () => {
  it("defines one opt-in product scrollbar primitive in the primitives layer", () => {
    expect(tokensCss).toContain("--po-scrollbar-size: 12px;");
    expect(tokensCss).toContain("--po-scrollbar-thumb-size: 6px;");
    expect(tokensCss).toContain("--po-scrollbar-thumb-active-size: 8px;");
    expect(tokensCss).toContain("--po-scrollbar-thumb-inset: 3px;");
    expect(tokensCss).toContain("--po-scrollbar-thumb-active-inset: 2px;");
    expect(tokensCss).toContain("--po-scrollbar-radius: 999px;");
    expect(scrollbarsCss).toContain("width: var(--po-scrollbar-size, 12px);");
    expect(scrollbarsCss).toContain("height: var(--po-scrollbar-size, 12px);");
    expect(scrollbarsCss).toContain(
      "border: var(--po-scrollbar-thumb-inset, 3px) solid transparent;",
    );
    expect(scrollbarsCss).toContain("background-clip: padding-box;");
    expect(indexHtml).toContain('data-po-scrollbar-mode="product"');
    expect(stylesEntry).toContain('@import "./styles/scrollbars.css" layer(primitives);');
    expect(scrollbarsCss).toContain(':root[data-po-scrollbar-mode="product"]');
    expect(scrollbarsCss).toContain('[data-po-scrollbar]:not([data-po-scrollbar="hidden"])');
    expect(scrollbarsCss).toContain('[data-po-scrollbar].po-scrollbar-active');
    expect(scrollbarsCss).not.toContain("focus-within");
    expect(scrollbarsCss).not.toContain("*::-webkit-scrollbar");
    expect(scrollbarsCss).toContain(
      "border-width: var(--po-scrollbar-thumb-active-inset, 2px);",
    );
    expect(scrollbarsCss).toContain('@media (forced-colors: active)');
  });

  it("shares one presentation color and explicit owner state across surfaces", () => {
    expect(tokensCss).toContain("--po-scrollbar-presentation-thumb: color-mix(");
    expect(tokensCss).toContain("--po-scrollbar-presentation-thumb-hover: color-mix(");
    expect(scrollbarsCss).toContain(
      "background-color: var(--po-scrollbar-presentation-thumb, var(--po-scrollbar-thumb));",
    );
    expect(scrollbarActivitySource).toContain("MANAGED_SCROLLBAR_SELECTOR");
    expect(scrollbarActivitySource).toContain(
      `'[data-po-scrollbar]:not([data-po-scrollbar="hidden"])'`,
    );
    expect(scrollbarActivitySource).toContain("target.matches(MANAGED_SCROLLBAR_SELECTOR)");
    expect(scrollbarActivitySource).toContain("HISTORICAL_SCROLLBAR_COMPOSITION");
    expect(scrollbarActivitySource).toContain("resolveHistoricalScrollbarControls");
    expect(scrollbarActivitySource).toContain("createPortal(");
    expect(scrollbarActivitySource).toContain("control.host");
    expect(scrollbarActivitySource).toContain("owner.scrollBy");
    expect(scrollbarActivitySource).not.toContain("position: fixed");
    expect(scrollbarActivitySource).not.toContain('data-interface-style="windows-xp"');
    expect(scrollbarActivitySource).not.toContain("editorPresentation");
    expect(scrollbarActivitySource).not.toContain('owner.closest(".po-viewer-surface-boundary")');
    expect(interfaceSkinContractCss).not.toContain("data-editor-presentation");
    expect(scrollbarsCss).not.toContain("data-editor-presentation");
    expect(readCss("packages/shared-ui/src/sidebar/SidebarScrollArea.tsx")).toContain(
      'data-po-scrollbar="sidebar"',
    );
    expect(readCss("packages/shared-ui/src/editor/markdown/MarkdownCodeMirrorEditor.tsx"))
      .toContain('view.scrollDOM.dataset.poScrollbar = "content";');
    expect(readCss("packages/shared-ui/src/editor/viewers/code/CodeMirrorCodeEditor.tsx"))
      .toContain('view.scrollDOM.dataset.poScrollbar = "content";');
  });

  it("keeps arrow controls inside the owner pane instead of a viewport overlay", () => {
    expect(interfaceSkinContractCss).toContain("::-webkit-scrollbar-button:single-button");
    expect(interfaceSkinContractCss).toContain(
      "real controls inside the owner's local pane",
    );
    expect(scrollbarActivitySource).toContain('owner.dataset.poScrollbar !== "menu"');
    expect(scrollbarActivitySource).toContain('orientation: "horizontal"');
    expect(scrollbarActivitySource).toContain('orientation: "vertical"');
    expect(scrollbarActivitySource).toContain("rect.height - (hasHorizontalOverflow ? scrollbarSize : 0)");
    expect(scrollbarActivitySource).toContain("rect.width - (hasVerticalOverflow ? scrollbarSize : 0)");
    expect(scrollbarActivitySource).toContain("orientation === \"horizontal\"");
    expect(scrollbarActivitySource).toContain("data-po-scrollbar-control-host");
    const ownerControlsRule = readRule(layoutCss, ".po-classic-scrollbar-controls");
    expect(ownerControlsRule).toContain("position: absolute;");
    expect(ownerControlsRule).toContain("z-index: 4;");
    expect(ownerControlsRule).toContain("contain: layout paint style;");
    expect(ownerControlsRule).not.toContain("position: fixed;");
    expect(layoutCss).toContain(".po-classic-scrollbar-button.decrement");
    expect(layoutCss).toContain(".po-classic-scrollbar-button.increment");
    expect(layoutCss).toContain('[data-scrollbar-orientation="horizontal"]');
    expect(layoutCss).toContain("var(--interface-scrollbar-button-left-image, none)");
    expect(layoutCss).toContain("var(--interface-scrollbar-button-right-image, none)");
    expect(terminalSessionSource).toContain(
      'className="desktop-terminal-classic-scrollbar-controls"',
    );
    expect(terminalSessionSource).toContain(
      'className="desktop-terminal-classic-scrollbar-button decrement"',
    );
    expect(terminalSessionSource).not.toContain("po-classic-scrollbar-button");
    expect(terminalCss).toMatch(
      /\.desktop-terminal-xterm\s*\{[^}]*overflow:\s*hidden;[^}]*isolation:\s*isolate;/s,
    );
    expect(terminalCss).toMatch(
      /\.desktop-terminal-classic-scrollbar-controls\s*\{[^}]*position:\s*absolute;/s,
    );
    expect(terminalCss).not.toMatch(
      /\.desktop-terminal-classic-scrollbar-controls\s*\{[^}]*position:\s*fixed;/s,
    );
  });

  it("restricts scrollbar pseudo-elements to the primitive, skins, and xterm adapter", () => {
    const allowedFiles = new Set([
      "src/features/desktop-terminal/ui/styles/xterm-adapter.css",
      "src/styles/interface-skin-contract.css",
      "src/styles/scrollbars.css",
      "src/styles/interfaces/windows-xp/tokens.css",
    ]);
    const violations = [
      ...listCssFiles(path.join(repositoryRoot, "src")),
      ...listCssFiles(path.join(repositoryRoot, "packages/shared-ui/src")),
    ].filter((filePath) => (
      readFileSync(filePath, "utf8").includes("::-webkit-scrollbar")
      && !allowedFiles.has(path.relative(repositoryRoot, filePath))
    ));

    expect(violations.map((filePath) => path.relative(repositoryRoot, filePath))).toEqual([]);
  });

  it("keeps registered owner variants inside the public contract", () => {
    const allowedVariants = new Set(["content", "hidden", "horizontal", "menu", "sidebar"]);
    const sourceFiles = [
      path.join(repositoryRoot, "index.html"),
      ...listFiles(path.join(repositoryRoot, "src"), ".ts"),
      ...listFiles(path.join(repositoryRoot, "src"), ".tsx"),
      ...listFiles(path.join(repositoryRoot, "packages/shared-ui/src"), ".ts"),
      ...listFiles(path.join(repositoryRoot, "packages/shared-ui/src"), ".tsx"),
    ];
    const invalidVariants = sourceFiles.flatMap((filePath) => {
      const source = readFileSync(filePath, "utf8");
      const values = [
        ...Array.from(source.matchAll(/data-po-scrollbar="([^"]+)"/g), (match) => match[1]),
        ...Array.from(source.matchAll(/dataset\.poScrollbar\s*=\s*"([^"]+)"/g), (match) => match[1]),
      ];
      return values
        .filter((value): value is string => Boolean(value) && !allowedVariants.has(value))
        .map((value) => `${path.relative(repositoryRoot, filePath)}: ${value}`);
    });

    expect(invalidVariants).toEqual([]);
    expect(scrollbarsCss).toContain(
      ':root[data-po-scrollbar-mode="system"] {\n  --desktop-sidebar-scrollbar-width: 0px;',
    );
    expect(scrollbarsCss).toContain(
      ':root[data-po-scrollbar-mode="system"] :where([data-po-scrollbar="sidebar"])',
    );
    expect(scrollbarsCss).toContain("scrollbar-gutter: auto !important;");
  });

  it("defines one collision-safe pane-edge resize lane", () => {
    expect(tokensCss).toContain("--po-pane-resizer-hit-size: 8px;");
    expect(tokensCss).toContain("--po-pane-resizer-line-size: 1px;");
    expect(sidebarResizeHandleSource).toContain(
      'paneEdge && "po-pane-edge-resize-handle"',
    );

    const sharedResizerRule = readRule(
      sidebarPrimitivesCss,
      ".po-pane-edge-resize-handle",
    );
    expect(sharedResizerRule).toContain("inset-block: 0;");
    expect(sharedResizerRule).toContain(
      "width: var(--po-pane-resizer-hit-size, 8px);",
    );
    expect(sharedResizerRule).toContain("transform: none;");
  });

  it("requires every vertical SidebarResizeHandle to opt into the pane-edge contract", () => {
    const verticalHandlePattern =
      /<SidebarResizeHandle\b(?:(?!<SidebarResizeHandle\b)[\s\S])*?orientation="vertical"/g;
    const violations = [
      ...listFiles(path.join(repositoryRoot, "src"), ".tsx"),
      ...listFiles(path.join(repositoryRoot, "packages/shared-ui/src"), ".tsx"),
    ].flatMap((filePath) => {
      const relativePath = path.relative(repositoryRoot, filePath);
      return Array.from(readFileSync(filePath, "utf8").matchAll(verticalHandlePattern))
        .filter((match) => !/\bpaneEdge\b/.test(match[0]))
        .map(() => relativePath);
    });

    expect(violations).toEqual([]);
  });

  it("overlays the Data sash on one shared Sidebar and Editor boundary", () => {
    for (const css of [dataWorkspaceCss, desktopDataShellCss]) {
      const resizerRule = readRule(css, ".data-explorer-resizer");
      const resizerDividerRule = readRule(css, ".data-explorer-resizer::after");
      const explorerColumnRule = readRule(css, ".explorer-column");
      expect(css).toMatch(
        /\.data-content\[data-resizable-explorer="true"\]\s*\{[^}]*grid-template-columns:[^}]*var\(--data-explorer-width[^}]*minmax/s,
      );
      const resizableGridRule = readRule(
        css,
        '.data-content[data-resizable-explorer="true"]',
      );
      expect(resizableGridRule).not.toContain("var(--po-pane-resizer-hit-size");
      expect(css).not.toMatch(
        /\.data-content\[data-resizable-explorer="true"\]\s*>\s*\.browser-column/,
      );
      expect(resizerRule).toContain(
        "inset-inline-start: var(--data-explorer-width, clamp(282px, 26vw, 360px));",
      );
      expect(resizerRule).toContain("inset-inline-end: auto;");
      expect(resizerRule).toContain("background: transparent;");
      expect(resizerRule).not.toContain("transform:");
      expect(resizerDividerRule).toContain("inset-inline-start: 0;");
      expect(resizerDividerRule).toContain("inset-inline-end: auto;");
      expect(explorerColumnRule).toContain(
        "border-inline-end: 1px solid var(--po-sidebar-divider, var(--po-divider));",
      );
      expect(resizerDividerRule).toContain("background: transparent;");
    }

    expect(dataWorkspaceSource.indexOf('className="data-explorer-resizer"')).toBeGreaterThan(
      dataWorkspaceSource.indexOf("</aside>"),
    );
    expect(dataWorkspaceSource).toMatch(
      /className="data-explorer-resizer"\s+paneEdge/,
    );
    expect(dataWorkspaceSource).toContain("ref={explorerResizeHandleRef}");
  });

  it("keeps the History divider between the Git changes and history panes", () => {
    const historyResizerRule = readRule(
      gitSidebarPanelsCss,
      ".desktop-git-history-resizer::after",
    );
    expect(historyResizerRule).toContain("inset-inline: 0;");
    expect(historyResizerRule).toContain(
      "background: var(--po-sidebar-divider, var(--po-divider));",
    );
    expect(historyResizerRule).not.toContain("transform:");
    expect(readRule(gitSidebarLayoutCss, ".desktop-git-history-pane"))
      .not.toContain("max-height:");
    expect(gitSidebarSource).toMatch(
      /className="desktop-git-changes-pane"[\s\S]+<GitSidebarHistoryResizer[\s\S]+className=\{`desktop-git-history-pane/,
    );
    expect(baseCss).not.toContain('[dir="rtl"] .data-explorer-resizer');
  });

  it("keeps the auxiliary resizer on the panel side of the Markdown scroll lane", () => {
    expect(markdownEditorCss).toMatch(
      /\.markdown-codemirror-editor \.cm-scroller\s*\{[^}]*overflow:\s*auto;/s,
    );
    expect(auxiliaryPanelSource).toMatch(
      /className="desktop-right-sidebar-resizer"\s+paneEdge/,
    );

    const rightResizerRule = readRule(layoutCss, ".desktop-right-sidebar-resizer");
    expect(rightResizerRule).toContain("inset-inline-start: 0;");
    expect(rightResizerRule).not.toContain("transform:");
    expect(rightResizerRule).not.toContain("inset-inline-end:");
    expect(baseCss).not.toContain('[dir="rtl"] .desktop-right-sidebar-resizer');
  });

  it("registers structured and horizontal editor scroll owners without local paint rules", () => {
    expect(readCss("packages/shared-ui/src/editor/viewers/csv/CsvTableEditor.tsx")).toContain(
      'data-po-scrollbar="content"',
    );
    expect(readCss("packages/shared-ui/src/editor/markdown/features/code-block/codeBlockWidget.ts"))
      .toContain('codeEditor.dataset.poScrollbar = "horizontal";');
    const markdownTableSource = readCss(
      "packages/shared-ui/src/editor/markdown/features/table/tableWidget.ts",
    );
    expect(markdownTableSource).toContain('scrollport.dataset.poScrollbar = "hidden";');
    expect(markdownTableSource).toContain('scrollbar.dataset.poScrollbar = "horizontal";');
    expect(scrollbarsCss).toContain('[data-po-scrollbar="horizontal"]');
  });

  it("does not opt any app stylesheet back into platform-native scrollbar rendering", () => {
    const violations = [
      ...listCssFiles(path.join(repositoryRoot, "src")),
      ...listCssFiles(path.join(repositoryRoot, "packages/shared-ui/src")),
    ].filter((filePath) => (
      /(?<![-\w])scrollbar-(?:width|color)\s*:/.test(readFileSync(filePath, "utf8"))
    ));

    expect(violations.map((filePath) => path.relative(repositoryRoot, filePath))).toEqual([]);
  });

  it("does not reset modern thumb clipping with the background shorthand", () => {
    const legacySkinFiles = new Set([
      "src/styles/interface-skin-contract.css",
      "src/styles/interfaces/windows-xp/tokens.css",
    ]);
    const violations = [
      ...listCssFiles(path.join(repositoryRoot, "src")),
      ...listCssFiles(path.join(repositoryRoot, "packages/shared-ui/src")),
    ].flatMap((filePath) => {
      const relativePath = path.relative(repositoryRoot, filePath);
      if (legacySkinFiles.has(relativePath)) return [];

      const css = readFileSync(filePath, "utf8");
      const thumbRule = /([^{}]*::-webkit-scrollbar-thumb[^{}]*)\{([^{}]*)\}/g;
      return Array.from(css.matchAll(thumbRule))
        .filter((match) => /(?:^|[;\s])background\s*:/.test(match[2] ?? ""))
        .map((match) => `${relativePath}: ${match[1]?.trim()}`);
    });

    expect(violations).toEqual([]);
  });
});

function readCss(relativePath: string): string {
  return readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

function readRule(css: string, selector: string): string {
  const ruleStart = css.indexOf(`${selector} {`);
  expect(ruleStart).toBeGreaterThanOrEqual(0);
  const ruleEnd = css.indexOf("}", ruleStart);
  expect(ruleEnd).toBeGreaterThan(ruleStart);
  return css.slice(ruleStart, ruleEnd + 1);
}

function listCssFiles(directory: string): string[] {
  return listFiles(directory, ".css");
}

function listFiles(directory: string, extension: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(entryPath, extension);
    return entry.isFile() && entry.name.endsWith(extension) ? [entryPath] : [];
  });
}
