/** @vitest-environment happy-dom */
import { afterEach, expect, it } from "vitest";
import { fileSplitDropEdge } from "../../../../../src/features/editor-workbench/drag-and-drop/fileSplitDropTarget";

afterEach(() => { document.body.innerHTML = ""; });
function surface() {
  const pane = document.createElement("section");
  pane.innerHTML = '<div data-file-split-targets><div data-file-split-edge="left"></div><div data-file-split-edge="right"></div><div data-file-split-edge="top"></div><div data-file-split-edge="bottom"></div></div>';
  document.body.append(pane);
  pane.querySelector<HTMLElement>('[data-file-split-edge="left"]')!.getBoundingClientRect = () => new DOMRect(12, 160, 120, 280);
  pane.querySelector<HTMLElement>('[data-file-split-edge="right"]')!.getBoundingClientRect = () => new DOMRect(668, 160, 120, 280);
  pane.querySelector<HTMLElement>('[data-file-split-edge="top"]')!.getBoundingClientRect = () => new DOMRect(260, 12, 280, 72);
  pane.querySelector<HTMLElement>('[data-file-split-edge="bottom"]')!.getBoundingClientRect = () => new DOMRect(260, 516, 280, 72);
  return pane;
}
it("hits precisely the visible left and right cards", () => {
  const pane = surface();
  expect(fileSplitDropEdge(pane, 12, 160)).toBe("left");
  expect(fileSplitDropEdge(pane, 787, 439)).toBe("right");
  for (const [x, y] of [[0, 300], [50, 159], [132, 300], [400, 300], [788, 300], [700, 440]]) {
    expect(fileSplitDropEdge(pane, x!, y!)).toBeNull();
  }
});
it("hits the visible top and bottom cards without creating invisible edge strips", () => {
  const pane = surface();
  expect(fileSplitDropEdge(pane, 260, 12)).toBe("top");
  expect(fileSplitDropEdge(pane, 539, 587)).toBe("bottom");
  for (const [x, y] of [[400, 0], [259, 40], [540, 40], [400, 84], [400, 515], [400, 588], [400, 300]]) {
    expect(fileSplitDropEdge(pane, x!, y!)).toBeNull();
  }
});
it("ignores hidden cards and authored content pretending to be a shell target", () => {
  const pane = surface();
  const overlay = pane.firstElementChild!;
  const content = document.createElement("div");
  pane.append(content);
  content.append(overlay);
  expect(fileSplitDropEdge(pane, 50, 300)).toBeNull();
  pane.append(overlay);
  overlay.firstElementChild!.getBoundingClientRect = () => new DOMRect(12, 160, 0, 0);
  expect(fileSplitDropEdge(pane, 12, 160)).toBeNull();
});
