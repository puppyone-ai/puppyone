import type { Plugin } from "vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import autoprefixer from "autoprefixer";
import { fileURLToPath, URL } from "node:url";
import path from "node:path";
import { rendererOutputLeasePlugin } from "./scripts/desktop/build/renderer-output-lease-plugin.mjs";
import { cascadeBootstrapPlugin } from "./scripts/styles/cascade-bootstrap-plugin.mjs";
import { cloudConfigurationPlugin } from "./scripts/desktop/build/cloud-configuration-plugin.mjs";

const DESKTOP_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'none'",
  // `frame-ancestors` is ignored in a meta-delivered CSP. Electron main owns
  // top-level navigation/window creation, so do not advertise a false guard.
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: puppyone-local: puppyone-asset: http: https:",
  "font-src 'self' data: blob:",
  "media-src 'self' data: blob: puppyone-local: http: https:",
  "connect-src 'self' blob: puppyone-local: http: https: ws: wss:",
  "worker-src 'self' blob:",
  "frame-src 'self' data: blob: puppyone-local: puppyone-preview: http: https:",
].join("; ");

const desktopContentSecurityPolicyPlugin: Plugin = {
  name: "puppyone-desktop-content-security-policy",
  apply: "build",
  transformIndexHtml: {
    order: "post",
    handler: () => [{
        tag: "meta",
        attrs: {
          "http-equiv": "Content-Security-Policy",
          content: DESKTOP_CONTENT_SECURITY_POLICY,
        },
        injectTo: "head-prepend",
      }],
  },
};

export default defineConfig({
  base: "./",
  plugins: [rendererOutputLeasePlugin(), cloudConfigurationPlugin(), react(), cascadeBootstrapPlugin(), desktopContentSecurityPolicyPlugin],
  clearScreen: false,
  css: { postcss: { plugins: [autoprefixer()] } },
  resolve: {
    alias: [
      {
        find: "@puppyone/localization",
        replacement: fileURLToPath(new URL("./src/lib/localization", import.meta.url)),
      },
      {
        find: "@puppyone/shared-ui/shared-ui.css",
        replacement: fileURLToPath(new URL("./src/shared-ui/styles/shared-ui.css", import.meta.url)),
      },
      {
        find: "@puppyone/shared-ui/control-geometry.css",
        replacement: fileURLToPath(new URL("./src/shared-ui/styles/control-geometry.css", import.meta.url)),
      },
      {
        find: "@puppyone/shared-ui/shared-ui-patterns.css",
        replacement: fileURLToPath(new URL("./src/shared-ui/styles/shared-ui-patterns.css", import.meta.url)),
      },
      {
        find: "@puppyone/shared-ui/editor.css",
        replacement: fileURLToPath(new URL("./src/shared-ui/styles/editor.css", import.meta.url)),
      },
      {
        find: "@puppyone/shared-ui/markdown-presentation-preview",
        replacement: fileURLToPath(new URL("./src/shared-ui/editor/markdown/MarkdownPresentationPreview.tsx", import.meta.url)),
      },
      {
        find: "@puppyone/shared-ui",
        replacement: fileURLToPath(new URL("./src/shared-ui/index.ts", import.meta.url)),
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
    include: ["docx-preview", "mammoth/mammoth.browser", "pdfjs-dist/build/pdf.mjs", "pdfjs-dist/build/pdf.worker.mjs"],
  },
  worker: {
    format: "es",
  },
  build: {
    rollupOptions: {
      input: {
        index: path.resolve(fileURLToPath(new URL("./", import.meta.url)), "index.html"),
        mermaid: path.resolve(fileURLToPath(new URL("./", import.meta.url)), "src/platform/mermaid/host.html"),
      },
    },
  },
  server: {
    strictPort: true,
    port: 5173,
  },
});
