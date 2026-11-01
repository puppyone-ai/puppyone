import type { EditorView } from "@codemirror/view";
import type { AssetBrokerHandle } from "../../platform/brokers/assetBroker";
import type { MarkdownEmbedHost } from "../../platform/codemirror/embedHost";
import { isBrokerSafeResolvedAssetUrl } from "../../platform/policy/markdownAssetPolicy";
import { createPrincipalFromView } from "../../core/editor/markdownLivePreviewContext";
import { resolveMarkdownImageSrcset } from "../image/markdownImageModel";
import type { BrokeredMarkdownMediaUrlResolver } from "../media/markdownMediaReference";
import { prepareBrokeredMarkdownImage } from "../media/markdownPassiveImage";

const HTML_MEDIA_RESOLUTION_CONCURRENCY = 6;

/**
 * Route sanitized HTML media through the host AssetBroker so every load is
 * tracked under a capability principal and revoked with its mounted session.
 */
export function createBrokeredHtmlMediaResolver({
  view,
  host,
  root,
  handles,
  isCurrent,
  onLayoutChange,
}: {
  view: EditorView;
  host: MarkdownEmbedHost;
  root: HTMLElement;
  handles: Set<AssetBrokerHandle>;
  isCurrent: () => boolean;
  onLayoutChange: () => void;
}): BrokeredMarkdownMediaUrlResolver {
  const principal = createPrincipalFromView(view, "asset-read");
  return (documentPath, href, kind, signal) =>
    host.assets.resolve({ kind, principal, sourcePath: documentPath, href, signal })
      .then((handle) => {
        if (!handle) return null;
        if (signal?.aborted || !isCurrent()) {
          handle.revoke();
          return null;
        }
        handles.add(handle);
        let previousUrl = handle.url;
        handle.subscribe?.((url) => {
          if (!isCurrent()) return;
          for (const element of root.querySelectorAll("[src], [srcset], [poster]")) {
            for (const attribute of ["src", "srcset", "poster"]) {
              const value = element.getAttribute(attribute);
              if (!value?.includes(previousUrl)) continue;
              if (url) element.setAttribute(attribute, value.replaceAll(previousUrl, url));
              else element.removeAttribute(attribute);
            }
          }
          previousUrl = url ?? previousUrl;
          onLayoutChange();
        });
        return handle.url;
      });
}

export function hydrateDeferredHtmlMedia({
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
    const pictureSources = getDeferredPictureSources(image);
    if (!source && !sourceSet && pictureSources.length === 0) continue;

    image.dataset.mdAssetState = "loading";
    let hasAuthorizedSource = false;
    let browserLoadState: "pending" | "ready" | "failed" = "pending";
    let pendingResolutions = Number(Boolean(source))
      + Number(Boolean(sourceSet))
      + Number(pictureSources.length > 0);
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

    // <source> candidates must be in place before <img> receives a URL, or the
    // browser first fetches and paints the fallback for a matching candidate.
    let releaseImage = () => {};
    const pictureSourcesReady = new Promise<void>((resolve) => {
      releaseImage = resolve;
    });
    if (pictureSources.length > 0) {
      tasks.push(async () => {
        try {
          await Promise.all(pictureSources.map(async (element) => {
            const resolved = await resolveMarkdownImageSrcset(
              element.dataset.mdAssetSrcset ?? "",
              documentPath,
              (sourcePath, href, nextSignal) => resolver(sourcePath, href, "image", nextSignal),
              signal,
            ).catch(() => null);
            if (signal.aborted || !isCurrent() || !element.isConnected) return;
            delete element.dataset.mdAssetSrcset;
            element.removeAttribute("aria-busy");
            if (!resolved) {
              // An unauthorized candidate must not shadow the <img> fallback.
              element.remove();
              return;
            }
            prepareBrokeredMarkdownImage(image, resolved);
            element.srcset = resolved;
            hasAuthorizedSource = true;
          }));
        } finally {
          releaseImage();
          finishOne();
        }
      });
    } else {
      releaseImage();
    }

    if (source) {
      tasks.push(async () => {
        try {
          await pictureSourcesReady;
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
          await pictureSourcesReady;
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

function getDeferredPictureSources(image: HTMLImageElement): HTMLSourceElement[] {
  const parent = image.parentElement;
  if (parent?.tagName !== "PICTURE") return [];
  return Array.from(parent.children).filter((child): child is HTMLSourceElement => (
    child.tagName === "SOURCE" && Boolean((child as HTMLElement).dataset.mdAssetSrcset)
  ));
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
