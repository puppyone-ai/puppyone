import { EditorView, WidgetType } from "@codemirror/view";
import { getMarkdownEmbedHost } from "../../platform/codemirror/embedHost";
import { MarkdownWidgetMeasureController } from "../../platform/codemirror/layoutCoordinator";
import { disposeWidgetSessionDom } from "../../platform/codemirror/widgetSession";
import type { AssetBrokerHandle } from "../../platform/brokers/assetBroker";
import { isBrokerSafeResolvedAssetUrl } from "../../platform/policy/markdownAssetPolicy";
import {
  createPrincipalFromView,
  markdownAssetUrlResolverFacet,
  markdownDocumentPathFacet,
} from "../../core/editor/markdownLivePreviewContext";
import type { ResolvedMarkdownVideoModel } from "./resolveMarkdownVideoModel";

/** A mounted playback session for one typed Markdown video atom. */
export class VideoPreviewWidget extends WidgetType {
  private readonly sourceLength: number;
  private readonly renderKey: string;

  constructor(
    from: number,
    to: number,
    private readonly model: ResolvedMarkdownVideoModel,
    private readonly documentPath: string,
    private readonly layoutEstimatedHeight = 360,
  ) {
    super();
    this.sourceLength = Math.max(0, to - from);
    this.renderKey = JSON.stringify(model);
  }

  eq(widget: WidgetType): boolean {
    return (
      widget instanceof VideoPreviewWidget &&
      widget.sourceLength === this.sourceLength &&
      widget.renderKey === this.renderKey &&
      widget.documentPath === this.documentPath &&
      widget.layoutEstimatedHeight === this.layoutEstimatedHeight
    );
  }

  get estimatedHeight(): number {
    return this.layoutEstimatedHeight;
  }

  toDOM(view: EditorView): HTMLElement {
    const host = getMarkdownEmbedHost(view, {
      resolveAssetUrl: view.state.facet(markdownAssetUrlResolverFacet),
    });
    const shell = document.createElement("div");
    shell.className = "cm-md-video-widget";
    shell.dataset.previewState = "loading";
    shell.setAttribute("aria-busy", "true");

    const placeholder = createVideoPlaceholder("", true);
    const video = document.createElement("video");
    video.className = "cm-md-video-player";
    video.controls = true;
    video.autoplay = false;
    video.preload = this.model.preload;
    video.loop = this.model.loop;
    video.muted = this.model.muted;
    video.playsInline = this.model.playsInline;
    video.hidden = true;
    video.setAttribute("aria-hidden", "true");
    if (this.model.title) {
      video.title = this.model.title;
      video.setAttribute("aria-label", this.model.title);
    }
    if (this.model.width) video.width = this.model.width;
    if (this.model.height) video.height = this.model.height;
    shell.append(placeholder, video);

    const measure = new MarkdownWidgetMeasureController(host.layout);
    const abort = new AbortController();
    const activeHandles = new Set<AssetBrokerHandle>();
    let disposed = false;

    const clearMediaElement = () => {
      try {
        video.pause();
        video.removeAttribute("src");
        video.removeAttribute("poster");
        for (const source of video.querySelectorAll("source")) source.removeAttribute("src");
        video.load();
      } catch {
        // Resource revocation below is the authoritative cleanup boundary.
      }
    };
    const revokeActiveHandles = () => {
      for (const handle of activeHandles) handle.revoke();
      activeHandles.clear();
    };

    const reveal = () => {
      if (disposed || abort.signal.aborted || !video.isConnected) return;
      video.hidden = false;
      video.removeAttribute("aria-hidden");
      shell.dataset.previewState = "ready";
      shell.setAttribute("aria-busy", "false");
      placeholder.remove();
      measure.schedule();
    };
    const fail = () => {
      if (disposed || abort.signal.aborted || !shell.isConnected) return;
      shell.dataset.previewState = "error";
      shell.setAttribute("aria-busy", "false");
      clearMediaElement();
      revokeActiveHandles();
      video.remove();
      placeholder.replaceWith(createVideoPlaceholder(
        this.model.fallbackLabel,
        false,
      ));
      measure.schedule();
    };
    video.addEventListener("loadedmetadata", reveal, { once: true });
    video.addEventListener("loadeddata", reveal, { once: true });
    video.addEventListener("error", fail, { once: true });

    const principal = createPrincipalFromView(view, "asset-read");
    const documentPath = this.documentPath || view.state.facet(markdownDocumentPathFacet);
    const resolveSource = (href: string, kind: "image" | "video") =>
      host.assets.resolve({
        kind,
        principal,
        sourcePath: documentPath,
        href,
        signal: abort.signal,
      });

    void Promise.all([
      Promise.all(this.model.sources.map((source) => resolveSource(source.href, "video"))),
      this.model.poster ? resolveSource(this.model.poster.href, "image") : Promise.resolve(null),
    ]).then(([sourceHandles, posterHandle]) => {
      const handles = [...sourceHandles, posterHandle].filter(
        (handle): handle is AssetBrokerHandle => Boolean(handle),
      );
      if (disposed || abort.signal.aborted || !shell.isConnected) {
        for (const handle of handles) handle.revoke();
        return;
      }
      for (const handle of handles) activeHandles.add(handle);

      const resolvedSources = sourceHandles.flatMap((handle, index) => {
        if (!handle || !isBrokerSafeResolvedAssetUrl(handle.url, "video")) return [];
        const authored = this.model.sources[index];
        if (!authored) return [];
        return [{ handle, authored }];
      });
      if (resolvedSources.length === 0) {
        fail();
        return;
      }

      if (posterHandle && isBrokerSafeResolvedAssetUrl(posterHandle.url, "image")) {
        video.setAttribute("poster", posterHandle.url);
        posterHandle.subscribe?.((url) => { if (url) video.setAttribute("poster", url); else video.removeAttribute("poster"); });
      }
      video.replaceChildren(...resolvedSources.map(({ handle, authored }) => {
        const source = document.createElement("source");
        source.src = handle.url;
        handle.subscribe?.((url) => {
          if (disposed || abort.signal.aborted) return;
          if (url) source.src = url; else source.removeAttribute("src");
          video.load();
        });
        const type = authored.type ?? handle.mimeType;
        if (type?.startsWith("video/")) source.type = type;
        return source;
      }));
      try {
        video.load();
      } catch {
        fail();
      }
      measure.schedule();
    }).catch(fail);

    measure.observe(shell);
    host.sessions.mount(shell, () => ({
      dispose() {
        disposed = true;
        abort.abort();
        clearMediaElement();
        revokeActiveHandles();
        measure.destroy();
      },
    }));

    return shell;
  }

  destroy(dom: HTMLElement) {
    disposeWidgetSessionDom(dom);
  }

  ignoreEvent() {
    // Native video controls own pointer/keyboard gestures. CodeMirror must not
    // interpret the same event as a document selection or source reveal.
    return true;
  }
}

function createVideoPlaceholder(label: string, loading: boolean): HTMLElement {
  const placeholder = document.createElement("div");
  placeholder.className = "cm-md-video-placeholder";
  if (loading) {
    placeholder.classList.add("is-loading");
    placeholder.setAttribute("aria-hidden", "true");
  } else {
    placeholder.textContent = label;
  }
  return placeholder;
}
