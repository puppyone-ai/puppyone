import { describe, expect, it } from "vitest";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import {
  canonicalizeMarkdownHref,
  getSafeMarkdownHref,
  isSafeHref,
} from "../../../../../../packages/shared-ui/src/editor/markdown/platform/policy/markdownUrlPolicy";
import { compileInlineHtmlRenderPlan } from "../../../../../../packages/shared-ui/src/editor/markdown/features/html/inlineHtmlPolicy";
import { getMarkdownInlineHtml } from "../../../../../../packages/shared-ui/src/editor/markdown/features/html/inlineHtmlModel";
import {
  puppyMarkdownFeatureCompositionExtension,
  puppyMarkdownParserExtensions,
} from "../../../../../../packages/shared-ui/src/editor/markdown/composition/markdownFeatureComposition";

function createMarkdownState(source: string) {
  return EditorState.create({
    doc: source,
    extensions: [
      puppyMarkdownFeatureCompositionExtension,
      markdown({ base: markdownLanguage, extensions: puppyMarkdownParserExtensions }),
    ],
  });
}

describe("Markdown URL policy (P0 scheme bypass)", () => {
  it("rejects control-character obfuscated javascript: schemes", () => {
    expect(isSafeHref("java\nscript:alert(1)")).toBe(false);
    expect(isSafeHref("java\tscript:alert(1)")).toBe(false);
    expect(canonicalizeMarkdownHref("java\nscript:alert(1)")).toBe("java\nscript:alert(1)");
    expect(getSafeMarkdownHref("java\nscript:alert(1)")).toBeNull();
  });

  it("rejects HTML-entity obfuscated javascript: schemes after decode", () => {
    expect(isSafeHref("java&#10;script:alert(1)")).toBe(false);
    expect(isSafeHref("javascript&#58;alert(1)")).toBe(false);
  });

  it("rejects vbscript and data schemes", () => {
    expect(isSafeHref("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeHref("data:text/html,<script>alert(1)</script>")).toBe(false);
  });

  it("rejects scheme-relative URLs, encoded controls, and credentials", () => {
    expect(isSafeHref("//evil.example/path")).toBe(false);
    expect(isSafeHref("https://example.com/%0aheader")).toBe(false);
    expect(isSafeHref("https://user:pass@example.com/path")).toBe(false);
  });

  it("allows https and relative paths", () => {
    expect(isSafeHref("https://example.com/a")).toBe(true);
    expect(isSafeHref("./note.md")).toBe(true);
    expect(isSafeHref("#section")).toBe(true);
    expect(isSafeHref("note.md")).toBe(true);
    expect(getSafeMarkdownHref("HTTPS://EXAMPLE.COM/a")).toBe("https://example.com/a");
  });

  it("compiles unsafe HTML anchors to unsupported visible source", () => {
    const source = '<a href="java&#10;script:alert(1)">x</a>';
    const element = getMarkdownInlineHtml(createMarkdownState(source)).find((item) => item.tagName === "a");
    expect(element).toBeDefined();
    const plan = compileInlineHtmlRenderPlan(element!);
    expect(plan.supported).toBe(false);
  });

  it("compiles safe HTML anchors without a live href attribute", () => {
    const source = '<a href="https://example.com">x</a>';
    const element = getMarkdownInlineHtml(createMarkdownState(source)).find((item) => item.tagName === "a");
    const plan = compileInlineHtmlRenderPlan(element!);
    expect(plan.supported).toBe(true);
    if (plan.supported && plan.value.kind === "mark") {
      expect(plan.value.attributes.href).toBeUndefined();
      expect(plan.value.attributes["data-md-href"]).toBe("https://example.com/");
    }
  });
});
