import { Facet, type EditorState } from "@codemirror/state";
import { getMarkdownHeadingPosition } from "./markdownHeadingIndex";

/** Features identify authored targets; core owns fragment navigation. */
export const markdownFragmentTargetsFacet = Facet.define<
  (state: EditorState) => ReadonlyMap<string, number>
>();

export function getMarkdownFragmentPosition(state: EditorState, fragment: string): number | null {
  const raw = fragment.trim().replace(/^#/, "");
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    // Malformed percent escapes are literal IDs, never a navigation exception.
  }
  if (!id) return null;
  let explicitPosition: number | null = null;
  for (const targets of state.facet(markdownFragmentTargetsFacet)) {
    const position = targets(state).get(id);
    if (position !== undefined && (explicitPosition === null || position < explicitPosition)) {
      explicitPosition = position;
    }
  }
  // Authored IDs are case-sensitive and take precedence over generated slugs.
  return explicitPosition ?? getMarkdownHeadingPosition(state, fragment);
}
