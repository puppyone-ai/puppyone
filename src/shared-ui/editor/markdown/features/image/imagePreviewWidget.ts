import { EditorSelection } from "@codemirror/state";
import { EditorView, type Rect, WidgetType } from "@codemirror/view";
import { commitEditorLayout } from "../../../runtime/editorLayout";
import { getMarkdownEmbedHost } from "../../platform/codemirror/embedHost";
import { disposeWidgetSessionDom } from "../../platform/codemirror/widgetSession";
import { isBrokerSafeResolvedAssetUrl } from "../../platform/policy/markdownAssetPolicy";
import type { AssetBrokerHandle } from "../../platform/brokers/assetBroker";
import {
  createPrincipalFromView,
  markdownDocumentPathFacet,
  markdownAssetUrlResolverFacet,
  openMarkdownHref,
} from "../../core/editor/markdownLivePreviewContext";
import { markdownRevealedSourceEffect } from "../../core/state/revealedSource";
import {
  getInlineWidgetEdgeX,
  getInlineWidgetTextCoords,
} from "../../shared/widgets/markdownWidgetMeasure";
import { MarkdownWidgetMeasureController } from "../../platform/codemirror/layoutCoordinator";
import { getMappedWidgetSourceRange, hasPointerMoved } from "../../shared/widgets/widgetDom";
import { prepareBrokeredMarkdownImage } from "../media/markdownPassiveImage";
import type { MarkdownImageDisplayMode } from "../../core/features/markdownFeatureData";
import { getImageGeometryCache } from "./imageGeometrySession";
import type { MarkdownImageGeometry } from "./imageGeometryCache";
const descriptors = new WeakMap<HTMLElement, ImagePreviewWidget>();

/**
 * Immutable image atom descriptor. Asset resolution, measure, and listeners
 * belong to the mounted DOM session.
 */
export class ImagePreviewWidget extends WidgetType {
  private readonly sourceLength: number;

  constructor(
    from: number,
    to: number,
    private readonly alt: string,
    private readonly source: string,
    private readonly title: string | null,
    private readonly documentPath: string,
    private readonly resolvedSource: string | null = source,
    private readonly displayMode: MarkdownImageDisplayMode = "inline",
    private readonly size: Readonly<{ width: number; height: number | null }> | null = null,
    private readonly estimatedHeightValue: number = -1,
    private readonly geometryScope: object | null = null,
  ) {
    super();
    this.sourceLength = Math.max(0, to - from);
  }

  eq(widget: WidgetType): boolean {
    return this.sameImage(widget) && widget.estimatedHeight === this.estimatedHeight;
  }

  get estimatedHeight(): number { return this.estimatedHeightValue; }

  private sameImage(widget: WidgetType): boolean {
    return (
      widget instanceof ImagePreviewWidget &&
      widget.sourceLength === this.sourceLength &&
      widget.alt === this.alt &&
      widget.source === this.source &&
      widget.title === this.title &&
      widget.documentPath === this.documentPath &&
      widget.resolvedSource === this.resolvedSource &&
      widget.displayMode === this.displayMode &&
      widget.geometryScope === this.geometryScope &&
      widget.size?.width === this.size?.width &&
      widget.size?.height === this.size?.height
    );
  }

  updateDOM(dom: HTMLElement): boolean {
    const previous = descriptors.get(dom);
    if (!previous || !this.sameImage(previous)) return false;
    descriptors.set(dom, this);
    return true;
  }

