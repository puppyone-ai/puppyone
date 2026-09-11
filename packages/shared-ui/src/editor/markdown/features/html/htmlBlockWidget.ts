import { EditorSelection } from "@codemirror/state";
import { EditorView, WidgetType } from "@codemirror/view";
import { bidiIsolate } from "@puppyone/localization/core";
import type { MarkdownAssetUrlResolver } from "../../../registry/viewerTypes";
import type { MarkdownHtmlBlockRenderProfile } from "../../core/features/markdownFeatureData";
import { getMarkdownEmbedHost } from "../../platform/codemirror/embedHost";
import { disposeWidgetSessionDom } from "../../platform/codemirror/widgetSession";
import { bindInlineHtmlDomInteractions } from "./inlineHtmlDomAdapter";
import {
  resolveMarkdownImageSrcset,
} from "../image/markdownImageModel";
import type { BrokeredMarkdownMediaUrlResolver } from "../media/markdownMediaReference";
import { prepareBrokeredMarkdownImage } from "../media/markdownPassiveImage";
import type { MarkdownHtmlBlock } from "./htmlBlockModel";
import { createSanitizedBlockHtmlFragment } from "./sanitizeHtml";
import type { AssetBrokerHandle } from "../../platform/brokers/assetBroker";
import {
  createPrincipalFromView,
  openMarkdownHref,
} from "../../core/editor/markdownLivePreviewContext";
import { MarkdownWidgetMeasureController } from "../../platform/codemirror/layoutCoordinator";
import { estimateHtmlBlockLayoutHeight } from "./htmlBlockLayout";
import {
  getMarkdownLocalization,
  type MarkdownLocalization,
} from "../../core/editor/markdownLocalization";
import {
  MARKDOWN_RICH_BLOCK_EXECUTION,
  type MarkdownMountedBlockExecution,
} from "../../core/plans/markdownBlockExecution";
import { markdownRevealedSourceEffect } from "../../core/state/revealedSource";
import { isBrokerSafeResolvedAssetUrl } from "../../platform/policy/markdownAssetPolicy";
import { getMappedWidgetSourceRange } from "../../shared/widgets/widgetDom";

const HTML_MEDIA_RESOLUTION_CONCURRENCY = 6;

type MarkdownRenderableHtmlBlock = Omit<
  MarkdownHtmlBlock,
  "status" | "diagnostic"
> & Readonly<{
  profile: MarkdownHtmlBlockRenderProfile;
  profileVersion: string;
  requiresAssetBroker: boolean;
  externalHref: string | null;
}>;

/**
 * Immutable HTML-block descriptor. Message listeners, timers, measure, asset
 * loads, and web-embed sessions belong to the mounted DOM session.
 */
export class HtmlBlockWidget extends WidgetType {
  constructor(
    private readonly block: MarkdownRenderableHtmlBlock,
    private readonly documentPath: string,
    private readonly markdownAssetUrlResolver: MarkdownAssetUrlResolver | null,
    private readonly layoutEstimatedHeight = estimateHtmlBlockLayoutHeight(block.source),
    private readonly execution: MarkdownMountedBlockExecution = MARKDOWN_RICH_BLOCK_EXECUTION,
  ) {
    super();
  }

  eq(widget: WidgetType): boolean {
    return (
      widget instanceof HtmlBlockWidget &&
      widget.block.source === this.block.source &&
      widget.block.tagName === this.block.tagName &&
      widget.block.profile === this.block.profile &&
      widget.block.profileVersion === this.block.profileVersion &&
      widget.block.requiresAssetBroker === this.block.requiresAssetBroker &&
      widget.block.externalHref === this.block.externalHref &&
      widget.layoutEstimatedHeight === this.layoutEstimatedHeight &&
      widget.execution.mode === this.execution.mode &&
      widget.execution.budgetVersion === this.execution.budgetVersion &&
      widget.documentPath === this.documentPath &&
      widget.markdownAssetUrlResolver === this.markdownAssetUrlResolver
    );
  }

