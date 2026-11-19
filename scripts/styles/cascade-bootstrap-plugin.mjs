import { readFileSync } from "node:fs";

/** @returns {import("vite").Plugin} */
export function cascadeBootstrapPlugin() {
  return {
    name: "puppyone-style-cascade-bootstrap",
    transformIndexHtml: {
      order: "post",
      handler: () => [{
        tag: "style",
        attrs: { "data-po-style-cascade": "" },
        // Extracted feature CSS can precede the entry bundle. Register the
        // canonical order in HTML before any eager or lazy stylesheet.
        children: readFileSync(new URL("../../src/styles/cascade.css", import.meta.url), "utf8"),
        injectTo: "head-prepend",
      }],
    },
  };
}
