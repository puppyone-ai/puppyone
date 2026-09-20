import type { EditorView, ViewUpdate } from "@codemirror/view";
import { registerEditorLayoutParticipant } from "../runtime/editorLayout";
import {
  captureReadingAnchor,
  mapReadingAnchor,
  measureCodeMirrorLayout,
  restoreReadingAnchor,
  type ReadingAnchor,
} from "./readingAnchor";

type Observation = {
  width: number | null;
  height: number | null;
  onHeight?: (height: number, previous: number | null) => void;
  onWidth?: (width: number, previous: number | null) => void;
};

export type EditorLayoutReason = "host" | "geometry" | "content" | "typography" | "appearance";

export type CodeMirrorViewportLayout = {
  observe(element: HTMLElement, onHeight?: Observation["onHeight"], onWidth?: Observation["onWidth"]): () => void;
  schedule<T>(key: object, read: () => T, write: (value: T) => void): void;
  request(): void;
  invalidate(reason: EditorLayoutReason): void;
  update(update: ViewUpdate): void;
  navigation(): void;
  snapshot(): Readonly<{ revision: number; committedRevision: number; commits: number; maxCommitMs: number; disposed: boolean }>;
  dispose(): void;
};

/** One pre-paint geometry owner per EditorView. Host mutations and intrinsic
 * size changes converge here. Observers never enqueue stale geometry values.
 * The adapter uses CodeMirror's height map and scroll effects, not a second
 * virtualizer or competing scrollTop compensation loop. */
