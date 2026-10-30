// Builds the website demo (website-demo.html) on its own, as static files in
// dist-website-demo/: the real renderer over an in-memory folder, embedded by
// the puppyone website's homepage. `npm run build:website-demo`.
import { fileURLToPath, URL } from "node:url";
import type { Plugin } from "vite";
import baseConfig from "./vite.config";

// Main's Agent actor imports randomUUID from node:crypto; the browser has its own.
const alias = [
  { find: /^node:crypto$/, replacement: fileURLToPath(new URL("./src/website-demo/shims/node-crypto.ts", import.meta.url)) },
  ...((baseConfig.resolve?.alias as unknown[]) ?? []),
];

// The desktop CSP assumes previews come from Electron's preview protocol. In
// the browser demo, HTML previews are blob: documents that inherit this
// page's policy, so the desktop policy would block the preview bridge script.
// Allow inline scripts here; each preview still applies its own nonce policy.
const DEMO_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "connect-src 'self' blob:",
  "worker-src 'self' blob:",
  "frame-src 'self' data: blob:",
].join("; ");

const demoContentSecurityPolicyPlugin: Plugin = {
  name: "puppyone-website-demo-content-security-policy",
  apply: "build",
  transformIndexHtml: {
    order: "post",
    handler: () => [{
      tag: "meta",
      attrs: { "http-equiv": "Content-Security-Policy", content: DEMO_CONTENT_SECURITY_POLICY },
      injectTo: "head-prepend",
    }],
  },
};

const plugins = [
  ...((baseConfig.plugins ?? []) as Plugin[]).filter((plugin) => plugin?.name !== "puppyone-desktop-content-security-policy"),
  demoContentSecurityPolicyPlugin,
];

export default {
  ...baseConfig,
  plugins,
  resolve: { ...baseConfig.resolve, alias },
  cacheDir: ".vite-website-demo",
  build: { ...(baseConfig.build ?? {}), outDir: "dist-website-demo", emptyOutDir: true, rollupOptions: { ...(baseConfig.build?.rollupOptions ?? {}), input: { "website-demo": "website-demo.html" } } },
};
