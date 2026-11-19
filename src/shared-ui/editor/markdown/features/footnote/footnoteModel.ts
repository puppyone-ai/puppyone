import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

export type MarkdownFootnoteIndex = Readonly<{
  /** Ordinal by first reference, which is how a reader meets each note. */
  numbers: ReadonlyMap<string, number>;
  definitions: ReadonlyMap<string, Readonly<{ from: number; to: number }>>;
  firstReferences: ReadonlyMap<string, number>;
}>;

const REFERENCE = /^\[\^([^\]\s]+)\]$/;
const DEFINITION = /^(\[\^([^\]\s]+)\]:)/;

type FootnoteCache = { tree: ReturnType<typeof syntaxTree>; index: MarkdownFootnoteIndex };
const footnoteCache = new WeakMap<object, FootnoteCache>();

export function getMarkdownFootnotes(state: EditorState): MarkdownFootnoteIndex {
  const tree = syntaxTree(state);
  const cached = footnoteCache.get(state.doc);
  if (cached?.tree === tree) return cached.index;

  const definitions = new Map<string, { from: number; to: number }>();
  const references: Array<{ id: string; from: number }> = [];
  tree.iterate({
    enter(nodeRef) {
      if (nodeRef.name === "Paragraph" || nodeRef.name === "LinkReference") {
        const definition = DEFINITION.exec(state.sliceDoc(nodeRef.from, Math.min(nodeRef.to, nodeRef.from + 256)));
        if (definition && !definitions.has(definition[2])) {
          definitions.set(definition[2], { from: nodeRef.from, to: nodeRef.from + definition[1].length });
        }
        return nodeRef.name === "Paragraph";
      }
      if (nodeRef.name === "Link") {
        const reference = REFERENCE.exec(state.sliceDoc(nodeRef.from, nodeRef.to));
        if (reference) references.push({ id: reference[1], from: nodeRef.from });
        return false;
      }
      return true;
    },
  });

  const numbers = new Map<string, number>();
  const firstReferences = new Map<string, number>();
  for (const { id, from } of references) {
    if (!definitions.has(id) || definitions.get(id)?.from === from || numbers.has(id)) continue;
    numbers.set(id, numbers.size + 1);
    firstReferences.set(id, from);
  }
  const index = { numbers, definitions, firstReferences };
  footnoteCache.set(state.doc, { tree, index });
  return index;
}

export function findMarkdownFootnoteMarkers(
  state: EditorState,
  from: number,
  to: number,
): Array<{ kind: "definition" | "reference"; id: string; from: number; to: number; label: string }> {
  const index = getMarkdownFootnotes(state);
  const markers: Array<{ kind: "definition" | "reference"; id: string; from: number; to: number; label: string }> = [];
  for (const [id, range] of index.definitions) {
    if (range.from < to && range.to > from) {
      markers.push({ kind: "definition", id, ...range, label: String(index.numbers.get(id) ?? id) });
    }
  }
  syntaxTree(state).iterate({
    from,
    to,
    enter(nodeRef) {
      if (nodeRef.name !== "Link") return true;
      const id = REFERENCE.exec(state.sliceDoc(nodeRef.from, nodeRef.to))?.[1];
      const number = id ? index.numbers.get(id) : undefined;
      if (id && number !== undefined && index.definitions.get(id)?.from !== nodeRef.from) {
        markers.push({ kind: "reference", id, from: nodeRef.from, to: nodeRef.to, label: String(number) });
      }
      return false;
    },
  });
  return markers;
}
