/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  LoadingPlaceholderStyleProvider,
  PlaceholderLayer,
  type LoadingPlaceholderStyle,
} from "../../../../packages/shared-ui/src/primitives/LoadingPlaceholder";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function renderSurface(style?: LoadingPlaceholderStyle) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const surface = (
    <div className="po-placeholder-surface" data-testid="surface">
      <span data-placeholder-shape="" />
      <span data-placeholder-shape="" />
      <PlaceholderLayer halo />
    </div>
  );
  act(() => root!.render(style ? <LoadingPlaceholderStyleProvider style={style}>{surface}</LoadingPlaceholderStyleProvider> : surface));
  return host.querySelector<HTMLElement>('[data-testid="surface"]')!;
}

describe("loading placeholder layer", () => {
  it("adds nothing in the rounded style, which is also the default", () => {
    expect(renderSurface().querySelector("canvas")).toBeNull();
    act(() => root?.unmount());
    expect(renderSurface("rounded").querySelector("canvas")).toBeNull();
  });

  it("mounts the ordered-dither canvas as the surface's last child in the dither style", () => {
    const surface = renderSurface("dither");
    const canvas = surface.lastElementChild;
    expect(canvas?.tagName).toBe("CANVAS");
    expect(canvas?.classList.contains("po-dither-canvas")).toBe(true);
    expect(canvas?.getAttribute("aria-hidden")).toBe("true");
    expect(surface.querySelectorAll("[data-placeholder-shape]")).toHaveLength(2);
  });

  it("keeps the rounded shapes until a frame is painted, so canvas-less hosts still show placeholders", () => {
    const canvas = renderSurface("dither").querySelector("canvas")!;
    // happy-dom has no 2D context: the layer never claims the shapes.
    expect(canvas.hasAttribute("data-ready")).toBe(false);
  });
});
