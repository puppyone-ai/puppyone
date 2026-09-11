import { EditorSelection } from "@codemirror/state";
import { EditorView, type Rect, WidgetType } from "@codemirror/view";
import { getMarkdownEmbedHost } from "../../platform/codemirror/embedHost";
import { disposeWidgetSessionDom } from "../../platform/codemirror/widgetSession";
import { isBrokerSafeResolvedAssetUrl } from "../../platform/policy/markdownAssetPolicy";
import type { AssetBrokerHandle } from "../../platform/brokers/assetBroker";
import {
  createPrincipalFromView,
  markdownDocumentPathFacet,
  markdownAssetUrlResolverFacet,
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
  ) {
    super();
    this.sourceLength = Math.max(0, to - from);
  }

  eq(widget: WidgetType): boolean {
    return (
      widget instanceof ImagePreviewWidget &&
      widget.sourceLength === this.sourceLength &&
      widget.alt === this.alt &&
      widget.source === this.source &&
      widget.title === this.title &&
      widget.documentPath === this.documentPath &&
      widget.resolvedSource === this.resolvedSource &&
      widget.displayMode === this.displayMode
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const host = getMarkdownEmbedHost(view, {
      resolveAssetUrl: view.state.facet(markdownAssetUrlResolverFacet),
    });
    const wrapper = document.createElement("span");
    wrapper.className = `cm-md-image-widget is-${this.displayMode}`;
    wrapper.dataset.displayMode = this.displayMode;
    wrapper.title = this.title ?? this.source;
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
      prepareBrokeredMarkdownImage(image, source);
      image.hidden = true;
      image.dataset.previewState = "loading";
      image.setAttribute("aria-hidden", "true");
      if (this.title) image.title = this.title;
      image.addEventListener("load", () => {
        const reveal = () => {
          if (abort.signal.aborted || !image.isConnected) return;
          image.hidden = false;
          image.dataset.previewState = "ready";
          image.removeAttribute("aria-hidden");
          placeholder.remove();
          measure.schedule();
        };
        if (typeof image.decode !== "function") {
          reveal();
          return;
        }
        void image.decode().catch(() => undefined).then(reveal);
      }, { once: true });
      image.addEventListener("error", () => {
        if (abort.signal.aborted || !image.isConnected) return;
        wrapper.replaceChildren(createPlaceholder(this.alt || this.source));
        measure.schedule();
      }, { once: true });
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
      return placeholder;
    };

    // A widget has exactly one mounted-session cleanup path, regardless of
    // whether reference resolution succeeds. Keeping lifecycle ownership out
    // of individual render branches prevents handles/listeners from drifting
    // apart as new media-reference forms are added.
    measure.observe(wrapper);
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
    const documentPath = this.documentPath || view.state.facet(markdownDocumentPathFacet);
    if (!this.resolvedSource) {
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
            if (!url) wrapper.replaceChildren(createPlaceholder(this.alt || this.source));
            else {
              const loading = createLoadingPlaceholder();
              wrapper.replaceChildren(loading, createImage(url, loading));
            }
            measure.schedule();
          });
        } else {
          wrapper.replaceChildren(createPlaceholder(this.alt || this.source));
        }
        measure.schedule();
      })
      .catch(() => {
        if (abort.signal.aborted || !wrapper.isConnected) return;
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
    return getInlineWidgetTextCoords(dom, getInlineWidgetEdgeX(dom, pos, side));
  }
}
