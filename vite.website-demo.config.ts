// Development server for the website demo (`npm run dev:website-demo`, port
// 5190, where the website's development server looks for it). It keeps its
// own dependency cache so it can run beside the desktop app's dev server.
import { fileURLToPath, URL } from "node:url";
import baseConfig from "./vite.config";

// Main's Agent actor imports randomUUID from node:crypto; the browser has its own.
const alias = [
  { find: /^node:crypto$/, replacement: fileURLToPath(new URL("./src/website-demo/shims/node-crypto.ts", import.meta.url)) },
  ...((baseConfig.resolve?.alias as unknown[]) ?? []),
];

export default { ...baseConfig, resolve: { ...baseConfig.resolve, alias }, cacheDir: ".vite-website-demo" };
