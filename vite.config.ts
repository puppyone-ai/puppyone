import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";
import { rendererOutputLeasePlugin } from "./tooling/desktop/build/renderer-output-lease-plugin.mjs";
import { cascadeBootstrapPlugin } from "./tooling/styles/cascade-bootstrap-plugin.mjs";

const DESKTOP_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'none'",
  // `frame-ancestors` is ignored in a meta-delivered CSP. Electron main owns
  // top-level navigation/window creation, so do not advertise a false guard.
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: puppyone-local: puppyone-asset: http: https:",
  "font-src 'self' data: blob:",
  "media-src 'self' data: blob: puppyone-local: http: https:",
  "connect-src 'self' puppyone-local: http: https: ws: wss:",
  "worker-src 'self' blob:",
  "frame-src 'self' data: blob: puppyone-local: http: https:",
].join("; ");

const desktopContentSecurityPolicyPlugin: Plugin = {
  name: "puppyone-desktop-content-security-policy",
  apply: "build",
  transformIndexHtml: {
    order: "post",
    handler: () => ({
      tags: [{
        tag: "meta",
        attrs: {
          "http-equiv": "Content-Security-Policy",
          content: DESKTOP_CONTENT_SECURITY_POLICY,
        },
        injectTo: "head-prepend",
      }],
    }),
  },
};

export default defineConfig({
  base: "./",
  plugins: [rendererOutputLeasePlugin(), react(), cascadeBootstrapPlugin(), desktopContentSecurityPolicyPlugin],
  clearScreen: false,
  resolve: {
    alias: [
      {
        find: "@puppyone/localization",
        replacement: fileURLToPath(new URL("./packages/localization/src", import.meta.url)),
      },
      {
        find: "@puppyone/shared-ui/shared-ui.css",
        replacement: fileURLToPath(new URL("./packages/shared-ui/src/styles/shared-ui.css", import.meta.url)),
      },
      {
        find: "@puppyone/shared-ui/control-geometry.css",
        replacement: fileURLToPath(new URL("./packages/shared-ui/src/styles/control-geometry.css", import.meta.url)),
      },
      {
        find: "@puppyone/shared-ui/shared-ui-patterns.css",
        replacement: fileURLToPath(new URL("./packages/shared-ui/src/styles/shared-ui-patterns.css", import.meta.url)),
      },
      {
        find: "@puppyone/shared-ui/editor.css",
        replacement: fileURLToPath(new URL("./packages/shared-ui/src/styles/editor.css", import.meta.url)),
      },
      {
        find: "@puppyone/shared-ui/markdown-presentation-preview",
        replacement: fileURLToPath(new URL("./packages/shared-ui/src/editor/markdown/MarkdownPresentationPreview.tsx", import.meta.url)),
      },
      {
        find: "@puppyone/shared-ui",
        replacement: fileURLToPath(new URL("./packages/shared-ui/src/index.ts", import.meta.url)),
      },
      {
        find: "lucide-react",
        replacement: fileURLToPath(new URL("./node_modules/lucide-react/dist/esm/lucide-react.js", import.meta.url)),
      },
      {
        find: /^react\/jsx-dev-runtime$/,
        replacement: fileURLToPath(new URL("./node_modules/react/jsx-dev-runtime.js", import.meta.url)),
      },
      {
        find: /^react\/jsx-runtime$/,
        replacement: fileURLToPath(new URL("./node_modules/react/jsx-runtime.js", import.meta.url)),
      },
      {
        find: /^react$/,
        replacement: fileURLToPath(new URL("./node_modules/react/index.js", import.meta.url)),
      },
    ],
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: ["docx-preview"],
  },
  worker: {
    format: "es",
  },
  build: {
    rollupOptions: {
      input: {
        index: path.resolve(fileURLToPath(new URL(".", import.meta.url)), "index.html"),
      },
    },
  },
  server: {
    strictPort: true,
    port: 5173,
  },
  test: {
    exclude: ["archive/**", "node_modules/**", "dist/**", "release/**"],
  },
});
