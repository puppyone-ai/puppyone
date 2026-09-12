

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const editorFindStyles = readFileSync(
  "packages/shared-ui/src/styles/editor/editor-find.css",
  "utf8",
);

describe("editor find architecture", () => {
  it("keeps the find overlay host out of the editor flex and overflow contracts", () => {
    const ruleStart = editorFindStyles.indexOf(".editor-find-host {");
    const hostRule = editorFindStyles.slice(ruleStart, editorFindStyles.indexOf("}", ruleStart) + 1);
    expect(hostRule).toContain("position: relative");
    expect(hostRule).toContain("width: 100%");
    expect(hostRule).toContain("height: 100%");
    expect(hostRule).toContain("overflow: visible");
    expect(hostRule).not.toContain("display: flex");
    expect(hostRule).not.toContain("overflow: hidden");
    expect(editorFindStyles).not.toContain(".editor-find-host > :not(.editor-find-widget)");
  });

  it("keeps the find widget compact and separates primary input from secondary controls", () => {
    const widgetRuleStart = editorFindStyles.indexOf(".editor-find-widget {");
    const widgetRule = editorFindStyles.slice(
      widgetRuleStart,
      editorFindStyles.indexOf("}", widgetRuleStart) + 1,
    );
    expect(widgetRule).toContain("width: min(304px, calc(100% - 24px))");
    expect(widgetRule).toContain("height: var(--po-control-size)");
    expect(widgetRule).toContain("var(--po-panel-raised)");
    expect(widgetRule).toContain("var(--po-border-subtle)");
    expect(widgetRule).toContain("border-radius: 8px");

    const resultRuleStart = editorFindStyles.indexOf(".editor-find-widget__result {");
    const resultRule = editorFindStyles.slice(
      resultRuleStart,
      editorFindStyles.indexOf("}", resultRuleStart) + 1,
    );
    expect(resultRule).toContain("border-inline-start: 1px solid var(--po-divider)");
    expect(resultRule).toContain("font-variant-numeric: tabular-nums");
    expect(editorFindStyles).toContain(".editor-find-widget__result:empty");

    const focusRuleStart = editorFindStyles.indexOf(".editor-find-widget:focus-within {");
    const focusRule = editorFindStyles.slice(
      focusRuleStart,
      editorFindStyles.indexOf("}", focusRuleStart) + 1,
    );
    expect(focusRule).toContain("var(--po-text-muted)");
    expect(focusRule).not.toContain("box-shadow");
    expect(focusRule).not.toContain("var(--po-accent)");
    expect(editorFindStyles).not.toContain(".editor-find-widget input:focus-visible");
  });
});
