import { EditorSelection } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import type { MarkdownLinkGraph } from "../../../registry/viewerTypes";
import type { MarkdownMdxTab } from "../../core/features/markdownFeatureData";
import { getMarkdownLocalization } from "../../core/editor/markdownLocalization";
import {
  markdownLinkCommandsFacet,
  openMarkdownHref,
} from "../../core/editor/markdownLivePreviewContext";
import { markdownRevealedSourceEffect } from "../../core/state/revealedSource";
import { getMarkdownEmbedHost } from "../../platform/codemirror/embedHost";
import { MarkdownWidgetMeasureController } from "../../platform/codemirror/layoutCoordinator";
import { disposeWidgetSessionDom } from "../../platform/codemirror/widgetSession";
import type { MarkdownMountedBlockExecution } from "../../core/plans/markdownBlockExecution";
import type { MarkdownInlinePreviewRenderer } from "../../shared/preview/markdownInlinePreviewPort";
import { getMappedWidgetSourceRange } from "../../shared/widgets/widgetDom";
import { getInlinePreviewLinkIdentity } from "../../core/links/inlinePreviewLinkIdentity";

export class MarkdownMdxTabsWidget extends WidgetType {
  private linkIdentity: string | undefined;

  private getLinkIdentity(): string {
    return this.linkIdentity ??= getInlinePreviewLinkIdentity(
      this.tabs.map((tab) => tab.content), this.markdownLinkGraph, this.documentPath,
    );
  }

  constructor(
    private readonly from: number,
    private readonly to: number,
    private readonly source: string,
    private readonly tabs: readonly MarkdownMdxTab[],
    private readonly markdownLinkGraph: MarkdownLinkGraph | null,
    private readonly documentPath: string,
    private readonly renderInlinePreview: MarkdownInlinePreviewRenderer,
    private readonly layoutEstimatedHeight: number,
    private readonly execution: MarkdownMountedBlockExecution,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof MarkdownMdxTabsWidget
      && other.from === this.from
      && other.to === this.to
      && other.source === this.source
      && ((other.markdownLinkGraph?.revision ?? 0) === (this.markdownLinkGraph?.revision ?? 0)
        || other.getLinkIdentity() === this.getLinkIdentity())
      && other.documentPath === this.documentPath
      && other.renderInlinePreview === this.renderInlinePreview
      && other.layoutEstimatedHeight === this.layoutEstimatedHeight
      && other.execution.mode === this.execution.mode
      && other.execution.budgetVersion === this.execution.budgetVersion;
  }

  get estimatedHeight() {
    return this.layoutEstimatedHeight;
  }

  toDOM(view: EditorView): HTMLElement {
    const doc = view.dom.ownerDocument;
    const localization = getMarkdownLocalization(view);
    const host = getMarkdownEmbedHost(view);
    const measure = new MarkdownWidgetMeasureController(host.layout);
    const wrapper = doc.createElement("div");
    wrapper.className = "cm-md-mdx-tabs-widget";
    wrapper.dir = localization.direction;
    wrapper.dataset.mdMdxComponent = "Tabs";

    const toolbar = doc.createElement("div");
    toolbar.className = "cm-md-mdx-tabs-toolbar";
    const tabList = doc.createElement("div");
    tabList.className = "cm-md-mdx-tabs-list";
    tabList.dataset.poScrollbar = "horizontal";
    tabList.setAttribute("role", "tablist");
    tabList.setAttribute("aria-label", "Tabs");
    const sourceButton = doc.createElement("button");
    sourceButton.type = "button";
    sourceButton.className = "cm-md-mdx-source-toggle";
    sourceButton.textContent = "</>";
    sourceButton.title = localization.t("editor.mode.source");
    sourceButton.setAttribute("aria-label", localization.t("editor.mode.source"));
    toolbar.append(tabList, sourceButton);

    const panels = doc.createElement("div");
    panels.className = "cm-md-mdx-tabs-panels";
    const buttons: HTMLButtonElement[] = [];
    const panelElements: HTMLElement[] = [];

    const activate = (nextIndex: number, focus = false) => {
      const activeIndex = Math.max(0, Math.min(nextIndex, this.tabs.length - 1));
      buttons.forEach((button, index) => {
        const selected = index === activeIndex;
        button.setAttribute("aria-selected", String(selected));
        button.tabIndex = selected ? 0 : -1;
        button.classList.toggle("is-active", selected);
        const panel = panelElements[index];
        if (panel) panel.hidden = !selected;
      });
      if (focus) buttons[activeIndex]?.focus();
      measure.schedule();
    };

    this.tabs.forEach((tab, index) => {
      const button = doc.createElement("button");
      const tabId = `mdx-tab-${this.from}-${index}`;
      const panelId = `mdx-panel-${this.from}-${index}`;
      button.type = "button";
      button.id = tabId;
      button.className = "cm-md-mdx-tab";
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", panelId);
      button.textContent = tab.label;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        activate(index);
      });
      button.addEventListener("keydown", (event) => {
        let nextIndex: number | null = null;
        if (event.key === "ArrowRight") nextIndex = (index + 1) % this.tabs.length;
        else if (event.key === "ArrowLeft") nextIndex = (index - 1 + this.tabs.length) % this.tabs.length;
        else if (event.key === "Home") nextIndex = 0;
        else if (event.key === "End") nextIndex = this.tabs.length - 1;
        if (nextIndex == null) return;
        event.preventDefault();
        event.stopPropagation();
        activate(nextIndex, true);
      });
      buttons.push(button);
      tabList.appendChild(button);

      const panel = doc.createElement("section");
      panel.id = panelId;
      panel.className = "cm-md-mdx-tab-panel";
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", tabId);
      panel.dir = "auto";
      this.renderInlinePreview(panel, tab.content.trim(), {
        markdownLinkGraph: this.markdownLinkGraph,
        markdownLinkCommands: view.state.facet(markdownLinkCommandsFacet),
        sourcePath: this.documentPath,
        openHref: (href) => openMarkdownHref(href, view),
        t: localization.t,
        onLayoutChange: () => measure.schedule(),
      });
      panelElements.push(panel);
      panels.appendChild(panel);
    });

    sourceButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const range = getMappedWidgetSourceRange(view, wrapper, this.source.length);
      if (!range) return;
      view.dispatch({
        effects: markdownRevealedSourceEffect.of({ ...range, presentation: "block" }),
        selection: EditorSelection.cursor(Math.min(range.to, range.from + 1)),
        scrollIntoView: true,
      });
      queueMicrotask(() => view.dom.isConnected && view.focus());
    });

    wrapper.append(toolbar, panels);
    activate(0);
    measure.observe(wrapper);
    host.sessions.mount(wrapper, () => ({ dispose: () => measure.destroy() }));
    return wrapper;
  }

  destroy(dom: HTMLElement) {
    disposeWidgetSessionDom(dom);
  }

  ignoreEvent() {
    return false;
  }
}
