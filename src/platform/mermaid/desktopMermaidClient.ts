import { configureMermaidRenderTransport, getRendererPerformanceTracker } from "@puppyone/shared-ui";

/** The application composition root injects a native port into shared UI. */
export function startDesktopMermaidClient() {
  const api = window.puppyoneDesktop?.mermaid;
  if (!api) return;
  configureMermaidRenderTransport({ start(request) {
    const id = crypto.randomUUID();
    return {
      result: api.render({ id, ...request }).then((result) => {
        if (result.timings) {
          const tracker = getRendererPerformanceTracker();
          for (const name of ["engineMs", "fontMs", "renderMs", "queueMs", "hostMs"] as const) {
            const duration = result.timings[name];
            if (Number.isFinite(duration)) tracker.recordOperation(`mermaid_${name}`, duration);
          }
        }
        if (!result.ok || typeof result.svg !== "string") throw new Error(result.error || "Diagram renderer failed.");
        return result.svg;
      }),
      cancel: () => api.cancel(id),
    };
  } });
}
