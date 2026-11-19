import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(`../../../../${relativePath}`, import.meta.url), "utf8");
}

describe("semantic navigation cursor contract", () => {
  it("enables the hand cursor only for destinations when the preference is on", () => {
    const base = source("src/styles/base.css");

    expect(base).toContain("--po-action-cursor: default;");
    expect(base).not.toContain("--po-action-cursor: pointer;");
    expect(base).toMatch(
      /\[data-pointer-cursors="true"\][\s\S]*?:where\(\s*a\[href\],[\s\S]*?\[role="link"\][\s\S]*?\[role="tab"\][\s\S]*?\[data-navigation-item\][\s\S]*?\[data-po-interaction="navigation"\][\s\S]*?\)\s*\{[\s\S]*?--po-clickable-cursor:\s*pointer;[\s\S]*?cursor:\s*pointer;/,
    );
    expect(base).toMatch(
      /\[data-pointer-cursors\][\s\S]*?:where\(\s*button:not\(:disabled\),\s*a\[href\],[\s\S]*?\[data-po-interaction="navigation"\][\s\S]*?\)\s*\{\s*cursor:\s*default;/,
    );
    expect(base).toMatch(
      /:where\(button, input, select, textarea\):disabled,[\s\S]*?\[aria-disabled="true"\],[\s\S]*?\{[\s\S]*?--po-clickable-cursor:\s*default;[\s\S]*?cursor:\s*default;/,
    );
  });

  it("marks button-backed shell and Agent destinations as navigation", () => {
    const shellNavigation = source("src/features/app-shell/navigation/DesktopNavigationItems.tsx");
    const terminalLauncher = source("src/features/desktop-terminal/ui/TerminalLauncher.tsx");
    const agentLauncher = source("src/features/desktop-agent/ui/AgentRuntimeLauncher.tsx");
    const agentHistory = source("src/features/desktop-agent/ui/AgentConversationHistory.tsx");
    const historyPermission = source("src/features/desktop-agent/workbench/AgentChatHistoryBrowser.tsx");
    const tabs = source("src/features/app-shell/auxiliary-workbench/layout/AuxiliaryWorkbenchTab.tsx");

    expect(shellNavigation).toContain("data-navigation-item={item.view}");
    expect(shellNavigation).toContain('data-navigation-item="settings"');
    expect(terminalLauncher.match(/data-po-interaction="navigation"/g)).toHaveLength(4);
    expect(agentLauncher).toContain('data-po-interaction="navigation"');
    expect(agentHistory.match(/data-po-interaction="navigation"/g)).toHaveLength(2);
    expect(historyPermission).toContain('data-po-interaction="navigation"');
    expect(tabs).toContain('role="tab"');
  });

  it("marks document-reference actions while preserving editable text cursors", () => {
    const csvCell = source("src/shared-ui/editor/viewers/csv/CsvCellEditor.tsx");
    const csvCss = source("src/shared-ui/styles/editor/csv-table-editor.css");
    const markdownCss = source("src/shared-ui/styles/editor/markdown-inline-widgets.css");
    const markdownDecorations = source(
      "src/shared-ui/editor/markdown/core/decorations/inlineDecorations.ts",
    );
    const fileChange = source("src/features/desktop-agent/ui/activity/AgentFileChangeActivity.tsx");
    const fileQuery = source("src/features/desktop-agent/ui/activity/AgentFileQueryActivity.tsx");
    const editorHost = source("src/shared-ui/editor/host/EditorDocumentHost.tsx");
    const office = source("src/shared-ui/editor/viewers/office/OfficeViewer.tsx");
    const appPreview = source("src/shared-ui/editor/viewers/app/AppPreviewViewer.tsx");

    expect(csvCell).toContain('data-po-interaction="navigation"');
    expect(csvCell).toContain('data-po-content-interaction="navigation"');
    expect(csvCss).toMatch(
      /\.csv-table-editor__external-reference\s*\{[\s\S]*?cursor:\s*pointer;/,
    );
    expect(fileChange).toContain('data-po-interaction="navigation"');
    expect(fileQuery).toContain('data-po-interaction="navigation"');
    expect(editorHost).toContain('data-po-interaction="navigation"');
    expect(office).toContain('data-po-interaction="navigation"');
    expect(appPreview).toContain('data-po-interaction={navigation ? "navigation" : undefined}');
    expect(markdownDecorations).toContain('"data-md-link-interaction": "navigate"');
    expect(markdownDecorations).toContain('"data-po-content-interaction": "navigation"');
    expect(markdownCss).toMatch(/\[data-md-link-interaction="navigate"\][\s\S]*?cursor:\s*pointer;/);
    expect(markdownCss).toMatch(
      /\[data-md-link-interaction="navigate"\]\s*\{[\s\S]*?color:\s*var\(--po-md-link-color\);/,
    );
    // Inline code inside a navigable link takes the link color through the shared
    // inline-foreground role rather than a selector for every inline adapter.
    expect(markdownCss).toMatch(
      /\[data-md-link-interaction="navigate"\]\s*\{[^}]*--po-md-inline-foreground:\s*var\(--po-md-link-color\)/,
    );
    expect(source("src/shared-ui/styles/editor/markdown-content.css")).toMatch(
      /\.cm-md-inline-code[^{]*\{[^}]*color:\s*var\(--po-md-inline-foreground,/,
    );
    expect(markdownCss).not.toContain("cm-md-open-modifier-down");
  });

  it("forbids feature CSS from creating pointer cursors outside the policy boundary", () => {
    const violations = collectCssFiles(new URL("../../../../src/", import.meta.url))
      .filter((file) => (
        !file.pathname.endsWith("/src/styles/base.css")
        && !file.pathname.endsWith("/src/shared-ui/styles/editor/markdown-inline-widgets.css")
        && !file.pathname.endsWith("/src/shared-ui/styles/editor/csv-table-editor.css")
      ))
      .filter((file) => /(?:cursor:\s*pointer|var\(--po-clickable-cursor, pointer\))/.test(readFileSync(file, "utf8")));

    expect(violations).toEqual([]);
  });
});

function collectCssFiles(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) return collectCssFiles(child);
    return entry.isFile() && entry.name.endsWith(".css") ? [child] : [];
  });
}