export function createCodeMirrorViewportLayout(
  view: EditorView,
  publishViewport: (inlineSize: number) => void,
): CodeMirrorViewportLayout {
  const observations = new Map<HTMLElement, Observation>();
  const pending = new Set<HTMLElement>();
  let anchor: ReadingAnchor | null = null;
  let disposed = false;
  let committing = false;
  let queued = false;
  let revision = 0;
  let committedRevision = 0;
  let commits = 0;
  let maxCommitMs = 0;
  let expectedScrollTop = view.scrollDOM.scrollTop;
  let committedWidth = -1;
  let committedHeight = -1;
  let committedContentHeight = -1;

  const capture = () => {
    anchor = captureReadingAnchor(view);
    expectedScrollTop = view.scrollDOM.scrollTop;
  };

  const notifyGeometry = () => {
    // Read every box before callbacks write DOM. Read current boxes rather
    // than ResizeObserverEntry values from an earlier layout revision.
    const changed = [...pending].map(element => ({ element, rect: element.getBoundingClientRect() }));
    pending.clear();
    for (const { element, rect } of changed) {
      const observation = observations.get(element);
      if (!observation || !element.isConnected) continue;
      const { width, height } = observation;
      observation.width = rect.width;
      observation.height = rect.height;
      if (height === null || Math.abs(height - rect.height) >= 0.5) observation.onHeight?.(rect.height, height);
      if (width === null || Math.abs(width - rect.width) >= 0.5) observation.onWidth?.(rect.width, width);
    }
  };

  const commit = () => {
    if (disposed || committing || !view.dom.isConnected || !view.scrollDOM.clientWidth || !view.scrollDOM.clientHeight) return;
    committing = true;
    const start = performance.now();
    const targetRevision = revision;
    try {
      publishViewport(view.scrollDOM.clientWidth);
      notifyGeometry();
      // Supply the semantic target before measurement. Otherwise the engine
      // first converges on its old line/height anchor, only to repeat layout
      // for our character target (especially expensive across mode changes).
      if (anchor) restoreReadingAnchor(view, anchor);
      measureCodeMirrorLayout(view, anchor?.position ?? view.state.selection.main.head);
      committedWidth = view.scrollDOM.clientWidth;
      committedHeight = view.scrollDOM.clientHeight;
      if (!anchor) capture();
      else expectedScrollTop = view.scrollDOM.scrollTop;
      committedContentHeight = view.contentDOM.getBoundingClientRect().height;
      committedRevision = targetRevision;
      commits += 1;
    } finally {
      committing = false;
      maxCommitMs = Math.max(maxCommitMs, performance.now() - start);
    }
  };

  const invalidate = (_reason: EditorLayoutReason) => {
    if (disposed) return;
    revision += 1;
    if (queued) return;
    queued = true;
    // May be called while CodeMirror is updating (Widget.toDOM, ViewPlugin,
    // theme effects). A microtask exits that update without yielding a paint.
    queueMicrotask(() => {
      queued = false;
      if (!disposed && committedRevision !== revision) commit();
    });
  };

  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(entries => {
    if (disposed) return;
    for (const entry of entries) if (observations.has(entry.target as HTMLElement)) pending.add(entry.target as HTMLElement);
    revision += 1;
    // ResizeObserver runs before paint. Deferring this to requestAnimationFrame
    // would expose new wrapping with the previous height map for one frame.
    commit();
  });
  observer?.observe(view.scrollDOM);
  observer?.observe(view.contentDOM);

  const releaseHost = registerEditorLayoutParticipant(view.dom, {
    prepare() {
      if (disposed) return;
      if (revision !== committedRevision) commit();
      if (!anchor) capture();
    },
    commit() {
      revision += 1;
      commit();
    },
  });

  const userIntent = () => { anchor = null; };
  const onScroll = () => {
    if (disposed || committing) return;
    if (Math.abs(view.scrollDOM.scrollTop - expectedScrollTop) > 0.5) {
      if (anchor && (view.scrollDOM.clientWidth !== committedWidth
        || view.scrollDOM.clientHeight !== committedHeight
        || view.contentDOM.getBoundingClientRect().height !== committedContentHeight)) return;
      // Scrollbar, wheel, touch and explicit navigation take precedence over
      // an earlier reading anchor. A correction's own scroll event is ignored.
      const scroll = view.scrollDOM;
      anchor = scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop <= 1
        ? { position: view.state.doc.length, offset: 0, edge: "end", snapshot: null } : null;
      invalidate("content");
    }
  };
  view.scrollDOM.addEventListener("scroll", onScroll, { passive: true, capture: true });
  view.scrollDOM.addEventListener("wheel", userIntent, { passive: true });
  view.scrollDOM.addEventListener("touchstart", userIntent, { passive: true });
  view.contentDOM.addEventListener("pointerdown", userIntent);
  view.contentDOM.addEventListener("keydown", userIntent);
  const fonts = view.dom.ownerDocument.fonts;
  const onFonts = () => invalidate("typography");
  fonts?.addEventListener("loadingdone", onFonts);
  invalidate("geometry");

  return {
    observe(element, onHeight, onWidth) {
      const observation: Observation = { width: null, height: null, onHeight, onWidth };
      if (disposed) return () => undefined;
      observations.set(element, observation);
      observer?.observe(element);
      return () => {
        if (observations.get(element) !== observation) return;
        observations.delete(element);
        pending.delete(element);
        observer?.unobserve(element);
      };
    },
    schedule(key, read, write) {
      if (disposed) return;
      const document = view.state.doc;
      view.requestMeasure({ key, read, write: value => {
        if (!disposed && view.state.doc === document) write(value);
      } });
    },
    request: () => invalidate("content"),
    invalidate,
    navigation() { if (!committing) anchor = null; },
    update(update) {
      if (disposed || committing) return;
      anchor = mapReadingAnchor(anchor, update);
      if (update.selectionSet || update.transactions.some(transaction => transaction.scrollIntoView)) anchor = null;
      if (update.docChanged || update.selectionSet || update.transactions.some(transaction => transaction.reconfigured)) invalidate("content");
      // CodeMirror can measure independently. Capture only after our matching
      // viewport revision commits; never bless a half-updated resize as stable.
      if (update.geometryChanged && view.scrollDOM.clientWidth === committedWidth
        && view.scrollDOM.clientHeight === committedHeight && revision === committedRevision) {
        invalidate("content");
      }
    },
    snapshot: () => ({ revision, committedRevision, commits, maxCommitMs, disposed }),
    dispose() {
      if (disposed) return;
      disposed = true;
      anchor = null;
      releaseHost();
      observer?.disconnect();
      observations.clear();
      pending.clear();
      view.scrollDOM.removeEventListener("scroll", onScroll, true);
      view.scrollDOM.removeEventListener("wheel", userIntent);
      view.scrollDOM.removeEventListener("touchstart", userIntent);
      view.contentDOM.removeEventListener("pointerdown", userIntent);
      view.contentDOM.removeEventListener("keydown", userIntent);
      fonts?.removeEventListener("loadingdone", onFonts);
    },
  };
}