  toDOM(view: EditorView): HTMLElement {
    const host = getMarkdownEmbedHost(view, {
      resolveAssetUrl: view.state.facet(markdownAssetUrlResolverFacet),
    });
    const geometryCache = getImageGeometryCache(view);
    const documentPath = this.documentPath || view.state.facet(markdownDocumentPathFacet);
    const geometrySource = this.resolvedSource ?? this.source;
    const loadingGeometry = new WeakMap<HTMLElement, MarkdownImageGeometry>();
    const wrapper = document.createElement("span");
    descriptors.set(wrapper, this);
    wrapper.className = `cm-md-image-widget is-${this.displayMode}`;
    wrapper.dataset.displayMode = this.displayMode;
    if (this.title) wrapper.setAttribute("aria-description", this.title);
    wrapper.tabIndex = 0;
    wrapper.setAttribute("role", "img");
    wrapper.setAttribute("aria-label", this.alt || this.source);

    const measure = new MarkdownWidgetMeasureController(host.layout);
    const abort = new AbortController();
    let activeHandle: AssetBrokerHandle | null = null;
    let pointerDown: { x: number; y: number } | null = null;

    const getSourceRange = () => getMappedWidgetSourceRange(view, wrapper, this.sourceLength);
    const revealSource = () => {
      const range = getSourceRange();
      if (!range) return;
      view.dispatch({
        effects: markdownRevealedSourceEffect.of({ ...range, presentation: "inline" }),
        selection: EditorSelection.cursor(Math.min(range.to, range.from + 2)),
      });
      view.focus();
    };

    const onMouseDown = (event: MouseEvent) => {
      // CodeMirror handles mousedown before click and would otherwise move the
      // selection into the replaced Markdown range. That transient selection
      // reveals `![alt](src)` and destroys this widget for one frame before
      // onClick restores it. Own the complete pointer gesture here so one
      // click produces one editor transaction and one stable image DOM node.
      event.preventDefault();
      event.stopPropagation();
      pointerDown = { x: event.clientX, y: event.clientY };
    };
    const onClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const moved = pointerDown && hasPointerMoved(event, pointerDown);
      pointerDown = null;
      if (moved) return;

      // This widget owns the pointer gesture, so the link mark around a badge
      // image never sees it. Keep the link meaning of the whole label.
      const link = wrapper.closest<HTMLElement>('.cm-md-link-label[data-md-link-interaction="navigate"]');
      if (link?.dataset.mdHref && openMarkdownHref(link.dataset.mdHref, view)) return;

      // A document selection across a replacement decoration makes
      // CodeMirror tear down and recreate its DOM even when WidgetType.eq()
      // succeeds. Focus is the stable single-click selection state; explicit
      // source editing is reserved for double-click / Enter below.
      wrapper.focus({ preventScroll: true });
    };
    const onDoubleClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      revealSource();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        revealSource();
        return;
      }
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      if (view.state.readOnly) return;
      const range = getSourceRange();
      if (!range) return;
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: "" },
        selection: EditorSelection.cursor(range.from),
      });
      queueMicrotask(() => {
        if (view.dom.isConnected) view.focus();
      });
    };

    wrapper.addEventListener("mousedown", onMouseDown);
    wrapper.addEventListener("click", onClick);
    wrapper.addEventListener("dblclick", onDoubleClick);
    wrapper.addEventListener("keydown", onKeyDown);

    const createImage = (source: string, placeholder: HTMLElement) => {
      const image = document.createElement("img");
      image.alt = this.alt;
      if (this.size) {
        image.style.width = `${this.size.width}px`;
        if (this.size.height !== null) image.style.height = `${this.size.height}px`;
      }
      // CodeMirror already mounts only nearby widgets. This image must load
      // while hidden so decoding completes before its atomic layout reveal.
      image.loading = "eager";
      prepareBrokeredMarkdownImage(image, source);
      image.hidden = true;
      image.dataset.previewState = "loading";
      image.setAttribute("aria-hidden", "true");
      const fail = () => {
        if (abort.signal.aborted || !image.isConnected) return;
        commitEditorLayout(view.dom, () => {
          geometryCache.forget(documentPath, geometrySource);
          wrapper.replaceChildren(createPlaceholder(this.alt || this.source));
          measure.schedule();
        });
      };
      image.addEventListener("load", () => {
        const reveal = () => {
          if (abort.signal.aborted || !image.isConnected) return;
          const geometry = loadingGeometry.get(placeholder);
          const sameBox = Boolean(placeholder.style.aspectRatio && geometry
            && geometry.naturalWidth === image.naturalWidth
            && geometry.naturalHeight === image.naturalHeight);
          const publish = () => {
            image.hidden = false;
            image.dataset.previewState = "ready";
            image.removeAttribute("aria-hidden");
            placeholder.remove();
            if (getImageGeometryCache(view) === geometryCache) {
              geometryCache.remember(documentPath, geometrySource, {
                naturalWidth: image.naturalWidth,
                naturalHeight: image.naturalHeight,
              });
            }
            if (!sameBox) measure.schedule();
          };
          // Replacing equal-sized pixels is not a layout transaction. Asking
          // the host to restore an anchor here can rewind an active wheel
          // gesture even though the document geometry never changed.
          if (sameBox) publish();
          else commitEditorLayout(view.dom, publish);
        };
        if (typeof image.decode !== "function") {
          reveal();
          return;
        }
        void image.decode().then(reveal, fail);
      }, { once: true });
      image.addEventListener("error", fail, { once: true });
      image.src = source;
      return image;
    };
    const createPlaceholder = (labelText: string) => {
      const label = document.createElement("span");
      label.className = "cm-md-image-placeholder";
      label.textContent = labelText;
      return label;
    };

    const createLoadingPlaceholder = () => {
      const placeholder = createPlaceholder("");
      placeholder.classList.add("is-loading");
      placeholder.setAttribute("aria-hidden", "true");
      const geometry = geometryCache.read(documentPath, geometrySource);
      if (geometry) {
        // CodeMirror retains the measured line offscreen. Remounting a short
        // loading box would overwrite that height before decoding finishes.
        // Intrinsic dimensions let CSS fit the *current* pane without reading
        // layout during widget construction or retaining a stale pixel height.
        let width = this.size?.width ?? geometry.naturalWidth;
        if (this.displayMode === "inline" && !this.size) {
          width = Math.min(width, 320 * geometry.naturalWidth / geometry.naturalHeight);
        }
        placeholder.style.width = `${width}px`;
        placeholder.style.maxWidth = "100%";
        placeholder.style.aspectRatio = `${geometry.naturalWidth} / ${geometry.naturalHeight}`;
        placeholder.style.height = this.size && this.size.height !== null ? `${this.size.height}px` : "auto";
        placeholder.style.maxHeight = this.displayMode === "inline" ? "320px" : "none";
        placeholder.style.minHeight = "0px";
        placeholder.style.padding = "0";
        placeholder.style.borderWidth = "0";
        loadingGeometry.set(placeholder, geometry);
      }
      return placeholder;
    };

    // A widget has exactly one mounted-session cleanup path, regardless of
    // whether reference resolution succeeds. Keeping lifecycle ownership out
    // of individual render branches prevents handles/listeners from drifting
    // apart as new media-reference forms are added.
    // A new observation starts without a previous size and would report a
    // false geometry change for every remount. Reserved boxes already follow
    // the pane through responsive CSS; real decoded size changes explicitly
    // enter the layout coordinator above.
    if (!geometryCache.read(documentPath, geometrySource)) measure.observe(wrapper);
    host.sessions.mount(wrapper, () => ({
      dispose() {
        abort.abort();
        activeHandle?.revoke();
        activeHandle = null;
        measure.destroy();
        wrapper.removeEventListener("mousedown", onMouseDown);
        wrapper.removeEventListener("click", onClick);
        wrapper.removeEventListener("dblclick", onDoubleClick);
        wrapper.removeEventListener("keydown", onKeyDown);
      },
    }));

    wrapper.appendChild(createLoadingPlaceholder());
    if (!this.resolvedSource) {
      geometryCache.forget(documentPath, geometrySource);
      wrapper.replaceChildren(createPlaceholder(this.alt || this.source));
      return wrapper;
    }

    void host.assets
      .resolve({
        kind: "image",
        principal: createPrincipalFromView(view, "asset-read"),
        sourcePath: documentPath,
        href: this.resolvedSource,
        signal: abort.signal,
      })
      .then((handle) => {
        if (abort.signal.aborted || !wrapper.isConnected) {
          handle?.revoke();
          return;
        }
        activeHandle?.revoke();
        activeHandle = handle;
        if (handle && isBrokerSafeResolvedAssetUrl(handle.url)) {
          const placeholder = createLoadingPlaceholder();
          wrapper.replaceChildren(placeholder, createImage(handle.url, placeholder));
          handle.subscribe?.((url) => {
            if (abort.signal.aborted || !wrapper.isConnected) return;
            if (!url) {
              geometryCache.forget(documentPath, geometrySource);
              wrapper.replaceChildren(createPlaceholder(this.alt || this.source));
            }
            else {
              const loading = createLoadingPlaceholder();
              wrapper.replaceChildren(loading, createImage(url, loading));
            }
            measure.schedule();
          });
        } else {
          geometryCache.forget(documentPath, geometrySource);
          wrapper.replaceChildren(createPlaceholder(this.alt || this.source));
        }
        measure.schedule();
      })
      .catch(() => {
        if (abort.signal.aborted || !wrapper.isConnected) return;
        geometryCache.forget(documentPath, geometrySource);
        wrapper.replaceChildren(createPlaceholder(this.alt || this.source));
        measure.schedule();
      });

    return wrapper;
  }

  destroy(dom: HTMLElement) {
    disposeWidgetSessionDom(dom);
  }

  ignoreEvent() {
    // The widget owns pointer and keyboard interaction just like the HTML,
    // code, table, and task widgets. Letting CodeMirror also interpret the DOM
    // gesture creates a second selection path and transient source reveal.
    return true;
  }

  coordsAt(dom: HTMLElement, pos: number, side: number): Rect | null {
    const text = getInlineWidgetTextCoords(dom, getInlineWidgetEdgeX(dom, pos, side));
    if (this.displayMode !== "block" || !text) return text;
    const image = dom.getBoundingClientRect();
    const height = Math.min(image.height, Math.max(0, text.bottom - text.top));
    const atEnd = (this.sourceLength > 0 && pos >= this.sourceLength) || (pos > 0 && side >= 0);
    // The source endpoints of a standalone image bracket its visual surface.
    // Reporting its first text row for the end makes end-of-document scrolling
    // align the image's top to the viewport bottom when there is no final LF.
    return { ...text,
      top: atEnd ? image.bottom - height : image.top,
      bottom: atEnd ? image.bottom : image.top + height,
    };
  }
}
