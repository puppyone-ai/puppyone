import { logException, type EditorView, type ViewUpdate } from "@codemirror/view";
import { registerEditorLayoutParticipant, type EditorLayoutReason } from "../runtime/editorLayout";
import { captureReadingAnchor, mapReadingAnchor, restoreReadingAnchor, type ReadingAnchor } from "./readingAnchor";
import { codeMirrorNavigationIntent } from "./navigationIntent";
import { createCodeMirrorLayoutEngine } from "./layoutEngine";

export type { EditorLayoutReason } from "../runtime/editorLayout";
type Observation = {
  width: number | null;
  height: number | null;
  onHeight?: (height: number, previous: number | null) => void;
  onWidth?: (width: number, previous: number | null) => void;
  stop(): void;
};
type GeometryChange = { element: HTMLElement; observation: Observation; width: number; height: number };
type LayoutRead = { width: number; height: number; metrics: string; changes: GeometryChange[]; revision: number; document: EditorView["state"]["doc"] };

export type CodeMirrorViewportLayout = {
  observe(element: HTMLElement, onHeight?: Observation["onHeight"], onWidth?: Observation["onWidth"]): () => void;
  schedule<T>(key: object, read: () => T, write: (value: T) => void): void;
  request(): void;
  invalidate(reason: EditorLayoutReason): void;
  update(update: ViewUpdate): void;
  navigation(): void;
  snapshot(): Readonly<{ revision: number; committedRevision: number; committedWidth: number; commits: number; skipped: number; maxCommitMs: number; disposed: boolean; suspended: boolean; faulted: boolean }>;
  dispose(): void;
};

/** View-local reading state and CodeMirror adaptation. The DOM Document owns
 * scheduling/observation; this layer owns neither file data nor a second height
 * map. It participates in the same phases as its sibling panes. */
