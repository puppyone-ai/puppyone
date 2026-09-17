import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { highlightTree } from "@lezer/highlight";
import { puppyCodeHighlightStyle } from "../../../code/codeHighlightStyle";
import {
  loadCodeLanguageExtension,
  resolveCodeLanguageKey,
  type CodeLanguageKey,
} from "../../../code/codeLanguageSupport";
import {
  isWithinMarkdownCodeHighlightSourceBudget,
  MARKDOWN_CODE_HIGHLIGHT_DOM_NODE_LIMIT,
} from "./codeBlockHighlightBudget";

export type MarkdownCodeHighlightSegment = Readonly<{
  className: string | null;
  text: string;
}>;

export type MarkdownCodeHighlightResult = Readonly<{
  language: CodeLanguageKey;
  segments: readonly MarkdownCodeHighlightSegment[];
  tabSize: number;
  fallbackReason?: MarkdownCodeHighlightFallbackReason;
}>;

export type MarkdownCodeHighlightFallbackReason =
  | "dom-budget"
  | "parse-budget"
  | "plaintext"
  | "source-budget";

export type MarkdownCodeHighlightOptions = Readonly<{
  isCurrent?: () => boolean;
  loadLanguageExtension?: (language: CodeLanguageKey) => Promise<Extension>;
  parseTimeoutMs?: number;
}>;

export type MarkdownCodeHighlighter = (
  code: string,
  language: string,
  options?: MarkdownCodeHighlightOptions,
) => Promise<MarkdownCodeHighlightResult | null>;

export async function highlightMarkdownCode(
  code: string,
  language: string,
  options: MarkdownCodeHighlightOptions = {},
): Promise<MarkdownCodeHighlightResult | null> {
  const languageKey = resolveCodeLanguageKey(language, "");
  const rawResult = (fallbackReason: MarkdownCodeHighlightFallbackReason): MarkdownCodeHighlightResult => ({
    language: languageKey,
    segments: [{ className: null, text: code }],
    tabSize: languageKey === "python" ? 4 : 2,
    fallbackReason,
  });
  if (options.isCurrent && !options.isCurrent()) return null;
  if (languageKey === "plaintext") return rawResult("plaintext");
  if (!isWithinMarkdownCodeHighlightSourceBudget(code)) return rawResult("source-budget");

  const extension = await (options.loadLanguageExtension ?? loadCodeLanguageExtension)(languageKey);
  // Dynamic language chunks are shared. A newer edit may have arrived while
  // this request was waiting; reject it before constructing a parser state.
  if (options.isCurrent && !options.isCurrent()) return null;
  const state = EditorState.create({ doc: code, extensions: extension });
  const tree = ensureSyntaxTree(state, code.length, options.parseTimeoutMs ?? 8);
  // A partial tree would make the tail silently appear as plaintext. Prefer
  // the native textarea fallback when a full parse cannot finish in budget.
  if (!tree || tree.length < code.length) return rawResult("parse-budget");
  const segments: MarkdownCodeHighlightSegment[] = [];
  let position = 0;
  let overDomBudget = false;

  const appendSegment = (segment: MarkdownCodeHighlightSegment) => {
    if (overDomBudget || !segment.text) return;
    if (segments.length >= MARKDOWN_CODE_HIGHLIGHT_DOM_NODE_LIMIT) {
      overDomBudget = true;
      segments.length = 0;
      return;
    }
    segments.push(segment);
  };

  highlightTree(tree, puppyCodeHighlightStyle, (from, to, className) => {
    if (from > position) appendSegment({ className: null, text: code.slice(position, from) });
    appendSegment({ className, text: code.slice(from, to) });
    position = to;
  });
  if (position < code.length) appendSegment({ className: null, text: code.slice(position) });

  if (overDomBudget) return rawResult("dom-budget");

  return { language: languageKey, segments, tabSize: state.tabSize };
}
