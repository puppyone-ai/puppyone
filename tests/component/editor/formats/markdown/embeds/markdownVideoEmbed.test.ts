/**
 * @vitest-environment happy-dom
 */
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getMarkdownPlanIndex } from "../../../../../../packages/shared-ui/src/editor/markdown/core/plans/markdownPlanIndex";
import {
  puppyMarkdownFeatureCompositionExtension,
  puppyMarkdownParserExtensions,
} from "../../../../../../packages/shared-ui/src/editor/markdown/composition/markdownFeatureComposition";
import {
  markdownCodeMirrorBaseExtensions,
  markdownLivePreviewExtension,
} from "../../../../../../packages/shared-ui/src/editor/markdown/markdownCodeMirrorExtensions";
import { disposeMarkdownEmbedHost } from "../../../../../../packages/shared-ui/src/editor/markdown/platform/codemirror/embedHost";
import { createSanitizedBlockHtmlFragment } from "../../../../../../packages/shared-ui/src/editor/markdown/features/html/sanitizeHtml";
import type { MarkdownLinkGraph } from "../../../../../../packages/shared-ui/src/editor/registry/viewerTypes";

const views = new Set<EditorView>();

afterEach(() => {
  for (const view of views) {
    view.destroy();
    disposeMarkdownEmbedHost(view);
  }
  views.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("Markdown video embeds", () => {
  it("compiles a full-line Obsidian video embed into a typed block atom", () => {
    const source = "![[media/demo.mp4|720x405]]";
    const state = EditorState.create({
      doc: source,
      extensions: [
        puppyMarkdownFeatureCompositionExtension,
        markdown({ base: markdownLanguage, extensions: puppyMarkdownParserExtensions }),
      ],
    });

    const plan = getMarkdownPlanIndex(state).find(({ plan: candidate }) => (
      candidate.presentation === "blockAtom" && candidate.embed.kind === "video"
    ))?.plan;

    expect(plan?.presentation).toBe("blockAtom");
    if (plan?.presentation === "blockAtom" && plan.embed.kind === "video") {
      expect(plan.embed.model).toMatchObject({
        sources: [{ href: "media/demo.mp4", type: null, referenceKind: "wiki-target" }],
        width: 720,
        height: 405,
        preload: "metadata",
        playsInline: true,
      });
      expect(plan.execution.mode).not.toBe("visibleSource");
      expect(plan.layout.estimatedHeight).toBe(405);
    }
  });

  it("keeps a video embed visible as source when it does not own the line", () => {
    const state = EditorState.create({
      doc: "Watch ![[media/demo.mp4]] now",
      extensions: [
        puppyMarkdownFeatureCompositionExtension,
        markdown({ base: markdownLanguage, extensions: puppyMarkdownParserExtensions }),
      ],
    });

    const plans = getMarkdownPlanIndex(state);
    expect(plans.some(({ plan }) => (
      plan.presentation === "blockAtom" && plan.embed.kind === "video"
    ))).toBe(false);
    expect(plans.some(({ element }) => element.kind === "wikiLink")).toBe(false);
  });

  it("preserves one mounted playback session across unrelated document edits", async () => {
    const source = "Intro\n![[demo.mp4|Demo]]\nTail";
    const revoke = vi.fn();
    const resolveAssetUrl = vi.fn(async () => ({
      url: "blob:https://app/stable-video",
      revoke,
    }));
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: source,
        extensions: [
          ...markdownCodeMirrorBaseExtensions(false),
          markdownLivePreviewExtension(
            "safe",
            createLinkGraph("media/demo.mp4"),
            "notes/note.md",
            resolveAssetUrl,
            "workspace:test",
            "/workspace",
          ),
        ],
      }),
    });
    views.add(view);

    await waitFor(() => view.dom.querySelector(".cm-md-video-widget source") !== null);
    const wrapperBefore = view.dom.querySelector<HTMLElement>(".cm-md-video-widget");
    const videoBefore = wrapperBefore?.querySelector<HTMLVideoElement>("video");
    const sourceBefore = videoBefore?.querySelector<HTMLSourceElement>("source");
    if (!wrapperBefore || !videoBefore || !sourceBefore) {
      throw new Error("Markdown video widget did not mount.");
    }

    expect(resolveAssetUrl).toHaveBeenCalledTimes(1);
    expect(resolveAssetUrl).toHaveBeenCalledWith(
      "notes/note.md",
      "/media/demo.mp4",
      expect.any(AbortSignal),
    );
    expect(sourceBefore.getAttribute("src")).toBe("blob:https://app/stable-video");
    expect(videoBefore.controls).toBe(true);
    expect(videoBefore.autoplay).toBe(false);
    expect(videoBefore.preload).toBe("metadata");
    expect(videoBefore.hidden).toBe(true);

    videoBefore.dispatchEvent(new Event("loadedmetadata"));
    expect(videoBefore.hidden).toBe(false);
    expect(wrapperBefore.dataset.previewState).toBe("ready");
    videoBefore.currentTime = 12;

    view.dispatch({ changes: { from: 5, insert: " updated" } });
    await waitFor(() => view.dom.querySelector(".cm-md-video-widget") !== null);

    const wrapperAfter = view.dom.querySelector<HTMLElement>(".cm-md-video-widget");
    const videoAfter = wrapperAfter?.querySelector<HTMLVideoElement>("video");
    expect(wrapperAfter).toBe(wrapperBefore);
    expect(videoAfter).toBe(videoBefore);
    expect(videoAfter?.currentTime).toBe(12);
    expect(resolveAssetUrl).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled();

    view.destroy();
    disposeMarkdownEmbedHost(view);
    views.delete(view);
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it("sanitizes raw HTML video into inert broker placeholders", () => {
    const result = createSanitizedBlockHtmlFragment(
      '<video autoplay preload="auto" src="assets/demo.mp4" poster="assets/poster.png">'
        + '<source src="assets/fallback.webm" type="video/webm">'
        + "</video>",
      { deferredMedia: true },
    );

    expect(result.supported).toBe(true);
    const video = result.fragment.querySelector<HTMLVideoElement>("video");
    const source = video?.querySelector<HTMLSourceElement>("source");
    expect(video?.controls).toBe(true);
    expect(video?.autoplay).toBe(false);
    expect(video?.getAttribute("preload")).toBe("metadata");
    expect(video?.hasAttribute("src")).toBe(false);
    expect(video?.dataset.mdAssetSrc).toBe("assets/demo.mp4");
    expect(video?.hasAttribute("poster")).toBe(false);
    expect(video?.dataset.mdAssetPoster).toBe("assets/poster.png");
    expect(source?.hasAttribute("src")).toBe(false);
    expect(source?.dataset.mdAssetSrc).toBe("assets/fallback.webm");
    expect(source?.type).toBe("video/webm");
  });

  it("hydrates a standalone single-line HTML video through the typed broker path", async () => {
    const source = '<video autoplay src="assets/demo.mp4" poster="assets/poster.png"><source src="assets/fallback.webm" type="video/webm"></video>';
    const resolveAssetUrl = vi.fn(async (_documentPath: string, href: string) => (
      `blob:https://app/${href.split("/").at(-1)}`
    ));
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: source,
        extensions: [
          ...markdownCodeMirrorBaseExtensions(false),
          markdownLivePreviewExtension(
            "safe",
            null,
            "notes/note.md",
            resolveAssetUrl,
            "workspace:test",
            "/workspace",
          ),
        ],
      }),
    });
    views.add(view);

    await waitFor(() => (
      view.dom.querySelector(".cm-md-html-rendered-surface video")?.getAttribute("poster")
      === "blob:https://app/poster.png"
    ));
    const video = view.dom.querySelector<HTMLVideoElement>(".cm-md-html-rendered-surface video");
    const childSource = video?.querySelector<HTMLSourceElement>("source");
    if (!video || !childSource) throw new Error("Raw HTML video surface did not mount.");

    expect(resolveAssetUrl.mock.calls.map(([, href]) => href).sort()).toEqual([
      "assets/demo.mp4",
      "assets/fallback.webm",
      "assets/poster.png",
    ]);
    expect(video.controls).toBe(true);
    expect(video.autoplay).toBe(false);
    expect(video.preload).toBe("metadata");
    expect(video.getAttribute("src")).toBe("blob:https://app/demo.mp4");
    expect(video.getAttribute("poster")).toBe("blob:https://app/poster.png");
    expect(childSource.getAttribute("src")).toBe("blob:https://app/fallback.webm");
  });
});

function createLinkGraph(resolvedPath: string): MarkdownLinkGraph {
  return {
    revision: 1,
    documentCount: 1,
    indexedDocumentCount: 1,
    resolveWikiLink: (_sourcePath, target) => ({
      exists: true,
      ambiguous: false,
      path: resolvedPath,
      name: target,
      displayName: target,
      target,
    }),
    resolveMarkdownLink: () => null,
  };
}

async function waitFor(assertion: () => boolean, attempts = 100): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (assertion()) return;
    await new Promise((resolve) => window.setTimeout(resolve, 2));
  }
  throw new Error("Timed out waiting for Markdown video state.");
}