  get estimatedHeight(): number {
    return this.layoutEstimatedHeight;
  }

  toDOM(view: EditorView): HTMLElement {
    const { direction, t } = getMarkdownLocalization(view);
    const host = getMarkdownEmbedHost(view, {
      resolveAssetUrl: this.markdownAssetUrlResolver,
    });
    const shell = document.createElement("div");
    shell.className = "cm-md-html-widget";
    shell.dir = direction;
    const measure = new MarkdownWidgetMeasureController(host.layout);
    let previewVersion = 0;
    let activated = this.execution.mode !== "deferred";
    let webEmbedId: string | null = null;
    const activeAssetHandles = new Set<AssetBrokerHandle>();
    let previewAbort = new AbortController();
    let boundsUpdateListener: (() => void) | null = null;
    let boundsResizeObserver: ResizeObserver | null = null;

    const toolbar = document.createElement("div");
    toolbar.className = "cm-md-html-widget-toolbar";
    const toggleButton = document.createElement("button");
    toggleButton.className = "cm-md-html-source-toggle";
    toggleButton.type = "button";
    toolbar.appendChild(toggleButton);

    const content = document.createElement("div");
    content.className = "cm-md-html-widget-content";

    const stopBoundsTracking = () => {
      if (boundsUpdateListener) {
        window.removeEventListener("scroll", boundsUpdateListener, { capture: true } as EventListenerOptions);
        window.removeEventListener("resize", boundsUpdateListener);
        boundsUpdateListener = null;
      }
      boundsResizeObserver?.disconnect();
      boundsResizeObserver = null;
    };
    const startBoundsTracking = (embedId: string, element: HTMLElement) => {
      stopBoundsTracking();
      const updateBounds = () => {
        if (!element.isConnected || webEmbedId !== embedId) return;
        void host.webEmbeds.setBounds(embedId, getWebEmbedBounds(element));
      };
      boundsUpdateListener = updateBounds;
      window.addEventListener("scroll", updateBounds, { passive: true, capture: true });
      window.addEventListener("resize", updateBounds, { passive: true });
      if ("ResizeObserver" in window) {
        boundsResizeObserver = new ResizeObserver(updateBounds);
        boundsResizeObserver.observe(element);
      }
    };
    const clearPreviewLifecycle = () => {
      previewAbort.abort();
      previewAbort = new AbortController();
      stopBoundsTracking();
      for (const handle of activeAssetHandles) handle.revoke();
      activeAssetHandles.clear();
      if (webEmbedId) {
        host.webEmbeds.destroy(webEmbedId);
        webEmbedId = null;
      }
    };

    const nextPreviewVersion = () => {
      previewVersion += 1;
      return previewVersion;
    };
    const isPreviewVersionCurrent = (version: number) => !measure.destroyed && previewVersion === version;

    const createWebEmbedPlaceholder = (href: string) => {
      const principal = createPrincipalFromView(view, "web-embed");
      const embed = host.webEmbeds.create({
        principal,
        href,
        privacyProfile: "temporary-no-credential",
      });
      webEmbedId = embed.id;

      const wrapper = document.createElement("div");
      wrapper.className = "cm-md-html-web-embed";
      wrapper.dataset.embedState = embed.state;

      if (embed.state === "blocked") {
        wrapper.textContent = t("editor.markdown.html.embedBlocked");
        return wrapper;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "cm-md-html-web-embed-load";
      button.textContent = t("editor.markdown.html.loadEmbed", { href: bidiIsolate(href) });
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        button.disabled = true;
        button.textContent = t("shared-ui.loading");
        const initialBounds = getWebEmbedBounds(wrapper);
        startBoundsTracking(embed.id, wrapper);
        const activated = await host.webEmbeds.activate(embed.id, initialBounds);
        if (!activated || !wrapper.isConnected) {
          stopBoundsTracking();
          return;
        }
        wrapper.dataset.embedState = activated.state;
        if (activated.state === "loaded") {
          wrapper.replaceChildren();
          const frame = document.createElement("div");
          frame.className = "cm-md-html-web-embed-frame";
          frame.dataset.embedId = activated.id;
          frame.dataset.embedHref = href;
          frame.textContent = t("editor.markdown.html.embedded", { href: bidiIsolate(href) });
          wrapper.appendChild(frame);
          measure.schedule();
        } else {
          stopBoundsTracking();
          button.disabled = false;
          button.textContent = t("editor.markdown.html.loadEmbed", { href: bidiIsolate(href) });
        }
      });
      wrapper.appendChild(button);
      return wrapper;
    };

