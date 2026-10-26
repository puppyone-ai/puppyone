import { useEffect, useRef, useState } from "react";
import {
  ORDERED_DITHER_CELL_PX,
  ORDERED_DITHER_FPS,
  ORDERED_DITHER_LIGHT,
  buildOrderedDitherMask,
  createOrderedDitherLightField,
  paintOrderedDitherFrame,
  type OrderedDitherLight,
  type OrderedDitherShape,
} from "./orderedDitherField";

export interface OrderedDitherProps {
  /** Let the light spill onto the surface between shapes. Off for card surfaces. */
  halo?: boolean;
  /** Seconds added to the shared clock, to stagger sibling surfaces. */
  phase?: number;
  /**
   * A light for surfaces far smaller than a placeholder, such as the loading
   * mark. Pass a module constant: a new object restarts the renderer.
   */
  light?: Readonly<OrderedDitherLight>;
}

/**
 * Draws the placeholder shapes of its parent in the ordered-dither language
 * (orderedDitherField.ts). Consumers render it through PlaceholderLayer, as
 * the last child of a `po-placeholder-surface`; the shapes are that element's
 * `[data-placeholder-shape]` descendants, or the element itself. Shapes keep
 * their own layout and stay in the rounded style until the first frame is
 * painted, so environments without a 2D canvas keep a plain placeholder.
 */
export function OrderedDither({ halo = false, phase = 0, light: lightOverride }: OrderedDitherProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const surface = canvas?.parentElement;
    if (!canvas || !surface || typeof ResizeObserver === "undefined") return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const light: OrderedDitherLight = lightOverride
      ?? (halo ? ORDERED_DITHER_LIGHT : { ...ORDERED_DITHER_LIGHT, halo: 0 });
    const surfaceRenderer = createSurfaceRenderer(canvas, surface, context, light, phase);
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const still = () => Boolean(motion?.matches);
    const resizeObserver = new ResizeObserver(() => {
      surfaceRenderer.layout();
      surfaceRenderer.draw(clockTime(), still());
    });
    resizeObserver.observe(surface);
    surfaceRenderer.layout();
    surfaceRenderer.draw(clockTime(), still());
    setReady(true);
    const animate = () => (still() ? unsubscribe(surfaceRenderer) : subscribe(surfaceRenderer));
    animate();
    motion?.addEventListener?.("change", animate);
    return () => {
      motion?.removeEventListener?.("change", animate);
      resizeObserver.disconnect();
      unsubscribe(surfaceRenderer);
    };
  }, [halo, phase, lightOverride]);

  return (
    <canvas
      ref={canvasRef}
      className="po-dither-canvas"
      data-ready={ready ? "" : undefined}
      aria-hidden="true"
    />
  );
}

interface SurfaceRenderer {
  layout(): void;
  draw(time: number, still?: boolean): void;
}

function createSurfaceRenderer(
  canvas: HTMLCanvasElement,
  surface: HTMLElement,
  context: CanvasRenderingContext2D,
  light: OrderedDitherLight,
  phase: number,
): SurfaceRenderer {
  const lattice = document.createElement("canvas");
  const latticeContext = lattice.getContext("2d");
  let cols = 0;
  let rows = 0;
  let cell = ORDERED_DITHER_CELL_PX;
  let mask: Uint8Array = new Uint8Array(0);
  let image: ImageData | null = null;
  let scale = 1;
  let lightField = createOrderedDitherLightField(0, 0, light);

  return {
    layout() {
      // Layout size, not the transformed box: the surface may be mid-animation.
      const width = canvas.offsetWidth;
      const height = canvas.offsetHeight;
      const ratio = window.devicePixelRatio || 1;
      cell = readCellSize(canvas);
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      scale = canvas.width / Math.max(1, width);
      cols = Math.max(1, Math.ceil(width / cell));
      rows = Math.max(1, Math.ceil(height / cell));
      lattice.width = cols;
      lattice.height = rows;
      image = latticeContext?.createImageData(cols, rows) ?? null;
      mask = buildOrderedDitherMask(cols, rows, measureShapes(surface, canvas, cell));
      lightField = createOrderedDitherLightField(cols, rows, light);
    },
    draw(time, still = false) {
      if (!image || !latticeContext || !canvas.isConnected) return;
      const ink = resolveInk(getComputedStyle(canvas).color);
      paintOrderedDitherFrame(image.data, {
        cols,
        rows,
        mask,
        ink,
        light,
        lightAt: still ? null : lightField(time + phase),
      });
      latticeContext.putImageData(image, 0, 0);
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(lattice, 0, 0, cols * cell * scale, rows * cell * scale);
    },
  };
}

