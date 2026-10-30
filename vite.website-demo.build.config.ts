// Builds the website demo (website-demo.html) on its own, as static files in
// dist-website-demo/: the real renderer over an in-memory folder, embedded by
// the puppyone website's homepage. `npm run build:website-demo`.
import type { Plugin } from "vite";
import demoConfig from "./vite.website-demo.config";

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

// The demo reads no Cloud configuration, so it publishes no desktop-cloud.json.
const DESKTOP_ONLY_PLUGINS = new Set(["puppyone-desktop-content-security-policy", "puppyone-desktop-cloud-configuration"]);
const plugins = [
  ...((demoConfig.plugins ?? []) as Plugin[]).filter((plugin) => !DESKTOP_ONLY_PLUGINS.has(plugin?.name)),
  demoContentSecurityPolicyPlugin,
];

export default {
  ...demoConfig,
  plugins,
  build: { ...(demoConfig.build ?? {}), outDir: "dist-website-demo", emptyOutDir: true, rollupOptions: { ...(demoConfig.build?.rollupOptions ?? {}), input: { "website-demo": "website-demo.html" } } },
};
