import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { resolveMarkdownLinkReference } from "../../core/links/markdownLinkReferences";
import type { MarkdownImageToken } from "./markdownImageModel";

/** `![alt][label]`, `![label][]`, and `![label]` resolve through a definition. */
export function findMarkdownReferenceImageTokens(
  state: EditorState,
  from: number,
  to: number,
): MarkdownImageToken[] {
  const tokens: MarkdownImageToken[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter(nodeRef) {
      if (nodeRef.name !== "Image") return true;
      const node = nodeRef.node;
      if (node.getChild("URL")) return false;
      const marks = node.getChildren("LinkMark");
      const altFrom = marks[0]?.to;
      const altTo = marks[1]?.from;
      if (altFrom === undefined || altTo === undefined) return false;
      const alt = state.sliceDoc(altFrom, altTo);
      const label = node.getChild("LinkLabel");
      const explicit = label ? state.sliceDoc(label.from + 1, label.to - 1).trim() : "";
      const href = resolveMarkdownLinkReference(state, explicit || alt);
      if (href) {
        tokens.push({ from: node.from, to: node.to, alt, href, title: null, referenceKind: "markdown-path" });
      }
      return false;
    },
  });
  return tokens;
}
