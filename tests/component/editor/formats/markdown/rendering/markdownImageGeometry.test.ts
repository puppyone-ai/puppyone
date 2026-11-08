/** @vitest-environment happy-dom */
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, expect, it, vi } from "vitest";
import { markdownLivePreviewContextExtension } from "../../../../../../src/shared-ui/editor/markdown/core/editor/markdownLivePreviewContext";
import { ImagePreviewWidget } from "../../../../../../src/shared-ui/editor/markdown/features/image/imagePreviewWidget";
import { getImageGeometryCache, imageGeometryExtension, imageGeometryPresentationEffect } from "../../../../../../src/shared-ui/editor/markdown/features/image/imageGeometrySession";
import { markdownCodeMirrorBaseExtensions, markdownLivePreviewExtension } from "../../../../../../src/shared-ui/editor/markdown/markdownCodeMirrorExtensions";
import { markdownLivePreviewDecorations, requestMarkdownProjectionRange } from "../../../../../../src/shared-ui/editor/markdown/core/projection/markdownDocumentProjection";
import { disposeMarkdownEmbedHost, getMarkdownEmbedHost } from "../../../../../../src/shared-ui/editor/markdown/platform/codemirror/embedHost";
import * as layout from "../../../../../../src/shared-ui/editor/runtime/editorLayout";
const views: EditorView[] = [];
const mounts: { widget: ImagePreviewWidget; wrapper: HTMLElement }[] = [];
afterEach(() => { for (const { widget, wrapper } of mounts) { widget.destroy(wrapper); wrapper.remove(); } mounts.length = 0; for (const view of views) { view.destroy(); disposeMarkdownEmbedHost(view); } views.length = 0; document.body.replaceChildren(); vi.restoreAllMocks(); });
async function until(check: () => boolean) { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(r => setTimeout(r, 1)); } throw Error("Image did not settle"); }
function harness(resolver: Parameters<typeof markdownLivePreviewContextExtension>[3] = async () => "blob:https://app/image") {
  const context = new Compartment();
  const parent = document.createElement("div"); document.body.append(parent);
  const view = new EditorView({ parent, state: EditorState.create({ doc: "![photo](photo.svg)", extensions: [context.of(markdownLivePreviewContextExtension("safe", null, "note.md", resolver)), imageGeometryExtension] }) }); views.push(view);
  const mount = (size: { width: number; height: number | null } | null = null) => { const widget = new ImagePreviewWidget(0, 19, "photo", "photo.svg", null, "note.md", "photo.svg", "block", size); const wrapper = widget.toDOM(view); document.body.append(wrapper); mounts.push({ widget, wrapper }); return wrapper; };
  return { view, context, mount, cache: getImageGeometryCache(view) };
}
it("reserves successful intrinsic geometry during a later mount, without an asset URL cache", async () => {
  const h = harness(); const first = h.mount(); await until(() => !!first.querySelector("img"));
  const img = first.querySelector("img")!; Object.defineProperties(img, { naturalWidth: { value: 1080 }, naturalHeight: { value: 1620 } });
  img.decode = vi.fn(async () => {}); img.dispatchEvent(new Event("load")); await until(() => img.dataset.previewState === "ready");
  expect(h.cache.read("note.md", "photo.svg")).toEqual({ naturalWidth: 1080, naturalHeight: 1620 });
  const second = h.mount(); const placeholder = second.querySelector<HTMLElement>(".is-loading")!;
  expect(placeholder.style.aspectRatio).toBe("1080 / 1620");
  expect(placeholder.style.width).toContain("1080px");
  expect(placeholder.style.minHeight).toBe("0px");
});
it("does not reserve a stale large box when admission fails", async () => {
  const h = harness(async () => null); h.cache.remember("note.md", "photo.svg", { naturalWidth: 1080, naturalHeight: 1620 });
  const wrapper = h.mount(); await until(() => !wrapper.querySelector(".is-loading"));
  expect(h.cache.read("note.md", "photo.svg")).toBeNull();
  expect(wrapper.style.minHeight).toBe(""); expect(wrapper.querySelector<HTMLElement>("span")?.style.aspectRatio).toBe("");
});
it("discards geometry on a decode error, document replacement and view disposal", async () => {
  const h = harness(); h.cache.remember("note.md", "photo.svg", { naturalWidth: 1080, naturalHeight: 1620 });
  const wrapper = h.mount(); await until(() => !!wrapper.querySelector("img")); wrapper.querySelector("img")!.dispatchEvent(new Event("error"));
  expect(h.cache.read("note.md", "photo.svg")).toBeNull();
  h.cache.remember("note.md", "photo.svg", { naturalWidth: 1080, naturalHeight: 1620 });
  h.view.dispatch({ effects: h.context.reconfigure(markdownLivePreviewContextExtension("safe", null, "other.md", async () => null)) });
  expect(h.cache.size).toBe(0);
  const current = getImageGeometryCache(h.view);
  current.remember("other.md", "photo.svg", { naturalWidth: 1080, naturalHeight: 1620 }); h.view.destroy();
  expect(current.size).toBe(0); views.splice(views.indexOf(h.view), 1); disposeMarkdownEmbedHost(h.view);
});
it("isolates simultaneous editor stores even for the same document and source", () => {
  const a = harness(), b = harness(); a.cache.remember("note.md", "photo.svg", { naturalWidth: 1080, naturalHeight: 1620 });
  expect(b.cache.read("note.md", "photo.svg")).toBeNull();
});
it("does not restore a reading anchor when decoding preserves the reserved box", async () => {
  const h = harness(); h.cache.remember("note.md", "photo.svg", { naturalWidth: 1080, naturalHeight: 1620 });
  const wrapper = h.mount(); await until(() => !!wrapper.querySelector("img"));
  const image = wrapper.querySelector("img")!;
  Object.defineProperties(image, { naturalWidth: { value: 1080 }, naturalHeight: { value: 1620 } });
  image.decode = vi.fn(async () => {});
  const commit = vi.spyOn(layout, "commitEditorLayout");
  image.dispatchEvent(new Event("load")); await until(() => image.dataset.previewState === "ready");
  expect(commit).not.toHaveBeenCalled();
});
it("does not register a fresh resize observation for an already reserved image box", () => {
  const h = harness(); h.cache.remember("note.md", "photo.svg", { naturalWidth: 1080, naturalHeight: 1620 });
  const observe = vi.spyOn(getMarkdownEmbedHost(h.view).layout, "observe"); h.mount();
  expect(observe).not.toHaveBeenCalled();
});
it("compares a decoded image with its own placeholder even if a sibling refreshed the cache", async () => {
  const h = harness(); h.cache.remember("note.md", "photo.svg", { naturalWidth: 1080, naturalHeight: 1620 });
  const wrapper = h.mount(); await until(() => !!wrapper.querySelector("img"));
  h.cache.remember("note.md", "photo.svg", { naturalWidth: 2160, naturalHeight: 1620 });
  const image = wrapper.querySelector("img")!; Object.defineProperties(image, { naturalWidth: { value: 2160 }, naturalHeight: { value: 1620 } });
  image.decode = vi.fn(async () => {}); const commit = vi.spyOn(layout, "commitEditorLayout");
  image.dispatchEvent(new Event("load")); await until(() => image.dataset.previewState === "ready");
  expect(commit).toHaveBeenCalledOnce();
});
it("reserves an explicit zero height consistently with the decoded image", () => {
  const h = harness(); h.cache.remember("note.md", "photo.svg", { naturalWidth: 1080, naturalHeight: 1620 });
  expect(h.mount({ width: 100, height: 0 }).querySelector<HTMLElement>(".is-loading")?.style.height).toBe("0px");
});
it("clears reserved geometry when decoding rejects", async () => {
  const h = harness(); h.cache.remember("note.md", "photo.svg", { naturalWidth: 1080, naturalHeight: 1620 });
  const wrapper = h.mount(); await until(() => !!wrapper.querySelector("img"));
  const image = wrapper.querySelector("img")!; Object.defineProperties(image, { naturalWidth: { value: 1080 }, naturalHeight: { value: 1620 } });
  image.decode = vi.fn(async () => { throw Error("decode failed"); }); image.dispatchEvent(new Event("load"));
  await until(() => !wrapper.querySelector(".is-loading"));
  expect(wrapper.querySelector("img")).toBeNull(); expect(h.cache.read("note.md", "photo.svg")).toBeNull();
});
it("updates offscreen estimates through projection without reloading a decoded image", async () => {
  const revoke = vi.fn(); const resolver = vi.fn(async () => ({ url: "blob:https://app/estimated", revoke }));
  const h = harness(resolver); h.cache.remember("note.md", "photo.svg", { naturalWidth: 1080, naturalHeight: 1620 });
  let state = EditorState.create({ doc: "![photo](photo.svg)", extensions: [...markdownCodeMirrorBaseExtensions(true), markdownLivePreviewExtension("safe", null, "note.md", resolver)] });
  const project = (width: number) => {
    state = state.update({ effects: [imageGeometryPresentationEffect.of({ width, cache: h.cache }), requestMarkdownProjectionRange(state, 0, state.doc.length, "layout")] }).state;
    const widgets: ImagePreviewWidget[] = [];
    state.field(markdownLivePreviewDecorations).decorations.between(0, state.doc.length, (_from, _to, decoration) => {
      if (decoration.spec.widget instanceof ImagePreviewWidget) widgets.push(decoration.spec.widget);
    });
    return widgets[0];
  };
  const first = project(724); expect(first.estimatedHeight).toBe(1086);
  const wrapper = first.toDOM(h.view); document.body.append(wrapper); mounts.push({ widget: first, wrapper });
  await until(() => !!wrapper.querySelector("img")); const image = wrapper.querySelector("img")!;
  const second = project(524); expect(second.estimatedHeight).toBe(786);
  expect(second.eq(first)).toBe(false); expect(second.updateDOM(wrapper)).toBe(true);
  expect(wrapper.querySelector("img")).toBe(image); expect(resolver).toHaveBeenCalledOnce(); expect(revoke).not.toHaveBeenCalled();
  h.cache.forget("note.md", "photo.svg"); expect(project(524).estimatedHeight).toBe(-1);
});
it("maps the source end of a block image to its bottom, including a last image without a newline", () => {
  const h = harness(); const wrapper = h.mount(); const widget = mounts.at(-1)!.widget;
  const line = document.createElement("div"); line.className = "cm-line"; line.style.lineHeight = "24px"; line.style.paddingTop = "20px";
  document.body.append(line); line.append(wrapper);
  line.getBoundingClientRect = () => new DOMRect(40, 180, 200, 920);
  wrapper.getBoundingClientRect = () => new DOMRect(40, 200, 200, 900);
  expect(widget.coordsAt(wrapper, 0, 1)).toMatchObject({ top: 200, bottom: 224 });
  expect(widget.coordsAt(wrapper, 19, 1)).toMatchObject({ top: 1076, bottom: 1100 });
});