    /**
     * Build an asset resolver that routes through the host's asset broker so
     * all media loads are tracked under a capability principal and can be
     * revoked on session dispose.
     */
    const buildBrokerAssetResolver = (version: number): BrokeredMarkdownMediaUrlResolver | null => {
      if (!this.markdownAssetUrlResolver) return null;
      const principal = createPrincipalFromView(view, "asset-read");
      return (docPath, href, kind, signal) =>
        host.assets.resolve({ kind, principal, sourcePath: docPath, href, signal })
          .then((handle) => {
            if (!handle) return null;
            if (signal?.aborted || !isPreviewVersionCurrent(version)) {
              handle.revoke();
              return null;
            }
            activeAssetHandles.add(handle);
            let previousUrl = handle.url;
            handle.subscribe?.((url) => {
              if (!isPreviewVersionCurrent(version)) return;
              for (const element of content.querySelectorAll("[src], [srcset], [poster]")) {
                for (const attribute of ["src", "srcset", "poster"]) {
                  const value = element.getAttribute(attribute);
                  if (!value?.includes(previousUrl)) continue;
                  if (url) element.setAttribute(attribute, value.replaceAll(previousUrl, url));
                  else element.removeAttribute(attribute);
                }
              }
              previousUrl = url ?? previousUrl;
              measure.schedule();
            });
            return handle.url;
          });
    };

    const createPreviewBlock = (version: number) => {
      const sanitizedOptions = {
        openHref: (href: string) => {
          openMarkdownHref(href, view);
        },
      };
      if (!activated) {
        return createDeferredHtmlPlaceholder(() => {
          activated = true;
          render();
        });
      }

      const externalHref = this.block.externalHref;
      if (externalHref) {
        return createWebEmbedPlaceholder(externalHref);
      }

      const brokerResolver = buildBrokerAssetResolver(version);
      if (this.block.profile !== "safe-block-with-media") {
        return createSanitizedHtmlPreviewBlock(this.block, this.block.source, t, sanitizedOptions);
      }

      // The plan index includes broker availability, so this can occur only if
      // a host violates the compiled-plan contract between projection and mount.
      if (this.block.requiresAssetBroker && !brokerResolver) {
        return createDefensiveHtmlSourceFallback(this.block.source);
      }

      const wrapper = createSanitizedHtmlPreviewBlock(this.block, this.block.source, t, {
        ...sanitizedOptions,
        deferredMedia: true,
      });
      if (brokerResolver) {
        hydrateDeferredHtmlMedia({
          root: wrapper,
          documentPath: this.documentPath,
          resolver: brokerResolver,
          signal: previewAbort.signal,
          isCurrent: () => isPreviewVersionCurrent(version),
          onLayoutChange: () => measure.schedule(),
        });
      }
      return wrapper;
    };

    const render = () => {
      clearPreviewLifecycle();
      const version = nextPreviewVersion();
      content.replaceChildren(createPreviewBlock(version));
      toggleButton.replaceChildren(createHtmlSourceIcon());
      const toggleLabel = t("editor.markdown.html.showSource");
      toggleButton.title = toggleLabel;
      toggleButton.setAttribute("aria-label", toggleLabel);
      measure.schedule();
    };

    toggleButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const range = getMappedWidgetSourceRange(view, shell, this.block.source.length);
      if (!range) return;
      view.dispatch({
        effects: markdownRevealedSourceEffect.of({ ...range, presentation: "block" }),
        selection: EditorSelection.cursor(Math.min(range.to, range.from + 1)),
        scrollIntoView: true,
      });
      queueMicrotask(() => {
        if (view.dom.isConnected) view.focus();
      });
    });

    render();
    shell.append(toolbar, content);
    measure.observe(shell);

    host.sessions.mount(shell, () => ({
      dispose() {
        clearPreviewLifecycle();
        measure.destroy();
      },
    }));

    return shell;
  }

  destroy(dom: HTMLElement) {
    disposeWidgetSessionDom(dom);
  }

  ignoreEvent() {
    return true;
  }
}

function createSanitizedHtmlPreviewBlock(
  block: MarkdownRenderableHtmlBlock,
  source: string,
  t: MarkdownLocalization["t"],
  options: {
    brokeredMedia?: boolean;
    deferredMedia?: boolean;
    openHref?: (href: string) => void;
  } = {},
): HTMLElement {
  const result = createSanitizedBlockHtmlFragment(source, {
    brokeredMedia: options.brokeredMedia === true,
    deferredMedia: options.deferredMedia === true,
  });
  if (!result.supported) {
    return createDefensiveHtmlSourceFallback(block.source, result.reasons[0]);
  }

  const wrapper = document.createElement("div");
  wrapper.className = "cm-md-html-rendered-surface cm-md-html-block";
  wrapper.dataset.poScrollbar = "content";
  wrapper.dir = "auto";
  wrapper.appendChild(result.fragment);
  for (const pre of wrapper.querySelectorAll<HTMLElement>("pre")) {
    pre.dataset.poScrollbar = "content";
  }
  bindInlineHtmlDomInteractions(wrapper, { openHref: options.openHref });
  return wrapper;
}

