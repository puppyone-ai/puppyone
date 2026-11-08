import type { Command, KeyBinding } from "@codemirror/view";
import { setMarkdownHeadingLevel, toggleMarkdownList, toggleMarkdownQuote } from "./markdownBlockCommands";
import { toggleMarkdownInline, toggleMarkdownHtmlTag, wrapMarkdownLink } from "./markdownInlineCommands";
import { toggleMarkdownTaskCheckboxAt } from "./markdownTaskCommands";
import {
  clearMarkdownFormatting, insertMarkdownCodeBlock, insertMarkdownMathBlock,
  requestMarkdownTable, insertMarkdownRule, insertMarkdownFootnote, insertMarkdownReferenceLink,
  adjustMarkdownHeading, insertMarkdownParagraph, insertMarkdownFrontMatter, insertMarkdownCallout,
} from "./markdownInsertCommands";
import { MARKDOWN_SHORTCUT_DEFINITIONS } from "./markdownShortcutDefinitions";
const commands: Readonly<Record<string, Command>> = {
  strong: toggleMarkdownInline("**"), emphasis: toggleMarkdownInline("*"),
  underline: toggleMarkdownHtmlTag("u"), strike: toggleMarkdownInline("~~"),
  inlineCode: toggleMarkdownInline("`"), link: wrapMarkdownLink,
  paragraph: setMarkdownHeadingLevel(0),
  heading1: setMarkdownHeadingLevel(1), heading2: setMarkdownHeadingLevel(2),
  heading3: setMarkdownHeadingLevel(3), heading4: setMarkdownHeadingLevel(4),
  heading5: setMarkdownHeadingLevel(5), heading6: setMarkdownHeadingLevel(6),
  orderedList: toggleMarkdownList("ordered"), bulletList: toggleMarkdownList("bullet"),
  taskList: toggleMarkdownList("task"), quote: toggleMarkdownQuote,
  clearFormat: clearMarkdownFormatting, table: requestMarkdownTable,
  codeBlock: insertMarkdownCodeBlock, mathBlock: insertMarkdownMathBlock,
  horizontalRule: insertMarkdownRule, footnote: insertMarkdownFootnote, referenceLink: insertMarkdownReferenceLink,
  headingDeeper: view => adjustMarkdownHeading(view, 1),
  headingShallower: view => adjustMarkdownHeading(view, -1),
  toggleTask: view => toggleMarkdownTaskCheckboxAt(view, view.state.selection.main.head),
  callout: insertMarkdownCallout,
  paragraphBefore: view => insertMarkdownParagraph(view, "before"),
  paragraphAfter: view => insertMarkdownParagraph(view, "after"),
  frontMatter: insertMarkdownFrontMatter,
};
export function runMarkdownCommand(view: Parameters<Command>[0], id: string): boolean {
  return commands[id]?.(view) ?? false;
}
export const markdownCommandKeymap: readonly KeyBinding[] = MARKDOWN_SHORTCUT_DEFINITIONS.flatMap(definition => {
  const macKeys = definition.mac ?? definition.keys;
  return Array.from({ length: Math.max(definition.keys.length, macKeys.length) }, (_, index) => ({
    key: definition.keys[index], mac: macKeys[index], run: commands[definition.id], preventDefault: true,
  }));
});
