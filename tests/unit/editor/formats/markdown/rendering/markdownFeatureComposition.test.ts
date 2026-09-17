import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { WidgetType } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  createMarkdownFeatureComposition,
  markdownFeatureComposition,
  openKnowledgeMdxFeatureComposition,
  puppyMarkdownFeatureCompositionExtension,
  puppyMarkdownParserExtensions,
} from "../../../../../../packages/shared-ui/src/editor/markdown/composition/markdownFeatureComposition";
import { addMarkdownBlockAndLineDecorations } from "../../../../../../packages/shared-ui/src/editor/markdown/core/decorations/blockDecorations";
import { markdownFeatureCompositionFacet } from "../../../../../../packages/shared-ui/src/editor/markdown/core/features/markdownFeatureContract";
import { getMarkdownPlanIndex } from "../../../../../../packages/shared-ui/src/editor/markdown/core/plans/markdownPlanIndex";
import { getMarkdownElements } from "../../../../../../packages/shared-ui/src/editor/markdown/core/syntax/markdownElements";
import { imageFeature } from "../../../../../../packages/shared-ui/src/editor/markdown/features/image/imageFeature";
import { ImagePreviewWidget } from "../../../../../../packages/shared-ui/src/editor/markdown/features/image/imagePreviewWidget";

function createMarkdownState(source: string) {
  return EditorState.create({
    doc: source,
    extensions: [
      puppyMarkdownFeatureCompositionExtension,
      markdown({ base: markdownLanguage, extensions: puppyMarkdownParserExtensions }),
    ],
  });
}

const widgetContext = {
  htmlTrustMode: "safe" as const,
  markdownLinkGraph: null,
  documentPath: "notes/example.md",
  markdownAssetUrlResolver: null,
};

