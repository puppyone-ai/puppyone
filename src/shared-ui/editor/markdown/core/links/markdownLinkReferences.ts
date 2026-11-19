import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

type ReferenceCache = {
  tree: ReturnType<typeof syntaxTree>;
  destinations: ReadonlyMap<string, string>;
};

const referenceCache = new WeakMap<object, ReferenceCache>();

/** CommonMark labels match case-insensitively with collapsed whitespace. */
function normalizeReferenceLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function getLinkReferenceDestinations(state: EditorState): ReadonlyMap<string, string> {
  const tree = syntaxTree(state);
  const cached = referenceCache.get(state.doc);
  if (cached?.tree === tree) return cached.destinations;

  const destinations = new Map<string, string>();
  tree.iterate({
    enter(nodeRef) {
      if (nodeRef.name !== "LinkReference") return true;
      const label = nodeRef.node.getChild("LinkLabel");
      const url = nodeRef.node.getChild("URL");
      if (label && url) {
        const name = normalizeReferenceLabel(state.sliceDoc(label.from + 1, label.to - 1));
        // Footnote definitions share this syntax; the first definition wins.
        if (!name.startsWith("^") && !destinations.has(name)) {
          destinations.set(name, state.sliceDoc(url.from, url.to).replace(/^<|>$/g, ""));
        }
      }
      return false;
    },
  });
  referenceCache.set(state.doc, { tree, destinations });
  return destinations;
}

export function resolveMarkdownLinkReference(state: EditorState, label: string): string | null {
  return getLinkReferenceDestinations(state).get(normalizeReferenceLabel(label)) ?? null;
}
