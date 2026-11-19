// The website demo: the real renderer over an in-memory folder, embedded by the
// puppyone website's homepage. `npm run dev:website-demo` serves it on port 5190,
// where the website's development server looks for it, with its own dependency
// cache so it can run beside the desktop app's dev server.
// `npm run build:website-demo` writes static files to dist-website-demo/.
// Both keep the /website-demo.html address the website embeds.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import baseConfig from "../../vite.config";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

// The renderer will not start without Cloud addresses, and the demo never calls
// them: its in-memory bridge answers everything. It only accepts puppyone or
// loopback hosts, so this is the loopback discard port, where nothing answers.
// These win over any local .env: every build comes out the same, and none can
// carry a developer's real endpoints.
process.env.VITE_DESKTOP_CLOUD_API_URL = "http://127.0.0.1:9/api/v1";
process.env.VITE_DESKTOP_CLOUD_WEB_URL = "http://127.0.0.1:9";
process.env.VITE_DESKTOP_CLOUD_GIT_ORIGIN = "";

// Main's Agent actor imports randomUUID from node:crypto; the browser has its own.
const alias = [
  { find: /^node:crypto$/, replacement: path.join(repoRoot, "src/website-demo/shims/node-crypto.ts") },
  ...((baseConfig.resolve?.alias as unknown[]) ?? []),
];

const demoConfig = {
  ...baseConfig,
  root: path.join(repoRoot, "src/website-demo"),
  publicDir: path.join(repoRoot, "public"),
  envDir: repoRoot,
  server: { ...baseConfig.server, fs: { allow: [repoRoot] } },
  resolve: { ...baseConfig.resolve, alias },
  cacheDir: path.join(repoRoot, ".vite-website-demo"),
};

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

// The desktop app reads these four files from disk. On the web they would each
// cost a round trip before anything else can start, one after the other, because
// classic scripts stop the page parsing until they have run. Inline, they arrive
// with the page.
const INLINED_BOOTSTRAP_FILES = ["interface-style-bootstrap.js", "sub-theme-bootstrap.js", "initial-theme.js", "initial-shell.css"];
const inlineBootstrapPlugin: Plugin = {
  name: "puppyone-website-demo-inline-bootstrap",
  apply: "build",
  transformIndexHtml: {
    order: "post",
    handler: (html) => INLINED_BOOTSTRAP_FILES.reduce((page, file) => {
      const source = readFileSync(path.join(repoRoot, "public", file), "utf8");
      const reference = file.endsWith(".css")
        ? new RegExp(`<link rel="stylesheet" href="\\./${file}"\\s*/?>`)
        : new RegExp(`<script src="\\./${file}"></script>`);
      if (!reference.test(page)) throw new Error(`website demo: ${file} is no longer referenced as expected.`);
      return page.replace(reference, () => (file.endsWith(".css") ? `<style>${source}</style>` : `<script>${source}</script>`));
    }, html),
  },
};

// The renderer is imported only once the page has sent a scenario, so its files
// would be requested after everything else, in several rounds as each one names
// the next. Listing them in the page fetches them all at once, in one round.
// The demo always opens the Agent pane, so its lazy files are listed too; a file
// renamed out of this pattern is only fetched a little later.
const BOOT_LAZY_FILES = /^assets\/(Agent|desktop-agent|electronAgentClient|MarkdownViewer)/;
const preloadRendererPlugin: Plugin = {
  name: "puppyone-website-demo-preload-renderer",
  apply: "build",
  transformIndexHtml: {
    order: "post",
    handler: (html, context) => {
      const chunks = new Map(Object.values(context.bundle ?? {}).flatMap((item) => (item.type === "chunk" ? [[item.fileName, item] as const] : [])));
      const renderer = [...chunks.values()].find((chunk) => chunk.facadeModuleId?.endsWith("/src/main.tsx"));
      if (!renderer) throw new Error("website demo: the renderer chunk was not found.");
      const scripts = new Set<string>();
      const styles = new Set<string>();
      const visit = (fileName: string) => {
        const chunk = chunks.get(fileName);
        if (!chunk || scripts.has(fileName)) return;
        scripts.add(fileName);
        chunk.viteMetadata?.importedCss.forEach((file) => styles.add(file));
        chunk.imports.forEach(visit);
        chunk.dynamicImports.filter((file) => BOOT_LAZY_FILES.test(file)).forEach(visit);
      };
      visit(renderer.fileName);
      const listed = (file: string) => html.includes(`./${file}"`);
      const links = [
        ...[...styles].filter((file) => !listed(file)).map((file) => `<link rel="preload" as="style" crossorigin href="./${file}">`),
        ...[...scripts].filter((file) => !listed(file)).map((file) => `<link rel="modulepreload" crossorigin href="./${file}">`),
      ];
      return html.replace("</head>", `${links.join("\n    ")}\n  </head>`);
    },
  },
};

// The demo reads no Cloud configuration, so it publishes no desktop-cloud.json.
const DESKTOP_ONLY_PLUGINS = new Set(["puppyone-desktop-content-security-policy", "puppyone-desktop-cloud-configuration"]);
const plugins = [
  ...((demoConfig.plugins ?? []) as Plugin[]).filter((plugin) => !DESKTOP_ONLY_PLUGINS.has(plugin?.name)),
  demoContentSecurityPolicyPlugin,
  inlineBootstrapPlugin,
  preloadRendererPlugin,
];

export default defineConfig(({ command }) => (command === "build" ? {
  ...demoConfig,
  plugins,
  build: {
    ...(demoConfig.build ?? {}),
    outDir: path.join(repoRoot, "dist-website-demo"),
    emptyOutDir: true,
    rollupOptions: {
      ...(demoConfig.build?.rollupOptions ?? {}),
      input: { "website-demo": path.join(repoRoot, "src/website-demo/website-demo.html") },
    },
  },
} : demoConfig));
