import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("renderer style architecture", () => {
  it("keeps one deterministic cascade and one renderer reset owner", () => {
    const cascade = source("src/styles/cascade.css");
    const entry = source("src/main.tsx");
    const styles = source("src/styles.css");
    const sourceControlStyles = source("src/features/source-control/source-control.css");
    const tailwindConfig = source("tailwind.config.cjs");

    expect(cascade.trim()).toBe("@layer reset, fallback, tokens, primitives, patterns, features, interface-style, sub-theme, appearance-overrides, accessibility, overrides;");
    expectInOrder(entry, [
      'import "./styles/cascade.css";',
      'import "./cloud-globals.css";',
      'import "./styles.css";',
    ]);
    expect(entry).toMatch(/^import "\.\/styles\/cascade\.css";\nimport "\.\/cloud-globals\.css";\nimport "\.\/styles\.css";\n/);
    expect(styles).toContain('@import "./features/source-control/source-control.css" layer(features);');
    expect(styles).not.toContain("source-control-overrides.css");
    expectInOrder(sourceControlStyles, [
      '@import "./styles/sidebar-base.css";',
      '@import "./styles/sidebar-layout.css";',
      '@import "./styles/sidebar-panels.css";',
      '@import "./styles/sidebar-actions.css";',
      '@import "./styles/sidebar-providers.css";',
      '@import "./styles/sidebar-resources.css";',
    ]);
    expect(styles).toContain('@import "./styles/base.css" layer(reset);');
    expect(styles).toContain('@import "./styles/fallback-theme.generated.css" layer(fallback);');
    expect(styles).toContain('@import "@puppyone/shared-ui/shared-ui-patterns.css" layer(patterns);');
    expect(styles).toContain('@import "@puppyone/shared-ui/editor.css";');
    expect(styles).toContain('@import "./features/desktop-agent/ui/styles/agent-prompt-editor.css";');
    expect(styles).not.toContain("viewer-product-default");
    expect(styles
      .replace('@import "./styles/interface-styles.generated.css";', "")
      .replace('@import "./features/desktop-agent/ui/styles/agent-prompt-editor.css";', "")
      .replace('@import "@puppyone/shared-ui/editor.css";', ""))
      .not.toMatch(/^@import(?![^;]*\blayer\()[^;]+;$/m);
    expect(styles).toContain("CodeMirror mounts its base theme as unlayered runtime CSS");
    expect(tailwindConfig).toMatch(/corePlugins\s*:\s*\{[\s\S]*?preflight\s*:\s*false/);
  });

  it("keeps Tailwind global directives in one entry file", () => {
    const tailwindEntry = source("src/cloud-globals.css");
    expect(tailwindEntry).toContain("@layer reset");
    expect(tailwindEntry).toContain("@layer features");

    const duplicateEntries = walkCss(path.join(repoRoot, "src"))
      .filter((filePath) => path.relative(repoRoot, filePath) !== path.join("src", "cloud-globals.css"))
      .filter((filePath) => /^\s*@tailwind\s+(?:base|components|utilities)\s*;/m.test(readFileSync(filePath, "utf8")));
    expect(duplicateEntries).toEqual([]);
  });

  it("keeps Viewer editor authority above runtime CSS without coupling it to a Style profile", () => {
    const sharedEntry = source("packages/shared-ui/src/styles/shared-ui.css");
    const editorEntry = source("packages/shared-ui/src/styles/editor.css");
    const editableTable = source("packages/shared-ui/src/styles/editor/editable-table.css");
    const editorChrome = source("packages/shared-ui/src/styles/editor/editor-chrome.css");
    const puppyflowEditor = source("packages/shared-ui/src/styles/editor/puppyflow-editor.css");
    const interfaceSkinContract = source("src/styles/interface-skin-contract.css");
    const xpTableProjection = source("src/styles/interfaces/windows-xp/surfaces/editable-table.css");
    const xpDocumentProjection = source("src/styles/interfaces/windows-xp/surfaces/document.css");
    const xpEditorControlsProjection = source("src/styles/interfaces/windows-xp/surfaces/editor-controls.css");
    const xpSettings = source("src/styles/interfaces/windows-xp/settings.css");

    expect(sharedEntry).toContain('@import "./shared-ui-patterns.css";');
    expect(sharedEntry).toContain('@import "./editor.css";');
    expect(editorEntry).toContain('@import "./editor/markdown-editor.css";');
    expect(editorEntry).not.toContain("data-interface-style");
    expect(editableTable).toContain("--po-surface-editable-table-border");
    expect(xpTableProjection).toContain("--po-surface-editable-table-border: #86a5d4");
    expect(xpTableProjection).toContain(".po-viewer-surface-boundary");
    expect(xpTableProjection).toContain('[data-interface-style="windows-xp"]');
    expect(xpTableProjection).not.toContain("data-editor-presentation");
    expect(xpTableProjection).not.toMatch(/\.(?:cm-|markdown-codemirror-editor|csv-table-editor)/);
    expect(xpDocumentProjection).toContain("--po-text: #303236");
    expect(xpDocumentProjection).toContain(".po-viewer-surface-boundary");
    expect(xpDocumentProjection).toContain('[data-interface-style="windows-xp"]');
    expect(xpDocumentProjection).not.toContain("data-editor-presentation");
    expect(xpDocumentProjection).not.toMatch(/\.(?:cm-|markdown-codemirror-editor|csv-table-editor)/);
    expect(xpEditorControlsProjection).toContain("--po-surface-editor-mode-radius: 2px");
    expect(xpEditorControlsProjection).toContain("--po-surface-editor-card-radius: 2px");
    expect(xpEditorControlsProjection).toContain(".po-viewer-surface-boundary");
    expect(xpEditorControlsProjection).not.toMatch(/\.(?:editor-mode-toggle|puppyflow-)/);
    expect(editorChrome).toContain("var(--po-surface-editor-mode-radius, 6px)");
    expect(puppyflowEditor).toContain("var(--po-surface-editor-card-radius, 0)");
    expect(interfaceSkinContract).not.toMatch(/\.(?:editor-mode-toggle|puppyflow-)/);
    expect(interfaceSkinContract).not.toContain("data-editor-presentation");

    expect(xpSettings).toMatch(
      /:where\(\.desktop-settings-view, \.desktop-dialog-surface, \.onboarding-shell\)\s+:where\(\.desktop-settings-select, input/s,
    );
    expect(xpSettings).not.toMatch(
      /:where\(\.app-shell, \.onboarding-shell, \.desktop-overlay-root\)\s+:where\([^)]*input/s,
    );
  });
});

function source(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function expectInOrder(sourceText: string, needles: string[]) {
  let cursor = -1;
  for (const needle of needles) {
    const next = sourceText.indexOf(needle, cursor + 1);
    expect(next, needle).toBeGreaterThan(cursor);
    cursor = next;
  }
}

function walkCss(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkCss(filePath);
    return statSync(filePath).isFile() && filePath.endsWith(".css") ? [filePath] : [];
  });
}
