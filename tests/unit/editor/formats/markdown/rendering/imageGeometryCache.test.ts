import { describe, expect, it } from "vitest";
import { createImageGeometryCache, estimateMarkdownImageHeight } from "../../../../../../src/shared-ui/editor/markdown/features/image/imageGeometryCache";
const geometry = { naturalWidth: 1080, naturalHeight: 1620 };
describe("image geometry metadata", () => {
  it("keeps documents, sources and independent editor stores apart", () => {
    const cache = createImageGeometryCache();
    cache.remember("a.md", "x.svg", geometry);
    expect(cache.read("a.md", "x.svg")).toEqual(geometry);
    expect(cache.read("b.md", "x.svg")).toBeNull();
    expect(cache.read("a.md", "y.svg")).toBeNull();
    expect(createImageGeometryCache().read("a.md", "x.svg")).toBeNull();
  });
  it.each([0, -1, Infinity, NaN])("ignores invalid dimensions %s", bad => {
    const cache = createImageGeometryCache();
    cache.remember("a.md", "x.svg", { ...geometry, naturalWidth: bad });
    cache.remember("a.md", "y.svg", { ...geometry, naturalHeight: bad });
    expect(cache.read("a.md", "x.svg")).toBeNull();
    expect(cache.read("a.md", "y.svg")).toBeNull();
  });
  it("copies geometry and caps retained entries at 500", () => {
    const cache = createImageGeometryCache();
    const input = { ...geometry }; cache.remember("a.md", "x.svg", input); input.naturalWidth = 1;
    expect(cache.read("a.md", "x.svg")?.naturalWidth).toBe(1080);
    for (let i = 0; i < 501; i++) cache.remember("a.md", `${i}.svg`, geometry);
    expect(cache.read("a.md", "0.svg")).toBeNull();
    expect(cache.read("a.md", "500.svg")).toEqual(geometry);
    expect(cache.size).toBe(500);
  });
  it("forgets a failed image without losing other images and clears on disposal", () => {
    const cache = createImageGeometryCache();
    cache.remember("a.md", "x.svg", geometry); cache.remember("a.md", "y.svg", geometry);
    cache.forget("a.md", "x.svg"); expect(cache.read("a.md", "x.svg")).toBeNull();
    expect(cache.read("a.md", "y.svg")).toEqual(geometry);
    cache.clear(); expect(cache.size).toBe(0);
  });
});
it("derives estimates from each pane width without upscaling or losing explicit sizing", () => {
  expect(estimateMarkdownImageHeight(geometry, 724, "block", null)).toBe(1086);
  expect(estimateMarkdownImageHeight(geometry, 524, "block", null)).toBe(786);
  expect(estimateMarkdownImageHeight({ naturalWidth: 64, naturalHeight: 96 }, 724, "block", null)).toBe(96);
  expect(estimateMarkdownImageHeight(geometry, 724, "inline", null)).toBe(320);
  expect(estimateMarkdownImageHeight(geometry, 100, "block", { width: 200, height: null })).toBe(150);
  expect(estimateMarkdownImageHeight(geometry, 100, "block", { width: 200, height: 80 })).toBe(80);
  expect(estimateMarkdownImageHeight(geometry, 100, "block", { width: 200, height: 0 })).toBe(0);
  expect(estimateMarkdownImageHeight(null, 724, "block", null)).toBe(-1);
});
it("publishes real changes and preserves immutable geometry snapshots", () => {
  const cache = createImageGeometryCache(); const revisions: number[] = [];
  const unsubscribe = cache.subscribe(() => revisions.push(cache.revision));
  cache.remember("a.md", "x.svg", geometry); const snapshot = cache.snapshot();
  cache.remember("a.md", "x.svg", geometry);
  cache.remember("a.md", "x.svg", { naturalWidth: 1080, naturalHeight: 1080 });
  expect(snapshot.read("a.md", "x.svg")).toEqual(geometry);
  expect(cache.read("a.md", "x.svg")?.naturalHeight).toBe(1080);
  cache.forget("a.md", "x.svg"); expect(revisions).toEqual([1, 2, 3]);
  unsubscribe(); cache.remember("a.md", "y.svg", geometry); expect(revisions).toHaveLength(3);
});
