import type { Tree } from "@lezer/common";

/** Same-source parse progress reuses immutable prefix subtrees. */
export function getChangedSyntaxProjectionRange(previous: Tree, next: Tree): { from: number; to: number } | null {
  if (previous === next) return null;
  if (previous.type !== next.type) return { from: 0, to: Math.max(previous.length, next.length) };
  let prefix = 0;
  while (prefix < previous.children.length && prefix < next.children.length
    && previous.children[prefix] === next.children[prefix]
    && previous.positions[prefix] === next.positions[prefix]) prefix += 1;
  if (prefix === previous.children.length && prefix === next.children.length && previous.length === next.length) return null;
  return {
    from: Math.min(previous.positions[prefix] ?? previous.length, next.positions[prefix] ?? next.length),
    to: Math.max(previous.length, next.length),
  };
}