function hydrateDeferredHtmlMedia({
  root,
  documentPath,
  resolver,
  signal,
  isCurrent,
  onLayoutChange,
}: {
  root: HTMLElement;
  documentPath: string;
  resolver: BrokeredMarkdownMediaUrlResolver;
  signal: AbortSignal;
  isCurrent: () => boolean;
  onLayoutChange: () => void;
}) {
  const tasks: Array<() => Promise<void>> = [];
  for (const image of root.querySelectorAll<HTMLImageElement>("img")) {
    const source = image.dataset.mdAssetSrc ?? null;
    const sourceSet = image.dataset.mdAssetSrcset ?? null;
    if (!source && !sourceSet) continue;

    image.dataset.mdAssetState = "loading";
    let hasAuthorizedSource = false;
    let browserLoadState: "pending" | "ready" | "failed" = "pending";
    let pendingResolutions = Number(Boolean(source)) + Number(Boolean(sourceSet));
    const finishOne = () => {
      pendingResolutions -= 1;
      if (pendingResolutions > 0) return;
      if (signal.aborted || !isCurrent() || !image.isConnected) return;
      delete image.dataset.mdAssetSrc;
      delete image.dataset.mdAssetSrcset;
      image.removeAttribute("aria-busy");
      if (!hasAuthorizedSource) {
        replaceUnavailableHtmlImage(image, source ?? sourceSet ?? "");
      } else if (browserLoadState === "failed") {
        replaceUnavailableHtmlImage(image, source ?? sourceSet ?? "");
      } else if (browserLoadState === "ready") {
        image.dataset.mdAssetState = "ready";
      } else {
        image.dataset.mdAssetState = "loading";
      }
      onLayoutChange();
    };
    image.addEventListener("load", () => {
      browserLoadState = "ready";
      image.dataset.mdAssetState = "ready";
      onLayoutChange();
    }, { once: true });
    image.addEventListener("error", () => {
      browserLoadState = "failed";
      if (pendingResolutions <= 0 && image.isConnected) {
        replaceUnavailableHtmlImage(image, source ?? sourceSet ?? "");
      }
      onLayoutChange();
    }, { once: true });

    if (source) {
      tasks.push(async () => {
        try {
          const resolved = await resolver(documentPath, source, "image", signal);
          if (signal.aborted || !isCurrent() || !image.isConnected) return;
          if (resolved && isBrokerSafeResolvedAssetUrl(resolved)) {
            prepareBrokeredMarkdownImage(image, resolved);
            image.src = resolved;
            hasAuthorizedSource = true;
          }
        } catch {
          // The inert placeholder remains when an asset cannot be resolved.
        } finally {
          finishOne();
        }
      });
    }

    if (sourceSet) {
      tasks.push(async () => {
        try {
          const resolved = await resolveMarkdownImageSrcset(
            sourceSet,
            documentPath,
            (sourcePath, href, nextSignal) => resolver(sourcePath, href, "image", nextSignal),
            signal,
          );
          if (signal.aborted || !isCurrent() || !image.isConnected) return;
          if (resolved) {
            prepareBrokeredMarkdownImage(image, resolved);
            image.srcset = resolved;
            hasAuthorizedSource = true;
          }
        } catch {
          // The inert placeholder remains when an asset cannot be resolved.
        } finally {
          finishOne();
        }
      });
    }
  }

  for (const video of root.querySelectorAll<HTMLVideoElement>("video")) {
    const directSource = video.dataset.mdAssetSrc ?? null;
    const posterSource = video.dataset.mdAssetPoster ?? null;
    const sourceElements = Array.from(video.querySelectorAll<HTMLSourceElement>("source"))
      .map((source) => ({ source, href: source.dataset.mdAssetSrc ?? null }))
      .filter((entry): entry is { source: HTMLSourceElement; href: string } => Boolean(entry.href));
    if (!directSource && !posterSource && sourceElements.length === 0) continue;

    video.controls = true;
    video.autoplay = false;
    video.preload = video.preload === "none" ? "none" : "metadata";
    video.addEventListener("loadedmetadata", onLayoutChange, { once: true });
    video.addEventListener("error", onLayoutChange, { once: true });

    tasks.push(async () => {
      try {
        const [resolvedDirect, resolvedPoster, resolvedChildren] = await Promise.all([
          directSource
            ? resolver(documentPath, directSource, "video", signal)
            : Promise.resolve(null),
          posterSource
            ? resolver(documentPath, posterSource, "image", signal)
            : Promise.resolve(null),
          Promise.all(sourceElements.map(({ href }) => resolver(documentPath, href, "video", signal))),
        ]);
        if (signal.aborted || !isCurrent() || !video.isConnected) return;

        if (resolvedDirect && isBrokerSafeResolvedAssetUrl(resolvedDirect, "video")) {
          video.setAttribute("src", resolvedDirect);
        }
        if (resolvedPoster && isBrokerSafeResolvedAssetUrl(resolvedPoster, "image")) {
          video.setAttribute("poster", resolvedPoster);
        }
        for (let index = 0; index < sourceElements.length; index += 1) {
          const resolved = resolvedChildren[index];
          const element = sourceElements[index]?.source;
          if (resolved && element && isBrokerSafeResolvedAssetUrl(resolved, "video")) {
            element.setAttribute("src", resolved);
          }
        }
        try {
          video.load();
        } catch {
          // Chromium owns media decode errors; the sanitized element remains
          // an honest, inert playback surface.
        }
      } catch {
        // Unresolved media never receives an ambient source URL.
      } finally {
        if (!signal.aborted && isCurrent() && video.isConnected) {
          delete video.dataset.mdAssetSrc;
          delete video.dataset.mdAssetPoster;
          for (const { source } of sourceElements) {
            delete source.dataset.mdAssetSrc;
            source.removeAttribute("aria-busy");
          }
          video.removeAttribute("aria-busy");
          onLayoutChange();
        }
      }
    });
  }
  void runDeferredMediaTasks(tasks, signal);
}

