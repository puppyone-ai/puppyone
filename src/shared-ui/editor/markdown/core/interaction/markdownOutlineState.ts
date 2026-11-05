import { StateEffect, type EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  collectMarkdownHeadingOutlineEntries,
  resolveActiveOutlineIndex,
  type MarkdownOutlineHeading,
} from "./markdownHeadingOutline";

export type MarkdownOutlineSnapshot = Readonly<{
  headings: MarkdownOutlineHeading[];
  activeIndex: number;
}>;

export type MarkdownOutlineListener = (snapshot: MarkdownOutlineSnapshot) => void;

export type MarkdownOutlineStateTracker = Readonly<{ destroy(): void }>;

// Heading collection is a line scan. Scroll and selection updates reuse the
// same state instance, so the array identity stays stable for React.
const headingsByState = new WeakMap<EditorState, MarkdownOutlineHeading[]>();

export function collectOutlineHeadings(state: EditorState): MarkdownOutlineHeading[] {
  const cached = headingsByState.get(state);
  if (cached) return cached;
  const headings = collectMarkdownHeadingOutlineEntries(state);
  headingsByState.set(state, headings);
  return headings;
}

export function buildOutlineSnapshot(
  state: EditorState,
  scrollTop: number,
  blockTop: (from: number) => number,
): MarkdownOutlineSnapshot {
  const headings = collectOutlineHeadings(state);
  return {
    headings,
    activeIndex: resolveActiveOutlineIndex(headings, scrollTop, blockTop),
  };
}

/**
 * Publishes outline snapshots to the host without exposing `EditorView` to
 * React. Callbacks are throttled to one per animation frame and only fire when
 * the heading list identity or the active index actually changed.
 */
export function createMarkdownOutlineStateTracker(
  view: EditorView,
  onSnapshot: MarkdownOutlineListener,
): MarkdownOutlineStateTracker {
  const win = view.dom.ownerDocument.defaultView;
  let disposed = false;
  let frame: number | null = null;
  let last: MarkdownOutlineSnapshot | null = null;

  const emit = () => {
    if (disposed) return;
    const snapshot = buildOutlineSnapshot(
      view.state,
      view.scrollDOM.scrollTop,
      (from) => view.lineBlockAt(from).top,
    );
    if (
      last
      && last.headings === snapshot.headings
      && last.activeIndex === snapshot.activeIndex
    ) return;
    last = snapshot;
    onSnapshot(snapshot);
  };

  const schedule = () => {
    if (disposed || frame !== null) return;
    if (!win) {
      emit();
      return;
    }
    frame = win.requestAnimationFrame(() => {
      frame = null;
      emit();
    });
  };

  const onScroll = () => schedule();
  view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
  // The tracker owns no view state of its own; a config append is enough, and
  // it disappears with the EditorView that owns the resulting EditorState.
  view.dispatch({
    effects: StateEffect.appendConfig.of(EditorView.updateListener.of((update) => {
      if (update.docChanged || update.geometryChanged || update.viewportChanged) schedule();
    })),
  });
  emit();

  return {
    destroy() {
      disposed = true;
      view.scrollDOM.removeEventListener("scroll", onScroll);
      if (frame !== null && win) win.cancelAnimationFrame(frame);
      frame = null;
    },
  };
}
