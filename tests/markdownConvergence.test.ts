/**
 * @vitest-environment happy-dom
 */
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";
import { renderMarkdownInlineFromSharedPolicy } from "../packages/shared-ui/src/editor/markdown/composition/preview/markdownInlinePlanAdapter";
import {
  markdownCodeMirrorBaseExtensions,
  markdownLivePreviewExtension,
} from "../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";
import { getMarkdownPlanIndex } from "../packages/shared-ui/src/editor/markdown/core/plans/markdownPlanIndex";
import { isTagAllowedInProfile } from "../packages/shared-ui/src/editor/markdown/platform/policy/markdownHtmlProfiles";
import { createSanitizedBlockHtmlFragment } from "../packages/shared-ui/src/editor/markdown/features/html/sanitizeHtml";
import { isSafeStyleValue } from "../packages/shared-ui/src/editor/markdown/platform/policy/markdownHtmlSanitizerPolicy";
import {
  MERMAID_MAX_SOURCE_BYTES,
  mountSanitizedMermaidSvg,
  renderMermaidDiagram,
  sanitizeMermaidSvg,
} from "../packages/shared-ui/src/editor/markdown/features/mermaid/mermaidRenderer";
import {
  puppyMarkdownFeatureCompositionExtension,
  puppyMarkdownParserExtensions,
} from "../packages/shared-ui/src/editor/markdown/composition/markdownFeatureComposition";

function createMarkdownState(source: string) {
  return EditorState.create({
    doc: source,
    extensions: [
      puppyMarkdownFeatureCompositionExtension,
      markdown({ base: markdownLanguage, extensions: puppyMarkdownParserExtensions }),
    ],
  });
}

async function flushAsyncRendering() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("Markdown semantic-plan convergence", () => {
  it("compiles one complete image semantic payload into the image plan", () => {
    const plans = getMarkdownPlanIndex(createMarkdownState('![diagram](assets/a.png "Architecture")'));
    const image = plans.find(({ plan }) => plan.presentation === "inlineAtom" && plan.atom.kind === "image");
    expect(image?.plan.presentation).toBe("inlineAtom");
    if (image?.plan.presentation === "inlineAtom" && image.plan.atom.kind === "image") {
      expect(image.plan.atom).toEqual({
        kind: "image",
        alt: "diagram",
        href: "assets/a.png",
        title: "Architecture",
        referenceKind: "markdown-path",
        displayMode: "block",
      });
      expect(image.plan.diagnostics).toEqual([]);
    }
  });

  it("represents task checkboxes as inline atoms and horizontal rules as block atoms", () => {
    const plans = getMarkdownPlanIndex(createMarkdownState("- [x] shipped\n\n---"));
    expect(plans.some(({ plan }) => (
      plan.presentation === "inlineAtom" &&
      plan.atom.kind === "taskCheckbox" &&
      plan.atom.checked
    ))).toBe(true);
    expect(plans.some(({ plan }) => (
      plan.presentation === "blockAtom" && plan.embed.kind === "horizontalRule"
    ))).toBe(true);
  });

  it("renders horizontal rules and task checkboxes from their compiled plans", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "---\n- [x] shipped",
        extensions: [
          ...markdownCodeMirrorBaseExtensions(false),
          markdownLivePreviewExtension("safe", null, "note.md", null),
        ],
      }),
    });
    expect(view.dom.querySelector(".cm-md-hr-widget")).not.toBeNull();
    const checkbox = view.dom.querySelector<HTMLButtonElement>(".cm-md-task-checkbox-widget");
    expect(checkbox).toBeInstanceOf(HTMLButtonElement);
    expect(checkbox?.type).toBe("button");
    expect(checkbox?.getAttribute("role")).toBe("checkbox");
    expect(checkbox?.getAttribute("aria-checked")).toBe("true");
    view.destroy();
    parent.remove();
  });
});