export function createCodeMirrorViewportLayout(view: EditorView): CodeMirrorViewportLayout {
  const engine = createCodeMirrorLayoutEngine(view);
  const observations = new Map<HTMLElement, Observation>();
  const pending = new Set<HTMLElement>();
  let anchor: ReadingAnchor | null = null;
  let disposed = false;
  let suspended = true;
  let faulted = false;
  let committing = false;
  let revision = 0;
  let committedRevision = 0;
  let commits = 0;
  let skipped = 0;
  let maxCommitMs = 0;
  let expectedScrollTop = view.scrollDOM.scrollTop;
  let committedWidth = -1;
  let committedHeight = -1;
  let committedContentHeight = -1;
  let committedMetrics = "";
  let measured: LayoutRead | null = null;
  const active = () => !disposed && !faulted;

  const capture = () => {
    anchor = captureReadingAnchor(view);
    expectedScrollTop = view.scrollDOM.scrollTop;
  };
  const invalidate = (reason: EditorLayoutReason) => {
    if (!active()) return;
    revision += 1;
    registration.invalidate(reason);
  };

  const registration = registerEditorLayoutParticipant(view.dom, {
    prepare() { if (active() && !anchor) capture(); },
    read(reasons) {
      measured = null;
      if (!active()) return false;
      const width = view.scrollDOM.clientWidth;
      const height = view.scrollDOM.clientHeight;
      if (!width || !height) { suspended = true; return false; }
      const resumed = suspended;
      suspended = false;
      const contentHeight = view.contentDOM.getBoundingClientRect().height;
      const metrics = !committedMetrics || reasons.has("appearance") || reasons.has("typography")
        ? readTypographyMetrics(view) : committedMetrics;
      const changes: GeometryChange[] = [];
      for (const element of pending) {
        const observation = observations.get(element);
        if (!observation || !element.isConnected) continue;
        const rect = element.getBoundingClientRect();
        if (observation.width === null || observation.height === null
          || Math.abs(observation.width - rect.width) >= 0.5 || Math.abs(observation.height - rect.height) >= 0.5) {
          changes.push({ element, observation, width: rect.width, height: rect.height });
        }
      }
      pending.clear();
      const changed = resumed || width !== committedWidth || height !== committedHeight
        || Math.abs(contentHeight - committedContentHeight) >= 0.5 || metrics !== committedMetrics || changes.length > 0;
      if (!changed && !reasons.has("content") && !reasons.has("navigation") && !reasons.has("typography")) {
        skipped += 1;
        committedRevision = revision;
        return false;
      }
      measured = { width, height, metrics, changes, revision, document: view.state.doc };
      return true;
    },
    write() {
      if (!measured || !active() || measured.document !== view.state.doc) return;
      // Every pane's boxes have already been read. Ignore callbacks from a
      // replaced widget registration even when its DOM element was reused.
      for (const change of measured.changes) {
        const { element, observation, width, height } = change;
        if (observations.get(element) !== observation || !element.isConnected) continue;
        const previousWidth = observation.width, previousHeight = observation.height;
        observation.width = width; observation.height = height;
        if (previousHeight === null || Math.abs(height - previousHeight) >= 0.5) observation.onHeight?.(height, previousHeight);
        if (previousWidth === null || Math.abs(width - previousWidth) >= 0.5) observation.onWidth?.(width, previousWidth);
      }
    },
    commit() {
      const current = measured;
      measured = null;
      if (!current || !active()) return;
      if (current.document !== view.state.doc) { invalidate("content"); return; }
      committing = true;
      const start = performance.now();
      try {
        if (anchor) restoreReadingAnchor(view, anchor);
        engine.flush(anchor?.position ?? view.state.selection.main.head);
        committedWidth = view.scrollDOM.clientWidth;
        committedHeight = view.scrollDOM.clientHeight;
        committedMetrics = current.metrics;
        if (!anchor) capture();
        else expectedScrollTop = view.scrollDOM.scrollTop;
        committedContentHeight = view.contentDOM.getBoundingClientRect().height;
        committedRevision = current.revision;
        commits += 1;
      } finally {
        committing = false;
        maxCommitMs = Math.max(maxCommitMs, performance.now() - start);
      }
    },
    onError(error, phase) {
      faulted = true;
      measured = null;
      anchor = null;
      logException(view.state, error, `editor viewport layout (${phase})`);
    },
  });
  const markGeometry = () => { revision += 1; };
  registration.observe(view.scrollDOM, markGeometry);
  // contentDOM is an engine output, not an external geometry input. Observing
  // it would feed our own height-map writes back into ResizeObserver delivery.
  // Engine geometry updates and widget/font inputs already invalidate layout.

  const userIntent = () => { anchor = null; };
  const onScroll = () => {
    if (!active() || committing) return;
    if (Math.abs(view.scrollDOM.scrollTop - expectedScrollTop) > 0.5) {
      if (anchor && (view.scrollDOM.clientWidth !== committedWidth
        || view.scrollDOM.clientHeight !== committedHeight
        || Math.abs(view.contentDOM.getBoundingClientRect().height - committedContentHeight) >= 0.5)) return;
      const scroll = view.scrollDOM;
      anchor = scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop <= 1
        ? { position: view.state.doc.length, offset: 0, edge: "end", snapshot: null } : null;
      invalidate("navigation");
    }
  };
  view.scrollDOM.addEventListener("scroll", onScroll, { passive: true, capture: true });
  view.scrollDOM.addEventListener("wheel", userIntent, { passive: true });
  view.scrollDOM.addEventListener("touchstart", userIntent, { passive: true });
  view.contentDOM.addEventListener("pointerdown", userIntent);
  view.contentDOM.addEventListener("keydown", userIntent);
  const fonts = view.dom.ownerDocument.fonts;
  const onFonts = (event: FontFaceSetLoadEvent) => {
    // Stylesheet reconfiguration can complete an empty font-loading cycle.
    // Only newly loaded faces can change glyph metrics.
    if (event.fontfaces.length) invalidate("typography");
  };
  fonts?.addEventListener("loadingdone", onFonts);
  invalidate("geometry");

  return {
    observe(element, onHeight, onWidth) {
      if (!active()) return () => {};
      observations.get(element)?.stop();
      const observation: Observation = { width: null, height: null, onHeight, onWidth, stop: () => {} };
      observations.set(element, observation);
      const stop = registration.observe(element, () => { pending.add(element); revision += 1; });
      observation.stop = () => {
        if (observations.get(element) !== observation) return;
        observations.delete(element); pending.delete(element); stop();
      };
      return observation.stop;
    },
    schedule(key, read, write) {
      if (!active()) return;
      const document = view.state.doc;
      view.requestMeasure({ key,
        read: () => active() && view.state.doc === document ? { value: read() } : null,
        write: result => { if (result && active() && view.state.doc === document) write(result.value); },
      });
    },
    request: () => invalidate("geometry"),
    invalidate,
    navigation() { if (!committing) anchor = null; },
    update(update) {
      if (!active() || committing) return;
      anchor = mapReadingAnchor(anchor, update);
      if (update.selectionSet || update.transactions.some(transaction => transaction.scrollIntoView || transaction.annotation(codeMirrorNavigationIntent))) {
        anchor = null;
        invalidate("navigation");
      }
      if (update.docChanged) invalidate("content");
      else if (update.transactions.some(transaction => transaction.reconfigured)) invalidate("appearance");
      if (update.geometryChanged && view.scrollDOM.clientWidth === committedWidth
        && view.scrollDOM.clientHeight === committedHeight && revision === committedRevision) invalidate("geometry");
    },
    snapshot: () => ({ revision, committedRevision, committedWidth, commits, skipped, maxCommitMs, disposed, suspended, faulted }),
    dispose() {
      if (disposed) return;
      disposed = true;
      anchor = null; measured = null;
      registration.dispose();
      observations.clear(); pending.clear();
      view.scrollDOM.removeEventListener("scroll", onScroll, true);
      view.scrollDOM.removeEventListener("wheel", userIntent);
      view.scrollDOM.removeEventListener("touchstart", userIntent);
      view.contentDOM.removeEventListener("pointerdown", userIntent);
      view.contentDOM.removeEventListener("keydown", userIntent);
      fonts?.removeEventListener("loadingdone", onFonts);
    },
  };
}

function readTypographyMetrics(view: EditorView): string {
  const style = view.dom.ownerDocument.defaultView!.getComputedStyle(view.contentDOM);
  return [style.fontFamily, style.fontSize, style.fontWeight, style.fontStyle, style.fontStretch,
    style.fontFeatureSettings, style.fontVariationSettings, style.lineHeight, style.letterSpacing,
    style.whiteSpace, style.direction, style.paddingTop, style.paddingBottom, style.paddingLeft, style.paddingRight].join(";");
}
