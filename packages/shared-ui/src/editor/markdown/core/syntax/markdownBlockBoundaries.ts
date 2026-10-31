import { syntaxTree } from "@codemirror/language";
import type { EditorState, Line } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

export type MarkdownMovableBlockKind = "root" | "list-item";

/**
 * Ephemeral structural identity for a movable Markdown block. These ranges are
 * valid only for the EditorState that produced them; they are never persisted
 * into the document.
 */
export type MarkdownMovableBlockRef = Readonly<{
  kind: MarkdownMovableBlockKind;
  from: number;
  to: number;
  parentFrom: number;
  parentTo: number;
  parentName: string;
  depth: number;
}>;

export type MarkdownMovableBlockGroup = Readonly<{
  blocks: readonly MarkdownMovableBlockRef[];
  sourceIndex: number;
}>;

const LIST_NODE_NAMES = new Set(["BulletList", "OrderedList"]);
const FRONTMATTER_SCAN_LINES = 256;

/**
 * The movable block a source line belongs to. The answer depends only on the
 * line, never on the column, so a caret at the end of a line and a pointer over
 * the blank space beside it resolve exactly like the text itself. A blank line
 * between blocks belongs to neither of them.
 */
export function getMarkdownMovableBlockAt(
  state: EditorState,
  position: number,
): MarkdownMovableBlockRef | null {
  if (state.doc.length === 0) return null;
  const clampedPosition = Math.max(0, Math.min(position, state.doc.length));
  const line = state.doc.lineAt(clampedPosition);
  const bodyFrom = getMarkdownBodyStart(state);
  if (line.from < bodyFrom) return null;
  const anchor = resolveLineAnchor(state, line);
  if (!anchor) return null;

  // The innermost list item wins, so a nested item moves with its descendants
  // but never leaves its current list container. A lone item has nowhere to go
  // inside its list, so it defers to whatever contains the list.
  for (let current: SyntaxNode | null = anchor; current; current = current.parent) {
    if (current.name !== "ListItem" || !current.parent || !LIST_NODE_NAMES.has(current.parent.name)) {
      continue;
    }
    if (!current.prevSibling && !current.nextSibling) continue;
    return createBlockRef(current, current.parent, "list-item");
  }

  let node = anchor;
  while (node.parent && node.parent.name !== "Document") node = node.parent;
  if (!node.parent || node.from === node.to) return null;
  const hasEarlierBlock = Boolean(node.prevSibling && node.prevSibling.from >= bodyFrom);
  if (!hasEarlierBlock && !node.nextSibling) return null;
  return createBlockRef(node, node.parent, "root");
}

export function getMarkdownMovableBlockGroup(
  state: EditorState,
  source: MarkdownMovableBlockRef,
): MarkdownMovableBlockGroup | null {
  const parent = findStructuralParent(state, source);
  if (!parent) return null;

  const bodyFrom = source.kind === "root" ? getMarkdownBodyStart(state) : 0;
  const blocks: MarkdownMovableBlockRef[] = [];
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.from === child.to || child.from < bodyFrom) continue;
    if (source.kind === "list-item" && child.name !== "ListItem") continue;
    blocks.push(createBlockRef(child, parent, source.kind));
  }

  const sourceIndex = blocks.findIndex((block) => sameMarkdownMovableBlock(block, source));
  return sourceIndex < 0 ? null : { blocks, sourceIndex };
}

/**
 * `parentTo` is deliberately not part of a block's identity: while the
 * background parser advances, the Document node's end grows with it.
 */
export function sameMarkdownMovableBlock(
  left: MarkdownMovableBlockRef | null,
  right: MarkdownMovableBlockRef | null,
): boolean {
  return Boolean(
    left
    && right
    && left.kind === right.kind
    && left.from === right.from
    && left.to === right.to
    && left.parentFrom === right.parentFrom
    && left.parentName === right.parentName,
  );
}

function resolveLineAnchor(state: EditorState, line: Line): SyntaxNode | null {
  const contentEnd = line.from + line.text.trimEnd().length;
  // The last character on a line is always inside the deepest block that owns
  // the line, unlike its start, which can be indentation or a container mark.
  if (contentEnd > line.from) return syntaxTree(state).resolveInner(contentEnd, -1);
  const enclosing = syntaxTree(state).resolveInner(line.from, 1);
  return enclosing.parent && !LIST_NODE_NAMES.has(enclosing.name) ? enclosing : null;
}

/**
 * The parser reads YAML frontmatter as a rule and a heading, but it is file
 * metadata that is only valid at the very top. Detect it from source and keep
 * it out of every movable group, so nothing can leave or enter that region.
 */
function getMarkdownBodyStart(state: EditorState): number {
  if (state.doc.line(1).text.trimEnd() !== "---") return 0;
  const lastLine = Math.min(state.doc.lines, FRONTMATTER_SCAN_LINES);
  for (let number = 2; number <= lastLine; number += 1) {
    const line = state.doc.line(number);
    if (line.text.trimEnd() === "---") return line.to + 1;
  }
  return 0;
}

function createBlockRef(
  node: SyntaxNode,
  parent: SyntaxNode,
  kind: MarkdownMovableBlockKind,
): MarkdownMovableBlockRef {
  return {
    kind,
    from: node.from,
    to: node.to,
    parentFrom: parent.from,
    parentTo: parent.to,
    parentName: parent.name,
    depth: kind === "list-item" ? countListDepth(parent) : 0,
  };
}

function countListDepth(parent: SyntaxNode): number {
  let depth = 0;
  for (let current: SyntaxNode | null = parent; current; current = current.parent) {
    if (LIST_NODE_NAMES.has(current.name)) depth += 1;
  }
  return depth;
}

function findStructuralParent(
  state: EditorState,
  source: MarkdownMovableBlockRef,
): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(
    Math.min(source.from, state.doc.length),
    1,
  );
  while (node) {
    if (node.name === source.parentName && node.from === source.parentFrom) return node;
    node = node.parent;
  }
  return null;
}
