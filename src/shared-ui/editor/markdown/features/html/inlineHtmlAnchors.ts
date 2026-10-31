import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { Tree } from "@lezer/common";
import { getMarkdownInlineHtmlInRange } from "./inlineHtmlModel";
import { compileInlineHtmlRenderPlan } from "./inlineHtmlPolicy";

type RelativeAnchor = Readonly<{ id: string; offset: number }>;
const blockAnchors = new WeakMap<Tree, readonly RelativeAnchor[]>();
const documentAnchors = new WeakMap<object, {
  tree: Tree;
  positions: ReadonlyMap<string, number>;
}>();

/**
 * Source positions, independent of DOM mounting or source reveal. Unchanged
 * parser subtrees reuse their relative targets after edits; selection-only
 * transactions reuse the document lookup without rescanning HTML.
 */
export function getMarkdownInlineHtmlAnchors(state: EditorState): ReadonlyMap<string, number> {
  const tree = syntaxTree(state);
  const cached = documentAnchors.get(state.doc);
  if (cached?.tree === tree) return cached.positions;
  const positions = new Map<string, number>();

  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    const subtree = node.tree;
    let anchors = subtree ? blockAnchors.get(subtree) : undefined;
    if (!anchors) {
      const collected: RelativeAnchor[] = [];
      for (const element of getMarkdownInlineHtmlInRange(state, node.from, node.to)) {
        const policy = compileInlineHtmlRenderPlan(element);
        if (!policy.supported || policy.value.kind !== "mark") continue;
        const scopedId = policy.value.attributes.id;
        if (!scopedId) continue;
        // Consume the same controlled ID as the projection, not raw attributes.
        collected.push({ id: scopedId.slice("md-doc-".length), offset: element.from - node.from });
      }
      anchors = collected;
      if (subtree) blockAnchors.set(subtree, anchors);
    }
    for (const anchor of anchors) {
      if (!positions.has(anchor.id)) positions.set(anchor.id, node.from + anchor.offset);
    }
  }
  documentAnchors.set(state.doc, { tree, positions });
  return positions;
}
