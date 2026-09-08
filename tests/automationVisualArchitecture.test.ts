import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const automationStylePaths = [
  "shell-and-catalog.css",
  "template-card.css",
  "existing-automations.css",
  "responsive.css",
  "provider-sidebar.css",
  "connections.css",
] as const;
const automationDialogStylePaths = [
  "shell.css",
  "creation-map.css",
  "builder-and-resources.css",
  "management.css",
  "responsive.css",
] as const;
const automationCss = automationStylePaths
  .map((path) => readFileSync(new URL(`../src/features/automation/styles/${path}`, import.meta.url), "utf8"))
  .join("\n");
const automationManifest = readFileSync(
  new URL("../src/features/automation/automation.css", import.meta.url),
  "utf8",
);
const automationDialogManifest = readFileSync(
  new URL("../src/features/automation/automation-dialog.css", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const automationView = readFileSync(
  new URL("../src/features/automation/CloudProjectAutomationView.tsx", import.meta.url),
  "utf8",
);

describe("Automation landing visual architecture", () => {
  it("keeps the reference first-screen spacing rhythm", () => {
    const catalog = compact(readCssBlock(automationCss, ".desktop-cloud-automation-catalog"));
    const tabs = compact(readCssBlock(automationCss, ".desktop-cloud-automation-category-tabs"));
    const grid = compact(readCssBlock(automationCss, ".desktop-cloud-automation-template-grid"));
    const card = compact(readCssBlock(automationCss, ".desktop-cloud-automation-template-card"));

    expect(catalog).toContain("padding: var(--desktop-cloud-page-padding-top) var(--desktop-cloud-page-padding-inline) var(--desktop-cloud-page-padding-bottom);");
    expect(tabs).toContain("margin-top: 26px;");
    expect(grid).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(grid).toContain("gap: 14px;");
    expect(grid).toContain("margin-top: 11px;");
    expect(card).toContain("min-height: 156px;");
    expect(card).toContain("border-radius: 13px;");
  });

  it("derives card surfaces and text from PuppyOne theme tokens", () => {
    const card = compact(readCssBlock(automationCss, ".desktop-cloud-automation-template-card"));
    const description = compact(readCssBlock(automationCss, ".desktop-cloud-automation-template-card p"));

    expect(card).toContain("border: 1px solid var(--po-border-subtle);");
    expect(card).toContain("var(--po-panel)");
    expect(card).toContain("var(--po-canvas)");
    expect(card).toContain("color: var(--po-text);");
    expect(description).toContain("color: var(--po-text-muted);");
  });

  it("locks typography and controls to the original Git visual baseline", () => {
    const title = compact(readCssBlock(automationCss, ".desktop-cloud-automation-landing-copy h1"));
    const description = compact(readCssBlock(automationCss, ".desktop-cloud-automation-landing-copy p"));
    const primaryAction = compact(readCssBlock(automationCss, ".desktop-cloud-automation-new-button"));
    const categoryAction = compact(readCssBlock(automationCss, ".desktop-cloud-automation-category-tabs button"));
    const cardTitle = compact(readCssBlock(automationCss, ".desktop-cloud-automation-template-card h2"));
    const cardDescription = compact(readCssBlock(automationCss, ".desktop-cloud-automation-template-card p"));
    const cardAction = compact(readCssBlock(automationCss, ".desktop-cloud-automation-template-add"));

    expect(title).toContain("font-size: var(--po-text-size-page-title, 20px);");
    expect(description).toContain("font-size: var(--po-text-size-body-lg, 14px);");
    expect(primaryAction).toContain("height: var(--po-control-size);");
    expect(primaryAction).toContain("padding: 0 11px;");
    expect(primaryAction).toContain("font-size: var(--po-text-size-body, 13px);");
    expect(primaryAction).toContain("line-height: 18px;");
    expect(categoryAction).toContain("height: var(--po-control-size-compact);");
    expect(categoryAction).toContain("padding: 0 11px;");
    expect(categoryAction).toContain("font-size: var(--po-text-size-body, 13px);");
    expect(cardTitle).toContain("font-size: var(--po-text-size-body-lg, 14px);");
    expect(cardTitle).toContain("line-height: 19px;");
    expect(cardDescription).toContain("font-size: var(--po-text-size-body, 13px);");
    expect(cardDescription).toContain("line-height: 18px;");
    expect(cardAction).toContain("min-width: 42px;");
    expect(cardAction).toContain("height: var(--po-control-size-compact);");
    expect(cardAction).toContain("padding: 0 9px;");
    expect(cardAction).toContain("font-size: var(--po-text-size-body, 13px);");
  });

  it("keeps Automation CSS split, ordered, layered, and owned by the feature", () => {
    const expectedManifest = automationStylePaths
      .map((path) => `@import "./styles/${path}" layer(features);`)
      .concat('@import "./automation-dialog.css";')
      .join("\n");
    const expectedDialogManifest = automationDialogStylePaths
      .map((path) => `@import "./styles/dialog/${path}" layer(features);`)
      .join("\n");

    expect(automationManifest.trim()).toBe(expectedManifest);
    expect(automationDialogManifest.trim()).toBe(expectedDialogManifest);
    expect(automationView).toContain('import "./automation.css";');
    expect(globalStyles).not.toContain("features/automation/automation.css");
    expect(globalStyles).not.toContain("features/automation/automation-dialog.css");
  });
});

function readCssBlock(css: string, selector: string): string {
  const marker = `${selector} {`;
  const lineMarker = `\n${marker}`;
  const lineStart = css.indexOf(lineMarker);
  const start = css.startsWith(marker) ? 0 : lineStart >= 0 ? lineStart + 1 : -1;
  if (start < 0) throw new Error(`Missing CSS block for ${selector}`);
  const bodyStart = start + marker.length;
  const end = css.indexOf("\n}", bodyStart);
  if (end < 0) throw new Error(`Unclosed CSS block for ${selector}`);
  return css.slice(bodyStart, end);
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
