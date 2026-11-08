import { ensureSyntaxTree } from "@codemirror/language";
import type { EditorState, Text } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";
import { getMarkdownFrontMatterEndLine } from "./markdownFrontMatter";
import { readMarkdownListItem } from "./markdownListStructure";

export type MarkdownInsertBlock = Readonly<{ from: number; to: number }>;
export type MarkdownInsertBoundaries = Readonly<{
  bodyFrom: number;
  blocks: readonly MarkdownInsertBlock[];
  endAllowed: boolean;
}>;

const cache = new WeakMap<Text, { tree: Tree; boundaries: MarkdownInsertBoundaries }>();
type ImageInsertBlock = MarkdownInsertBlock & Readonly<{ indentAfter: string; afterAllowed: boolean }>;
type ImageInsertBoundaries = Omit<MarkdownInsertBoundaries, "blocks"> & { blocks: readonly ImageInsertBlock[] };
const imageCache = new WeakMap<Text, { tree: Tree; boundaries: ImageInsertBoundaries }>();

/** A list is a container, not one paragraph. Expose its child block boundaries
 * while retaining the owning item's continuation indent for image insertion.
 * Quotes, tables, fences and other leaf blocks remain indivisible. */
export function getMarkdownImageInsertBoundaries(state: EditorState): ImageInsertBoundaries | null {
  const root = getMarkdownInsertBoundaries(state);
  if (!root) return null;
  // ensureSyntaxTree may have finished beyond the state's published viewport
  // tree. Reuse that exact full tree, including below-screen list children.
  const tree = cache.get(state.doc)!.tree;
  const previous = imageCache.get(state.doc);
  if (previous?.tree === tree) return previous.boundaries;
  const blocks: ImageInsertBlock[] = [];
  const visit = (node: SyntaxNode, indent: string) => {
    if (node.name === "ListMark") return;
    if (["BulletList", "OrderedList", "ListItem"].includes(node.name)) {
      const item = readMarkdownListItem(state, node);
      const continuation = item ? " ".repeat(item.contentColumn) : indent;
      const start = blocks.length;
      for (let child = node.firstChild; child; child = child.nextSibling) visit(child, continuation);
      if (item && blocks.length === start) blocks.push({ from: state.doc.lineAt(node.from).from,
        to: node.to, indentAfter: continuation, afterAllowed: true });
    } else if (node.to > node.from) {
      blocks.push({ from: state.doc.lineAt(node.from).from, to: node.to,
        indentAfter: indent, afterAllowed: !hasOpenTail(node, state.doc) });
    }
  };
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (node.from < root.bodyFrom) continue;
    visit(node, "");
    // After the complete top-level list, keep the existing root insertion.
    const last = blocks.at(-1);
    if (last?.to === node.to) blocks[blocks.length - 1] = { ...last, indentAfter: "" };
  }
  const boundaries = { ...root, blocks, endAllowed: root.endAllowed && (blocks.at(-1)?.afterAllowed ?? true) };
  imageCache.set(state.doc, { tree, boundaries });
  return boundaries;
}

/** Recompute context after asynchronous asset import. Only parser-confirmed
 * child endpoints may insert inside a list, never arbitrary whitespace/columns. */
export function markdownImageInsertIndent(state: EditorState, position: number): string | null {
  const boundaries = getMarkdownImageInsertBoundaries(state);
  if (!boundaries || (!boundaries.endAllowed && position >= (boundaries.blocks.at(-1)?.to ?? state.doc.length))) return null;
  if (isMarkdownInsertBoundary(state, position)) return "";
  const block = boundaries.blocks.find(block => block.to === position);
  return block?.afterAllowed ? block.indentAfter : null;
}

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
