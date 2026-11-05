import { useMemo, type CSSProperties } from "react";
import {
  buildMarkdownOutlineTree,
  type MarkdownOutlineNode,
} from "./core/interaction/markdownHeadingOutline";
import type { MarkdownOutlineSnapshot } from "./core/interaction/markdownOutlineState";

export type MarkdownOutlinePanelProps = Readonly<{
  snapshot: MarkdownOutlineSnapshot | null;
  onJump: (index: number) => void;
  label: string;
}>;

const INDENT_STEP_PX = 12;
const MAX_INDENT_STEPS = 3;

/**
 * Persistent document outline beside the Markdown editor. The rail inside the
 * editor stays as the collapse-on-small-surface form; this panel is the one the
 * reader always gets.
 */
export function MarkdownOutlinePanel({ snapshot, onJump, label }: MarkdownOutlinePanelProps) {
  const headings = snapshot?.headings ?? null;
  const tree = useMemo(
    () => headings && headings.length >= 2 ? buildMarkdownOutlineTree(headings) : [],
    [headings],
  );
  if (!snapshot || snapshot.headings.length < 2) return null;
  const baseLevel = Math.min(...snapshot.headings.map((heading) => heading.level));
  const flat: Array<{ node: MarkdownOutlineNode; indent: number }> = [];
  const visit = (nodes: readonly MarkdownOutlineNode[]) => {
    for (const node of nodes) {
      flat.push({
        node,
        indent: Math.min(Math.max(0, node.heading.level - baseLevel), MAX_INDENT_STEPS) * INDENT_STEP_PX,
      });
      visit(node.children);
    }
  };
  visit(tree);

  return (
    <nav className="po-markdown-outline-panel" aria-label={label}>
      <ol className="po-markdown-outline-list">
        {flat.map(({ node, indent }) => {
          const active = node.index === snapshot.activeIndex;
          return (
            <li key={`${node.heading.from}:${node.index}`} className="po-markdown-outline-row">
              <button
                type="button"
                className="po-markdown-outline-item"
                data-index={node.index}
                data-active={active ? "true" : "false"}
                aria-current={active ? "location" : undefined}
                title={node.heading.plainTitle}
                style={{ "--po-markdown-outline-indent": `${indent}px` } as CSSProperties}
                onClick={() => onJump(node.index)}
              >
                {node.heading.plainTitle}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