describe("Markdown HTML profile convergence", () => {
  it("does not upgrade base sanitizer profiles merely because a media tag appears", () => {
    expect(isTagAllowedInProfile("img", "inline")).toBe(false);
    expect(isTagAllowedInProfile("img", "block")).toBe(false);
    expect(isTagAllowedInProfile("img", "inline", { brokeredMedia: true })).toBe(true);
    expect(isTagAllowedInProfile("video", "block")).toBe(false);
    expect(isTagAllowedInProfile("source", "block")).toBe(false);
    expect(isTagAllowedInProfile("video", "block", { deferredMedia: true })).toBe(true);
    expect(isTagAllowedInProfile("source", "block", { deferredMedia: true })).toBe(true);
    expect(isTagAllowedInProfile("audio", "inline", { brokeredMedia: true })).toBe(false);
  });

  it("turns Mermaid anchor navigation into brokered intents while preserving local paint references", () => {
    const sanitized = sanitizeMermaidSvg(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <defs><path id="shape" d="M0 0h1v1z" /></defs>
        <use href="#shape" />
        <use href="#outside-host-id" />
        <a href="https://example.com/path" onclick="alert(1)"><text>Open</text></a>
        <image href="https://tracker.example/pixel.png" style="fill: url(https://tracker.example/a)" />
        <foreignObject><div>HTML</div></foreignObject>
      </svg>
    `);
    const host = document.createElement("div");
    const openHref = vi.fn();
    const mount = mountSanitizedMermaidSvg(host, sanitized, openHref);
    const shadowRoot = mount.element.shadowRoot;
    const uses = shadowRoot?.querySelectorAll("use") ?? [];
    expect(uses[0]?.getAttribute("href")).toBe("#shape");
    expect(uses[1]?.hasAttribute("href")).toBe(false);
    const anchor = shadowRoot?.querySelector("a");
    expect(anchor?.hasAttribute("href")).toBe(false);
    expect(anchor?.getAttribute("data-md-href")).toBe("https://example.com/path");
    expect(anchor?.hasAttribute("onclick")).toBe(false);
    expect(shadowRoot?.querySelector("image")?.hasAttribute("href")).toBe(false);
    expect(shadowRoot?.querySelector("image")?.hasAttribute("style")).toBe(false);
    expect(shadowRoot?.querySelector("foreignObject")).toBeNull();

    anchor?.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(openHref).toHaveBeenCalledWith("https://example.com/path");
    mount.dispose();
    expect(host.childElementCount).toBe(0);
  });

  it("rejects oversized Mermaid source before loading the renderer", async () => {
    await expect(renderMermaidDiagram({ source: "x".repeat(MERMAID_MAX_SOURCE_BYTES + 1) }))
      .rejects.toThrow(/source exceeds/i);
  });

  it("reduces event capability while preserving profile-approved attributes", () => {
    const result = createSanitizedBlockHtmlFragment(
      '<div onclick="alert(1)"><time datetime="2026-07-10">Today</time></div>',
    );
    expect(result.supported).toBe(true);
    const div = result.fragment.querySelector("div");
    expect(div?.hasAttribute("onclick")).toBe(false);
    expect(div?.querySelector("time")?.getAttribute("datetime")).toBe("2026-07-10");
  });

  it("does not let CSS variables or unbounded geometry bypass presentation policy", () => {
    expect(isSafeStyleValue("color", "var(--text-accent, red)")).toBe(true);
    expect(isSafeStyleValue("border-color", "var(--border-color, red)")).toBe(true);
    expect(isSafeStyleValue("border", "var(--host-border)")).toBe(false);
    expect(isSafeStyleValue("border-width", "var(--host-border-width)")).toBe(false);
    expect(isSafeStyleValue("display", "var(--hide-content)")).toBe(false);
    expect(isSafeStyleValue("background", "var(--remote-background)")).toBe(false);
    expect(isSafeStyleValue("width", "999999px")).toBe(false);
    expect(isSafeStyleValue("width", "100%")).toBe(true);
    expect(isSafeStyleValue("margin-left", "-100px")).toBe(false);
    expect(isSafeStyleValue("overflow", "visible")).toBe(false);
  });
});

describe("Markdown isolated preview adapter convergence", () => {
  it("delegates raw HTML anchors to the host LinkBroker wrapper", () => {
    const target = document.createElement("div");
    const opened: string[] = [];
    renderMarkdownInlineFromSharedPolicy(target, '<a href="https://example.com/docs">Docs</a>', {
      openHref: (href) => opened.push(href),
    });

    const anchor = target.querySelector("a");
    expect(anchor?.hasAttribute("href")).toBe(false);
    expect(anchor?.dataset.mdHref).toBe("https://example.com/docs");
    anchor?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(opened).toEqual(["https://example.com/docs"]);
  });

  it("binds nested Markdown links exactly once inside sanitized HTML", () => {
    const target = document.createElement("div");
    const opened: string[] = [];
    renderMarkdownInlineFromSharedPolicy(
      target,
      "<span><em>[Docs](https://example.com/docs)</em></span>",
      { openHref: (href) => opened.push(href) },
    );
    target.querySelector("a")?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(opened).toEqual(["https://example.com/docs"]);
  });

  it("keeps raw HTML anchors inert when no LinkBroker wrapper is supplied", () => {
    const target = document.createElement("div");
    renderMarkdownInlineFromSharedPolicy(target, '<a href="https://example.com/docs">Docs</a>');
    const anchor = target.querySelector("a");
    expect(anchor?.hasAttribute("href")).toBe(false);
    expect(anchor?.hasAttribute("role")).toBe(false);
    expect(anchor?.hasAttribute("tabindex")).toBe(false);
  });

  it("keeps incomplete, blocked, and unsafe HTML visible as source", () => {
    for (const source of [
      "<span>unfinished",
      "<script>alert(1)</script>",
      '<a href="javascript:alert(1)">unsafe</a>',
    ]) {
      const target = document.createElement("div");
      renderMarkdownInlineFromSharedPolicy(target, source);
      expect(target.textContent).toBe(source);
      expect(target.querySelector("script, a, span")).toBeNull();
    }
  });

  it("does not mount Markdown or raw-HTML images without an AssetBroker wrapper", () => {
    const markdownTarget = document.createElement("div");
    renderMarkdownInlineFromSharedPolicy(markdownTarget, "![pixel](https://tracker.example/p.png)");
    expect(markdownTarget.querySelector("img")).toBeNull();
    expect(markdownTarget.querySelector(".cm-md-image-placeholder")?.textContent).toBe("pixel");

    const htmlTarget = document.createElement("div");
    const source = '<img src="https://tracker.example/p.png" alt="pixel">';
    renderMarkdownInlineFromSharedPolicy(htmlTarget, source);
    expect(htmlTarget.querySelector("img")).toBeNull();
    expect(htmlTarget.textContent).toBe(source);
  });

  it("resolves every raw HTML image source before enabling safe-media DOM", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const resolved: string[] = [];
    renderMarkdownInlineFromSharedPolicy(
      target,
      '<img src="https://tracker.example/p.png" alt="pixel">',
      {
        sourcePath: "notes/a.md",
        resolveAssetUrl: (_sourcePath, href) => {
          resolved.push(href);
          return "blob:https://app.example/broker-handle";
        },
      },
    );

    await flushAsyncRendering();
    expect(resolved).toEqual(["https://tracker.example/p.png"]);
    expect(target.querySelector("img")?.getAttribute("src")).toBe("blob:https://app.example/broker-handle");
    target.remove();
  });
});
