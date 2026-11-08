import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import { ViewPlugin, type EditorView } from "@codemirror/view";
import {
  markdownAssetResolverRevisionFacet,
  markdownAssetUrlResolverFacet,
  markdownDocumentPathFacet,
  markdownWorkspaceIdFacet,
  markdownWorkspaceRootFacet,
} from "../../core/editor/markdownLivePreviewContext";
import { getMarkdownPlansInRange } from "../../core/plans/markdownPlanIndex";
import { markdownLivePreviewDecorations, requestMarkdownProjectionRange } from "../../core/projection/markdownDocumentProjection";
import { createImageGeometryCache, type ImageGeometrySnapshot } from "./imageGeometryCache";

type Store = ReturnType<typeof createImageGeometryCache>;
type Scope = ReturnType<typeof scopeFor>;
type Publication = Readonly<{ width: number; lineInset?: number; cache: Store }>;
type Presentation = Readonly<{ width: number; lineInset: number | null; cache: Store | null; snapshot: ImageGeometrySnapshot | null; generation: object }>;
const stores = new WeakMap<EditorView, { scope: Scope; cache: Store }>();
export const imageGeometryPresentationEffect = StateEffect.define<Publication>();
export const imageGeometryPresentation = StateField.define<Presentation>({
  create: () => ({ width: 0, lineInset: null, cache: null, snapshot: null, generation: {} }),
  update(value, transaction) {
    const before = scopeFor(transaction.startState), after = scopeFor(transaction.state);
    if (!before.every((part, i) => part === after[i])) return { ...value, cache: null, snapshot: null, generation: {} };
    for (const effect of transaction.effects) {
      if (effect.is(imageGeometryPresentationEffect)) return {
        ...value, width: effect.value.width, lineInset: effect.value.lineInset ?? value.lineInset,
        cache: effect.value.cache, snapshot: effect.value.cache.snapshot(),
      };
    }
    return value;
  },
});
function scopeFor(state: EditorState) {
  return [state.facet(markdownDocumentPathFacet), state.facet(markdownWorkspaceIdFacet), state.facet(markdownWorkspaceRootFacet), state.facet(markdownAssetResolverRevisionFacet), state.facet(markdownAssetUrlResolverFacet)] as const;
}
/** Geometry is view-local even if a source appears in two differently sized panes. */
export function getImageGeometryCache(view: EditorView): Store {
  const scope = scopeFor(view.state);
  const previous = stores.get(view);
  if (previous && previous.scope.every((value, i) => value === scope[i])) return previous.cache;
  previous?.cache.clear();
  const cache = createImageGeometryCache(); stores.set(view, { scope, cache }); return cache;
}
const imageGeometryPlugin = ViewPlugin.define(view => {
  let disposed = false;
  let subscribed: Store | null = null;
  let unsubscribe = () => {};
  const key = {};
  const bind = () => {
    const cache = getImageGeometryCache(view);
    if (cache !== subscribed) { unsubscribe(); subscribed = cache; unsubscribe = cache.subscribe(schedule); }
    return cache;
  };
  function schedule() {
    if (disposed) return;
    view.requestMeasure({ key,
      read() {
        const cache = bind(), previous = view.state.field(imageGeometryPresentation);
        const window = view.dom.ownerDocument.defaultView!;
        const style = window.getComputedStyle(view.contentDOM);
        // Only an image's own plain line can define its inset. An arbitrary
        // first visible text line may be indented by a list or a quote.
        const line = view.contentDOM.querySelector<HTMLElement>(".cm-line:has(.cm-md-image-widget.is-block)");
        const lineStyle = line ? window.getComputedStyle(line) : null;
        const number = (s: string | undefined) => parseFloat(s ?? "0") || 0;
        const lineInset = lineStyle ? number(lineStyle.paddingLeft) + number(lineStyle.paddingRight) : previous.lineInset;
        if (lineInset === null) return null;
        const width = view.contentDOM.clientWidth - number(style.paddingLeft) - number(style.paddingRight) - lineInset;
        return { cache, width, lineInset };
      },
      write(measured) {
        if (!measured) return;
        // CodeMirror's measure write phase cannot dispatch another update.
        queueMicrotask(() => {
          if (disposed || !view.dom.isConnected || measured.width <= 0 || getImageGeometryCache(view) !== measured.cache) return;
          const previous = view.state.field(imageGeometryPresentation);
          if (previous.cache === measured.cache && previous.snapshot?.revision === measured.cache.revision
            && Math.abs(previous.width - measured.width) < .5 && previous.lineInset === measured.lineInset) return;
          const effects: StateEffect<unknown>[] = [imageGeometryPresentationEffect.of(measured)];
          if (view.state.field(markdownLivePreviewDecorations, false)) {
            for (const { plan } of getMarkdownPlansInRange(view.state, 0, view.state.doc.length)) {
              if (plan.presentation !== "inlineAtom" || plan.atom.kind !== "image" || plan.atom.displayMode !== "block") continue;
              // Only image ranges change. Text, tables and other embeds keep
              // their existing projections and mounted resource sessions.
              effects.push(requestMarkdownProjectionRange(view.state, plan.sourceRange.from, plan.sourceRange.to, "layout"));
            }
          }
          view.dispatch({ effects });
        });
      },
    });
  }
  bind(); schedule();
  return {
    update(update) {
      const cache = bind();
      if (update.docChanged && !view.state.doc.length) cache.clear();
      if (update.geometryChanged || update.transactions.some(t => t.reconfigured)) schedule();
    },
    destroy() { disposed = true; unsubscribe(); stores.get(view)?.cache.clear(); stores.delete(view); },
  };
});
export const imageGeometryExtension = [imageGeometryPresentation, imageGeometryPlugin];