describe("static Markdown Feature Composition", () => {
  it("is frozen and owns each registered capability exactly once", () => {
    expect(Object.isFrozen(markdownFeatureComposition)).toBe(true);
    expect(Object.isFrozen(markdownFeatureComposition.manifest)).toBe(true);
    expect(Object.isFrozen(markdownFeatureComposition.parserExtensions)).toBe(true);
    expect(Object.isFrozen(markdownFeatureComposition.livePreviewExtensions)).toBe(true);
    expect(markdownFeatureComposition.livePreviewExtensions.length).toBeGreaterThan(0);

    const ids = markdownFeatureComposition.manifest.map((feature) => feature.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "media-syntax",
      "code-block",
      "math",
      "mermaid",
      "html",
      "table",
      "video",
      "image",
    ]);

    const semanticKinds = markdownFeatureComposition.manifest.flatMap((feature) => feature.semanticKinds);
    const inlineWidgetKinds = markdownFeatureComposition.manifest.flatMap((feature) => feature.inlineWidgetKinds);
    const blockWidgetKinds = markdownFeatureComposition.manifest.flatMap((feature) => feature.blockWidgetKinds);
    expect(new Set(semanticKinds).size).toBe(semanticKinds.length);
    expect(new Set(inlineWidgetKinds).size).toBe(inlineWidgetKinds.length);
    expect(new Set(blockWidgetKinds).size).toBe(blockWidgetKinds.length);
    expect(semanticKinds).toEqual(expect.arrayContaining([
      "fence",
      "htmlBlock",
      "inlineHtml",
      "mathBlock",
      "mathInline",
      "table",
      "video",
      "image",
    ]));
    expect(blockWidgetKinds).toEqual(expect.arrayContaining([
      "codeBlock",
      "mermaid",
      "htmlBlock",
      "mathBlock",
      "table",
      "video",
    ]));
    expect(inlineWidgetKinds).toEqual(["mathInline", "image"]);
  });

  it("adds declarative MDX components only to the OpenKnowledge dialect", () => {
    expect(markdownFeatureComposition.manifest.map((feature) => feature.id))
      .not.toContain("mdx-component");
    expect(openKnowledgeMdxFeatureComposition.manifest.map((feature) => feature.id))
      .toEqual(expect.arrayContaining(["mdx-component", "html", "table"]));

    const mdxEntry = openKnowledgeMdxFeatureComposition.manifest.find((feature) => (
      feature.id === "mdx-component"
    ));
    expect(mdxEntry).toMatchObject({
      semanticKinds: ["mdxComponent"],
      blockWidgetKinds: ["mdxComponent"],
    });
  });

  it("fails fast for duplicate ids and semantic owners", () => {
    expect(() => createMarkdownFeatureComposition([imageFeature, imageFeature]))
      .toThrow(/Duplicate Markdown feature id/);
    expect(() => createMarkdownFeatureComposition([
      imageFeature,
      { ...imageFeature, id: "image-copy" },
    ])).toThrow(/Duplicate Markdown semantic compiler image/);
  });

  it.each([
    ["code block", "```ts\nconst value = 1;\n```", "fence", "codeBlock"],
    ["Mermaid", "```mermaid\ngraph TD; A-->B\n```", "fence", "mermaid"],
    ["HTML", "<div>safe</div>", "htmlBlock", "htmlBlock"],
    ["table", "| A |\n| --- |\n| B |", "table", "table"],
    ["video", "![[media/demo.mp4]]", "video", "video"],
  ])("runs %s through detect, compile, and the registered block widget", (
    _label,
    source,
    semanticKind,
    embedKind,
  ) => {
    const plans = getMarkdownPlanIndex(createMarkdownState(source));
    const entry = plans.find(({ element, plan }) => (
      element.kind === semanticKind
      && plan.presentation === "blockAtom"
      && plan.embed.kind === embedKind
    ));
    expect(entry).toBeDefined();
    if (!entry || entry.plan.presentation !== "blockAtom") return;
    expect(markdownFeatureComposition.createBlockWidget(entry.plan, widgetContext)).not.toBeNull();
  });

  it("creates an image widget only from the compiled plan payload", () => {
    const source = '![authored alt](assets/from-plan.png "Plan title")';
    const plan = getMarkdownPlanIndex(createMarkdownState(source))
      .find(({ plan: candidate }) => (
        candidate.presentation === "inlineAtom" && candidate.atom.kind === "image"
      ))?.plan;
    expect(plan?.presentation).toBe("inlineAtom");
    if (plan?.presentation !== "inlineAtom" || plan.atom.kind !== "image") return;

    const widget = markdownFeatureComposition.createInlineWidget(plan, widgetContext);
    const expected = new ImagePreviewWidget(
      plan.sourceRange.from,
      plan.sourceRange.to,
      "authored alt",
      "assets/from-plan.png",
      "Plan title",
      widgetContext.documentPath,
      "assets/from-plan.png",
      "block",
    );
    expect(widget?.eq(expected)).toBe(true);
  });

  it.each([
    [
      "standard Markdown with spaces",
      "![Context Base](asserts/Screenshot 2026-07-15 at 10.07.43 PM.png)",
      "asserts/Screenshot 2026-07-15 at 10.07.43 PM.png",
    ],
    ["Obsidian media", "![[assets/diagram.png|Diagram]]", "assets/diagram.png"],
  ])("produces one complete image element and one plan for %s", (_label, source, href) => {
    const state = createMarkdownState(source);
    const imageElements = getMarkdownElements(state).filter((element) => element.kind === "image");
    const imagePlans = getMarkdownPlanIndex(state).filter(({ plan }) => (
      plan.presentation === "inlineAtom" && plan.atom.kind === "image"
    ));

    expect(imageElements).toHaveLength(1);
    expect(imageElements[0]?.blockData).toMatchObject({ kind: "image", href });
    expect(imageElements[0]?.blockData).toMatchObject({ displayMode: "block" });
    expect(imagePlans).toHaveLength(1);
  });

  it("classifies only a line-owning image as block media", () => {
    const blockPlan = getMarkdownPlanIndex(createMarkdownState("  ![wide](assets/wide.png)  "))
      .find(({ plan }) => plan.presentation === "inlineAtom" && plan.atom.kind === "image")?.plan;
    const inlinePlan = getMarkdownPlanIndex(createMarkdownState("Before ![icon](assets/icon.png) after"))
      .find(({ plan }) => plan.presentation === "inlineAtom" && plan.atom.kind === "image")?.plan;

    expect(blockPlan?.presentation === "inlineAtom" && blockPlan.atom.kind === "image"
      ? blockPlan.atom.displayMode
      : null).toBe("block");
    expect(inlinePlan?.presentation === "inlineAtom" && inlinePlan.atom.kind === "image"
      ? inlinePlan.atom.displayMode
      : null).toBe("inline");
  });

  it("passes the real trust mode through the generic inline Feature context", () => {
    let receivedTrustMode: string | null = null;
    class TestWidget extends WidgetType {
      toDOM() {
        return document.createElement("span");
      }
    }
    const capturingImageFeature = {
      ...imageFeature,
      id: "capturing-image",
      createInlineWidget(_plan: Parameters<NonNullable<typeof imageFeature.createInlineWidget>>[0], context: Parameters<NonNullable<typeof imageFeature.createInlineWidget>>[1]) {
        receivedTrustMode = context.htmlTrustMode;
        return new TestWidget();
      },
    };
    const composition = createMarkdownFeatureComposition([capturingImageFeature]);
    const state = EditorState.create({
      doc: "![diagram](assets/diagram.png)",
      extensions: [
        markdownFeatureCompositionFacet.of(composition),
        markdown({ base: markdownLanguage }),
      ],
    });
    const builders = { decorations: [], atomicRanges: [] };

    addMarkdownBlockAndLineDecorations(
      state,
      builders,
      null,
      null,
      null,
      "localTrusted",
      null,
      "note.md",
      null,
    );

    expect(receivedTrustMode).toBe("localTrusted");
  });

  it("leaves unsupported media envelopes as exact visible source", () => {
    const source = "![[archive/file.bin]]";
    const state = createMarkdownState(source);
    const plans = getMarkdownPlanIndex(state);
    expect(plans.some(({ plan }) => plan.presentation === "blockAtom")).toBe(false);
    expect(state.doc.toString()).toBe(source);
  });
});