function replaceUnavailableHtmlImage(image: HTMLImageElement, authoredSource: string) {
  const label = image.alt.trim() || authoredSource.trim() || "Image unavailable";
  const fallback = document.createElement("span");
  fallback.className = "cm-md-html-image-fallback";
  fallback.dataset.mdAssetState = "unavailable";
  fallback.setAttribute("role", "img");
  fallback.setAttribute("aria-label", label);
  fallback.textContent = label;
  image.replaceWith(fallback);
}

async function runDeferredMediaTasks(
  tasks: readonly (() => Promise<void>)[],
  signal: AbortSignal,
) {
  const concurrency = Math.min(HTML_MEDIA_RESOLUTION_CONCURRENCY, tasks.length);
  let nextIndex = 0;
  const worker = async () => {
    while (!signal.aborted) {
      const index = nextIndex;
      nextIndex += 1;
      const task = tasks[index];
      if (!task) return;
      await task();
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
}

function getWebEmbedBounds(element: HTMLElement): { x: number; y: number; width: number; height: number } {
  // WebContentsView bounds are BrowserWindow content coordinates. DOMRect is
  // already viewport-relative; adding window.scrollX/Y makes native overlays
  // drift away from scrolled editor content.
  const rect = element.getBoundingClientRect();
  let left = Math.max(0, rect.left);
  let top = Math.max(0, rect.top);
  let right = Math.min(window.innerWidth, rect.right);
  let bottom = Math.min(window.innerHeight, rect.bottom);

  // Native child views do not honor renderer DOM overflow clipping. Showing a
  // partially clipped view would let it paint over editor/app chrome, so hide
  // it until the whole requested surface is inside every clipping ancestor.
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const style = window.getComputedStyle(ancestor);
    const ancestorRect = ancestor.getBoundingClientRect();
    if (/(auto|hidden|scroll|clip)/.test(style.overflowX)) {
      left = Math.max(left, ancestorRect.left);
      right = Math.min(right, ancestorRect.right);
    }
    if (/(auto|hidden|scroll|clip)/.test(style.overflowY)) {
      top = Math.max(top, ancestorRect.top);
      bottom = Math.min(bottom, ancestorRect.bottom);
    }
  }

  const fullyVisible =
    right > left &&
    bottom > top &&
    Math.abs(left - rect.left) < 1 &&
    Math.abs(top - rect.top) < 1 &&
    Math.abs(right - rect.right) < 1 &&
    Math.abs(bottom - rect.bottom) < 1;
  if (!fullyVisible) return { x: 0, y: 0, width: 0, height: 0 };

  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function createDeferredHtmlPlaceholder(onActivate: () => void): HTMLElement {
  const placeholder = document.createElement("div");
  placeholder.className = "cm-md-html-deferred";

  const label = document.createElement("span");
  label.textContent = "Large HTML preview is paused.";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "cm-md-html-deferred-load";
  button.textContent = "Render preview";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onActivate();
  }, { once: true });

  placeholder.append(label, button);
  return placeholder;
}

function createHtmlSourceIcon(): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "13");
  svg.setAttribute("height", "13");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  const paths = [
    ["polyline", "16 18 22 12 16 6"],
    ["polyline", "8 6 2 12 8 18"],
  ] as const;

  for (const item of paths) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", item[0]);
    element.setAttribute("points", item[1]);
    svg.appendChild(element);
  }

  return svg;
}


function createDefensiveHtmlSourceFallback(source: string, reason?: string): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "cm-md-html-source-fallback";
  wrapper.dataset.poScrollbar = "content";
  if (reason) wrapper.dataset.reason = reason;
  const sourceView = document.createElement("pre");
  sourceView.dataset.poScrollbar = "content";
  sourceView.textContent = source;
  wrapper.appendChild(sourceView);

  return wrapper;
}
