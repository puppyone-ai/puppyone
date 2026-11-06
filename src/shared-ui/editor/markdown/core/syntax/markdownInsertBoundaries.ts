import { ensureSyntaxTree } from "@codemirror/language";
import type { EditorState, Text } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";
import { getMarkdownFrontMatterEndLine } from "./markdownFrontMatter";

export type MarkdownInsertBlock = Readonly<{ from: number; to: number }>;
export type MarkdownInsertBoundaries = Readonly<{
  bodyFrom: number;
  blocks: readonly MarkdownInsertBlock[];
  endAllowed: boolean;
}>;

const cache = new WeakMap<Text, { tree: Tree; boundaries: MarkdownInsertBoundaries }>();

/** Use the canonical parser, including its dialect extensions. A partial tree
 * cannot establish a safe boundary (a paragraph or fence may continue below it).
 * Parsing is bounded and resumes on a later drag/layout event if necessary. */
export function getMarkdownInsertBoundaries(state: EditorState): MarkdownInsertBoundaries | null {
  const tree = ensureSyntaxTree(state, state.doc.length, 8);
  if (!tree || tree.topNode.name !== "Document") return null;
  const previous = cache.get(state.doc);
  if (previous?.tree === tree) return previous.boundaries;
  const frontMatterEnd = getMarkdownFrontMatterEndLine(state.doc);
  const bodyFrom = frontMatterEnd === null ? 0 : Math.min(state.doc.length, state.doc.line(frontMatterEnd).to + 1);
  const blocks: MarkdownInsertBlock[] = [];
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (node.from >= bodyFrom && node.to > node.from) {
      // Lezer may start after indentation (notably indented code). Keep those
      // spaces with the original block when an image is inserted before it.
      const line = state.doc.lineAt(node.from);
      const from = state.doc.sliceString(line.from, node.from).trim() === "" ? line.from : node.from;
      blocks.push({ from, to: node.to });
    }
  }
  const boundaries = { bodyFrom, blocks, endAllowed: !hasOpenTail(tree.topNode.lastChild, state.doc) };
  cache.set(state.doc, { tree, boundaries });
  return boundaries;
}

/** Recheck delayed drops after mapping through edits: never split a block that
 * has grown across the former boundary, or write into document metadata. */
export function isMarkdownInsertBoundary(state: EditorState, position: number): boolean {
  const boundaries = getMarkdownInsertBoundaries(state);
  if (!boundaries || position < boundaries.bodyFrom || position > state.doc.length) return false;
  if (!boundaries.endAllowed && position >= (boundaries.blocks.at(-1)?.to ?? state.doc.length)) return false;
  let low = 0;
  let high = boundaries.blocks.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (boundaries.blocks[middle].to <= position) low = middle + 1;
    else high = middle;
  }
  return low === boundaries.blocks.length || position <= boundaries.blocks[low].from;
}

/** Blank lines do not close these CommonMark blocks. Inserting at their tail
 * would save literal image syntax inside code/HTML instead of an image. */
function hasOpenTail(node: SyntaxNode | null, doc: Text): boolean {
  if (!node) return false;
  if (node.name === "FencedCode") {
    return node.lastChild?.name !== "CodeMark" || node.firstChild?.from === node.lastChild.from;
  }
  if (!["HTMLBlock", "CommentBlock", "ProcessingInstructionBlock"].includes(node.name)) return false;
  const source = doc.sliceString(node.from, node.to).trimStart();
  if (source.startsWith("<!--")) return !source.includes("-->");
  if (source.startsWith("<?")) return !source.includes("?>");
  if (source.startsWith("<![CDATA[")) return !source.includes("]]>");
  if (/^<![A-Z]/u.test(source)) return !source.includes(">");
  // Match the installed Markdown parser's raw-HTML terminators. General HTML
  // tags (including textarea here) end at the blank line supplied on insertion.
  return /^<(?:script|pre|style)(?:\s|>|$)/iu.test(source)
    && !/<\/(?:script|pre|style)>/iu.test(source);
}
