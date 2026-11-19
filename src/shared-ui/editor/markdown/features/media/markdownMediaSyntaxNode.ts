import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import type {
  MarkdownMediaKind,
  MarkdownObsidianMediaEmbedToken,
} from "./obsidianMediaEmbed";

/**
 * Refine parser-owned Obsidian media nodes into semantic payloads without
 * scanning the source envelope a second time.
 */
export function getObsidianMediaEmbedNodesInRange(
  state: EditorState,
  from: number,
  to: number,
  kind: MarkdownMediaKind,
): MarkdownObsidianMediaEmbedToken[] {
  const nodeName = kind === "image" ? "ObsidianImageEmbed" : "ObsidianVideoEmbed";
  const tokens: MarkdownObsidianMediaEmbedToken[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter(nodeRef) {
      if (nodeRef.name !== nodeName) return true;
      const token = readObsidianMediaEmbedNode(state, nodeRef.node, kind);
      if (token) tokens.push(token);
      return false;
    },
  });
  return tokens;
}

function readObsidianMediaEmbedNode(
  state: EditorState,
  node: SyntaxNode,
  kind: MarkdownMediaKind,
): MarkdownObsidianMediaEmbedToken | null {
  const prefix = kind === "image" ? "ObsidianImage" : "ObsidianVideo";
  const targetNode = node.getChild(`${prefix}Target`);
  if (!targetNode) return null;
  const target = state.sliceDoc(targetNode.from, targetNode.to).trim();
  if (!target) return null;
  const aliasNode = node.getChild(`${prefix}Alias`);
  const alias = aliasNode ? state.sliceDoc(aliasNode.from, aliasNode.to).trim() : "";
  return {
    from: node.from,
    to: node.to,
    target,
    alias: alias || null,
    kind,
  };
}
