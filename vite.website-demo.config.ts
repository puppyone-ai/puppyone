// Development server for the website demo (`npm run dev:website-demo`, port
// 5190, where the website's development server looks for it). It keeps its
// own dependency cache so it can run beside the desktop app's dev server.
import { fileURLToPath, URL } from "node:url";
import baseConfig from "./vite.config";

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
  { find: /^node:crypto$/, replacement: fileURLToPath(new URL("./src/website-demo/shims/node-crypto.ts", import.meta.url)) },
  ...((baseConfig.resolve?.alias as unknown[]) ?? []),
];

export default { ...baseConfig, resolve: { ...baseConfig.resolve, alias }, cacheDir: ".vite-website-demo" };
