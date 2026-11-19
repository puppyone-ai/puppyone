import { tags } from "@lezer/highlight";
import type { DelimiterType, MarkdownConfig } from "@lezer/markdown";

const EQUALS = 61;
const PERCENT = 37;
const COLON = 58;

const HighlightDelimiter: DelimiterType = { resolve: "Highlight", mark: "HighlightMark" };

/** `==text==`, `%%comment%%`, and the two signed shortcodes the base parser skips. */
export const markdownInlineSyntaxParserExtension: MarkdownConfig = {
  defineNodes: [
    { name: "Highlight", style: { "Highlight/...": tags.special(tags.content) } },
    { name: "HighlightMark", style: tags.processingInstruction },
    { name: "PercentComment", style: tags.comment },
  ],
  parseInline: [
    {
      name: "Highlight",
      after: "Emphasis",
      parse(context, next, position) {
        if (next !== EQUALS || context.char(position + 1) !== EQUALS || context.char(position + 2) === EQUALS) return -1;
        const before = context.slice(position - 1, position);
        const after = context.slice(position + 2, position + 3);
        return context.addDelimiter(
          HighlightDelimiter,
          position,
          position + 2,
          !/\s|^$/.test(after),
          !/\s|^$/.test(before),
        );
      },
    },
    {
      name: "PercentComment",
      before: "Emphasis",
      parse(context, next, position) {
        if (next !== PERCENT || context.char(position + 1) !== PERCENT) return -1;
        const closing = context.text.indexOf("%%", position - context.offset + 2);
        if (closing < 0) return -1;
        return context.addElement(context.elt("PercentComment", position, closing + context.offset + 2));
      },
    },
    {
      name: "SignedEmoji",
      before: "Emoji",
      parse(context, next, position) {
        if (next !== COLON) return -1;
        return /^:[+-]1:/.test(context.slice(position, position + 4))
          ? context.addElement(context.elt("Emoji", position, position + 4))
          : -1;
      },
    },
  ],
};
