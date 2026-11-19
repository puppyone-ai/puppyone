import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { MarkdownCalloutIcon } from "./calloutIcons";

export type MarkdownCallout = Readonly<{
  appearance: Exclude<MarkdownCalloutIcon, "chevron">;
  /** The authored word, title-cased, shown when no title follows the marker. */
  defaultTitle: string;
  hasTitle: boolean;
  fold: "open" | "folded" | null;
  markerFrom: number;
  markerTo: number;
  firstLine: number;
  lastLine: number;
}>;

const CALLOUT_MARKER = /^(\s*>[ \t]?)\[!([A-Za-z][\w-]*)\]([+-]?)[ \t]*/;

const APPEARANCE_ALIASES: Readonly<Record<string, MarkdownCallout["appearance"]>> = {
  abstract: "abstract", summary: "abstract", tldr: "abstract",
  attention: "warning", warning: "warning",
  bug: "bug",
  caution: "caution",
  check: "success", done: "success", success: "success",
  cite: "quote", quote: "quote",
  danger: "danger", error: "danger",
  example: "example",
  fail: "failure", failure: "failure", missing: "failure",
  faq: "question", help: "question", question: "question",
  hint: "tip", tip: "tip",
  important: "important",
  info: "info",
  note: "note",
  todo: "todo",
};

const CALLOUT_FOLD_MARKERS: Readonly<Record<string, MarkdownCallout["fold"]>> = { "+": "open", "-": "folded" };

type CalloutCache = { tree: ReturnType<typeof syntaxTree>; callouts: readonly MarkdownCallout[] };
const calloutCache = new WeakMap<object, CalloutCache>();

export function getMarkdownCallouts(state: EditorState): readonly MarkdownCallout[] {
  const tree = syntaxTree(state);
  const cached = calloutCache.get(state.doc);
  if (cached?.tree === tree) return cached.callouts;

  const callouts: MarkdownCallout[] = [];
  tree.iterate({
    enter(nodeRef) {
      if (nodeRef.name !== "Blockquote") return true;
      const line = state.doc.lineAt(nodeRef.from);
      const marker = CALLOUT_MARKER.exec(line.text);
      if (marker && state.sliceDoc(line.from, nodeRef.from).trim() === "") {
        const word = marker[2].toLowerCase();
        callouts.push({
          appearance: APPEARANCE_ALIASES[word] ?? "note",
          defaultTitle: word.charAt(0).toUpperCase() + word.slice(1),
          hasTitle: line.text.slice(marker[0].length).trim() !== "",
          fold: CALLOUT_FOLD_MARKERS[marker[3] ?? ""] ?? null,
          markerFrom: line.from + marker[1].length,
          markerTo: line.from + marker[0].length,
          firstLine: line.number,
          lastLine: state.doc.lineAt(Math.max(nodeRef.from, nodeRef.to - 1)).number,
        });
      }
      return false;
    },
  });
  calloutCache.set(state.doc, { tree, callouts });
  return callouts;
}
