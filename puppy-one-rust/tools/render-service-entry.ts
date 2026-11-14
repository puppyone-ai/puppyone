// The native render service's hidden page (src/render_service): the
// product's own Mermaid and KaTeX draw a diagram or a formula into #stage,
// sized to its content, and the page reports that size; the native side then
// snapshots the drawing. Mermaid runs with the product's host-owned settings
// (src/platform/mermaid/host.ts) and its SVG goes through the product's
// sanitizer before it is shown; KaTeX takes the product's options
// (mathWidget.ts). Nothing here reaches the network.
import { render as renderKatex } from "katex";
import type { MermaidConfig } from "mermaid";
import { sanitizeMermaidSvg } from "./src/shared-ui/editor/markdown/features/mermaid/mermaidRenderer";

type Job =
  | { id: number; kind: "mermaid"; source: string; config: MermaidConfig; background: string }
  | { id: number; kind: "math"; source: string; display: boolean; color: string; fontSize: number;
      background: string };
type Reply =
  | { id: number; ok: true; width: number; height: number; baseline: number }
  | { id: number; ok: false; error: string };

declare global {
  interface Window {
    __puppyoneRender?: (job: Job) => void;
    ipc?: { postMessage: (message: string) => void };
  }
}

const MAX_SVG_BYTES = 4 * 1024 * 1024;
// `MERMAID_MAX_INTRINSIC_EDGE_PX`: the largest edge a diagram is drawn at.
const MAX_EDGE = 4096;
let engine: Promise<typeof import("mermaid")> | null = null;
let themeKey = "";
let sequence = 0;

const stage = document.getElementById("stage")!;
// Fonts load from this page's own bundle; a load that never settles must not
// hold a drawing back.
const fontsWithin = (pending: Promise<unknown>) =>
  Promise.race([pending, new Promise((resolve) => setTimeout(resolve, 2000))]);
const reply = (message: Reply) => window.ipc?.postMessage(JSON.stringify(message));
const measure = (id: number, element: HTMLElement) => {
  const box = element.getBoundingClientRect();
  // A zero-size inline box sits on the content's baseline.
  const strut = document.createElement("span");
  strut.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
  element.appendChild(strut);
  const baseline = strut.getBoundingClientRect().top - box.top;
  strut.remove();
  reply({ id, ok: true, width: Math.ceil(box.width), height: Math.ceil(box.height), baseline });
};

async function renderMermaid(job: Extract<Job, { kind: "mermaid" }>) {
  const { default: mermaid } = await (engine ??= import("mermaid"));
  const key = JSON.stringify(job.config);
  if (themeKey !== key) {
    mermaid.initialize({ ...job.config, startOnLoad: false, securityLevel: "strict",
      suppressErrorRendering: true, htmlLabels: false,
      secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "maxEdges", "htmlLabels", "suppressErrorRendering"],
      maxTextSize: 128 * 1024, maxEdges: 1000 });
    themeKey = key;
  }
  if (job.config.fontFamily) await fontsWithin(document.fonts.load(`16px ${job.config.fontFamily}`));
  await fontsWithin(document.fonts.ready);
  const { svg } = await mermaid.render(`mermaid-${++sequence}`, job.source);
  if (new TextEncoder().encode(svg).length > MAX_SVG_BYTES) throw new Error("Mermaid SVG exceeds the render limit.");
  const holder = document.createElement("div");
  holder.innerHTML = sanitizeMermaidSvg(svg);
  const element = holder.querySelector("svg");
  if (!element) throw new Error("Mermaid produced no diagram.");
  // `getMermaidSvgIntrinsicSize`: the viewBox, within the safety edge.
  const box = (element.getAttribute("viewBox") ?? "").trim().split(/[\s,]+/).map(Number.parseFloat);
  if (box.length === 4 && box[2] > 0 && box[3] > 0) {
    const scale = Math.min(1, MAX_EDGE / box[2], MAX_EDGE / box[3]);
    element.style.width = `${Math.round(box[2] * scale * 100) / 100}px`;
    element.style.height = `${Math.round(box[3] * scale * 100) / 100}px`;
    element.style.maxWidth = "none";
  }
  element.style.display = "block";
  stage.replaceChildren(element);
}

function renderMath(job: Extract<Job, { kind: "math" }>) {
  const holder = document.createElement(job.display ? "div" : "span");
  holder.style.color = job.color;
  holder.style.fontSize = `${job.fontSize}px`;
  renderKatex(job.source, holder, {
    displayMode: job.display,
    throwOnError: true,
    strict: false,
    trust: false,
    maxExpand: 1_000,
    maxSize: 500,
    output: "html",
  });
  // `.katex-display` keeps its own margin in the product's widget at 0.
  holder.querySelectorAll<HTMLElement>(".katex-display").forEach((node) => { node.style.margin = "0"; });
  stage.replaceChildren(holder);
}

window.__puppyoneRender = async (job) => {
  try {
    document.body.style.background = job.background;
    if (job.kind === "mermaid") await renderMermaid(job);
    else {
      await fontsWithin(document.fonts.ready);
      renderMath(job);
    }
    // A hidden page gets no animation frames: measuring lays the drawing
    // out, and the native snapshot paints it.
    measure(job.id, stage);
  } catch (error) {
    stage.replaceChildren();
    reply({ id: job.id, ok: false, error: error instanceof Error ? error.message.slice(0, 512) : "Unable to render." });
  }
};

// The native side sends nothing before this.
window.ipc?.postMessage(JSON.stringify({ ready: true }));
