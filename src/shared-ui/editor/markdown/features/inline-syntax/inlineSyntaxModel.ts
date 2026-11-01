import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { MarkdownElementOf } from "../../core/syntax/markdownElementTypes";
import emojiShortcodes from "./emojiShortcodes.generated.json";

const EMOJI = emojiShortcodes as Readonly<Record<string, string>>;

type InlineSyntaxKind = "comment" | "emoji" | "entity" | "highlight" | "linkDefinition";

export function collectMarkdownInlineSyntax(
  state: EditorState,
  from: number,
  to: number,
): MarkdownElementOf<InlineSyntaxKind>[] {
  const elements: MarkdownElementOf<InlineSyntaxKind>[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter(nodeRef) {
      const node = nodeRef.node;
      const range = { from: node.from, to: node.to };
      switch (node.name) {
        case "Entity":
          elements.push({
            kind: "entity",
            ...range,
            markerRanges: [range],
            blockData: { kind: "entity", source: state.sliceDoc(node.from, node.to) },
          });
          return false;
        case "Emoji": {
          const emoji = EMOJI[state.sliceDoc(node.from + 1, node.to - 1)];
          if (emoji) {
            elements.push({ kind: "emoji", ...range, markerRanges: [range], blockData: { kind: "emoji", emoji } });
          }
          return false;
        }
        case "Highlight": {
          const markers = node.getChildren("HighlightMark");
          const opening = markers[0];
          const closing = markers[markers.length - 1];
          if (!opening || !closing || opening === closing) return false;
          elements.push({
            kind: "highlight",
            ...range,
            markerRanges: [
              { from: opening.from, to: opening.to },
              { from: closing.from, to: closing.to },
            ],
            contentRange: { from: opening.to, to: closing.from },
          });
          return true;
        }
        case "LinkReference": {
          const label = node.getChild("LinkLabel");
          const colon = node.getChild("LinkMark");
          if (label && colon && state.sliceDoc(label.from + 1, label.from + 2) !== "^") {
            elements.push({
              kind: "linkDefinition",
              from: label.from,
              to: colon.to,
              markerRanges: [
                { from: label.from, to: label.from + 1 },
                { from: label.to - 1, to: colon.to },
              ],
              contentRange: { from: label.from + 1, to: label.to - 1 },
            });
          }
          return true;
        }
        case "Comment":
        case "CommentBlock":
        case "PercentComment":
          elements.push({ kind: "comment", ...range, markerRanges: [], contentRange: range });
          return false;
        default:
          return true;
      }
    },
  });
  return elements;
}