function readCellSize(canvas: HTMLCanvasElement) {
  const value = Number.parseFloat(getComputedStyle(canvas).getPropertyValue("--po-dither-cell"));
  return Number.isFinite(value) && value > 0 ? value : ORDERED_DITHER_CELL_PX;
}

/**
 * Shapes in cell space, relative to the canvas. Client rects are divided by the
 * canvas's transform scale so a surface measured mid-animation still lands on
 * its layout lattice. A bordered shape (a slide frame) is measured inside its border.
 */
function measureShapes(surface: HTMLElement, canvas: HTMLCanvasElement, cell: number): OrderedDitherShape[] {
  const bounds = canvas.getBoundingClientRect();
  const scaleX = bounds.width / Math.max(1, canvas.offsetWidth) || 1;
  const scaleY = bounds.height / Math.max(1, canvas.offsetHeight) || 1;
  const elements = [
    ...(surface.matches("[data-placeholder-shape]") ? [surface] : []),
    ...surface.querySelectorAll<HTMLElement>("[data-placeholder-shape]"),
  ];
  return elements.map((element) => {
    const rect = element.getBoundingClientRect();
    const left = (rect.left - bounds.left) / scaleX + element.clientLeft;
    const top = (rect.top - bounds.top) / scaleY + element.clientTop;
    const width = element.clientWidth || rect.width / scaleX;
    const height = element.clientHeight || rect.height / scaleY;
    const x = Math.round(left / cell);
    const y = Math.round(top / cell);
    const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
    return {
      x,
      y,
      width: Math.max(0, Math.round((left + width) / cell) - x),
      height: Math.max(0, Math.round((top + height) / cell) - y),
      radius: radius / cell,
    };
  });
}

let inkProbe: CanvasRenderingContext2D | null = null;
const inkCache = new Map<string, [number, number, number, number]>();

/** Resolves any computed CSS colour (including relative and color() forms) to RGBA bytes. */
function resolveInk(color: string): [number, number, number, number] {
  const cached = inkCache.get(color);
  if (cached) return cached;
  inkProbe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  let ink: [number, number, number, number] = [128, 128, 128, 64];
  if (inkProbe) {
    inkProbe.canvas.width = 1;
    inkProbe.canvas.height = 1;
    inkProbe.clearRect(0, 0, 1, 1);
    inkProbe.fillStyle = color;
    inkProbe.fillRect(0, 0, 1, 1);
    const [red, green, blue, alpha] = inkProbe.getImageData(0, 0, 1, 1).data;
    ink = [red, green, blue, alpha];
  }
  inkCache.set(color, ink);
  return ink;
}

/* One clock for every surface, so all placeholders in the window share a rhythm. */
const renderers = new Set<SurfaceRenderer>();
let frameRequest = 0;
let lastStep = -1;

function clockTime() {
  return performance.now() / 1000;
}

function subscribe(renderer: SurfaceRenderer) {
  renderers.add(renderer);
  if (!frameRequest) frameRequest = requestAnimationFrame(tick);
}

function unsubscribe(renderer: SurfaceRenderer) {
  renderers.delete(renderer);
  if (renderers.size === 0 && frameRequest) {
    cancelAnimationFrame(frameRequest);
    frameRequest = 0;
  }
}

function tick() {
  frameRequest = 0;
  const step = Math.floor(clockTime() * ORDERED_DITHER_FPS);
  if (step !== lastStep) {
    lastStep = step;
    for (const renderer of renderers) renderer.draw(step / ORDERED_DITHER_FPS);
  }
  if (renderers.size > 0) frameRequest = requestAnimationFrame(tick);
}
