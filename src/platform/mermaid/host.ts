import "../../styles/typography/foundations.css";
import type { MermaidConfig } from "mermaid";

type Request = { id: string; source: string; config: MermaidConfig };
const bridge = (window as unknown as { mermaidHost: {
  onRender: (callback: (request: Request) => void) => void;
  complete: (result: unknown) => void;
} }).mermaidHost;
let engine: Promise<typeof import("mermaid")> | null = null;
let themeKey = "";
let sequence = 0;
bridge.onRender(async ({ id, source, config }) => {
  try {
    const startedAt = performance.now();
    const { default: mermaid } = await (engine ??= import("mermaid"));
    const engineReadyAt = performance.now();
    const key = JSON.stringify(config);
    if (themeKey !== key) {
      mermaid.initialize({ ...config, startOnLoad: false, securityLevel: "strict",
        suppressErrorRendering: true, htmlLabels: false,
        // Diagram directives cannot weaken these host-owned settings.
        secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "maxEdges", "htmlLabels", "suppressErrorRendering"],
        maxTextSize: 128 * 1024, maxEdges: 1000 });
      themeKey = key;
    }
    if (config.fontFamily) await document.fonts.load(`16px ${config.fontFamily}`);
    await document.fonts.ready;
    const layoutStartedAt = performance.now();
    // render already parses. No separate parse pass on the rendering path.
    const { svg } = await mermaid.render(`mermaid-${++sequence}`, source);
    if (new TextEncoder().encode(svg).length > 4 * 1024 * 1024) throw new Error("Mermaid SVG exceeds the render limit.");
    bridge.complete({ id, ok: true, svg, timings: {
      engineMs: engineReadyAt - startedAt, fontMs: layoutStartedAt - engineReadyAt,
      renderMs: performance.now() - layoutStartedAt,
    } });
  } catch (error) {
    bridge.complete({ id, ok: false, error: error instanceof Error ? error.message.slice(0, 512) : "Unable to render diagram." });
  }
});
