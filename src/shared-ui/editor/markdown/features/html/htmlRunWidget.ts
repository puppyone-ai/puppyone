import { EditorView, type Rect, WidgetType } from "@codemirror/view";
import type { MarkdownAssetUrlResolver } from "../../../registry/viewerTypes";
import { getMarkdownLocalization } from "../../core/editor/markdownLocalization";
import { openMarkdownHref } from "../../core/editor/markdownLivePreviewContext";
import type { AssetBrokerHandle } from "../../platform/brokers/assetBroker";
import { getMarkdownEmbedHost } from "../../platform/codemirror/embedHost";
import { MarkdownWidgetMeasureController } from "../../platform/codemirror/layoutCoordinator";
import { disposeWidgetSessionDom } from "../../platform/codemirror/widgetSession";
import type { MarkdownInlinePreviewRenderer } from "../../shared/preview/markdownInlinePreviewPort";
import {
  getInlineWidgetEdgeX,
  getInlineWidgetTextCoords,
} from "../../shared/widgets/markdownWidgetMeasure";
import { createBrokeredHtmlMediaResolver, hydrateDeferredHtmlMedia } from "./htmlMediaHydration";
import { prepareHtmlListGeometry } from "./htmlListGeometry";
import { bindInlineHtmlDomInteractions } from "./inlineHtmlDomAdapter";
import { appendSanitizedInlineHtml } from "./sanitizeHtml";

/** DOM that answers a pointer itself rather than asking for the source. */
const HTML_RUN_INTERACTIVE_SELECTOR = "[data-md-href], summary, video";

type MarkdownHtmlRun = Readonly<{
  source: string;
  rootIsBlock: boolean;
  profileVersion: string;
}>;

/**
 * One balanced stretch of inline HTML, parsed by the browser and mounted as a
 * single atom. The surrounding text stays ordinary editable Markdown, and a
 * caret touching the run replaces this widget with its canonical source.
 */
export class HtmlRunWidget extends WidgetType {
  constructor(
    private readonly run: MarkdownHtmlRun,
    private readonly documentPath: string,
    private readonly markdownAssetUrlResolver: MarkdownAssetUrlResolver | null,
    private readonly renderInlinePreview: MarkdownInlinePreviewRenderer,
  ) {
    super();
  }

  eq(widget: WidgetType): boolean {
    return (
      widget instanceof HtmlRunWidget &&
      widget.run.source === this.run.source &&
      widget.run.rootIsBlock === this.run.rootIsBlock &&
      widget.run.profileVersion === this.run.profileVersion &&
      widget.documentPath === this.documentPath &&
      widget.markdownAssetUrlResolver === this.markdownAssetUrlResolver &&
      widget.renderInlinePreview === this.renderInlinePreview
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const host = getMarkdownEmbedHost(view, {
      resolveAssetUrl: this.markdownAssetUrlResolver,
    });
    const shell = document.createElement("span");
    shell.className = this.run.rootIsBlock
      ? "cm-md-html-run is-block cm-md-html-rendered-surface"
      : "cm-md-html-run";

    const measure = new MarkdownWidgetMeasureController(host.layout);
    const abort = new AbortController();
    const handles = new Set<AssetBrokerHandle>();
    const isCurrent = () => !abort.signal.aborted;
    const onLayoutChange = () => measure.schedule();
    const openHref = (href: string) => {
      openMarkdownHref(href, view);
    };
    const resolver = this.markdownAssetUrlResolver
      ? createBrokeredHtmlMediaResolver({
          view,
          host,
          root: shell,
          handles,
          isCurrent,
          onLayoutChange,
        })
      : null;

    const template = document.createElement("template");
    template.innerHTML = this.run.source;
    const result = appendSanitizedInlineHtml(
      shell,
      template.content,
      (target, text) => this.renderInlinePreview(target, text, {
        treatHtmlAsText: true,
        sourcePath: this.documentPath,
        onLayoutChange,
        openHref,
        resolveAssetUrl: resolver
          ? (documentPath, href, signal) => resolver(documentPath, href, "image", signal)
          : undefined,
        t: getMarkdownLocalization(view).t,
      }),
      { deferredMedia: true },
    );

    if (result.supported) {
      prepareHtmlListGeometry(shell);
      bindInlineHtmlDomInteractions(shell, { openHref });
      if (resolver) {
        hydrateDeferredHtmlMedia({
          root: shell,
          documentPath: this.documentPath,
          resolver,
          signal: abort.signal,
          isCurrent,
          onLayoutChange,
        });
      }
    } else {
      // The plan already passed this policy, so this guards a violated contract.
      shell.replaceChildren(document.createTextNode(this.run.source));
    }

    measure.observe(shell);
    host.sessions.mount(shell, () => ({
      dispose() {
        abort.abort();
        for (const handle of handles) handle.revoke();
        handles.clear();
        measure.destroy();
      },
    }));

    return shell;
  }

  destroy(dom: HTMLElement) {
    disposeWidgetSessionDom(dom);
  }

  ignoreEvent(event: Event): boolean {
    // Any other pointer gesture reaches CodeMirror, whose caret then lands on
    // the run edge and reveals the source. That is the widget's only edit path.
    const target = event.target;
    return target instanceof Element && target.closest(HTML_RUN_INTERACTIVE_SELECTOR) !== null;
  }

  coordsAt(dom: HTMLElement, pos: number, side: number): Rect | null {
    return getInlineWidgetTextCoords(dom, getInlineWidgetEdgeX(dom, pos, side));
  }
}
