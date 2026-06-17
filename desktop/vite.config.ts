import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: [
      {
        find: "@puppyone/data-core",
        replacement: fileURLToPath(new URL("../packages/data-core/src/index.ts", import.meta.url)),
      },
      {
        find: "@puppyone/data-ui",
        replacement: fileURLToPath(new URL("../packages/data-ui/src/index.ts", import.meta.url)),
      },
      {
        find: "@puppyone/editor-ui",
        replacement: fileURLToPath(new URL("../packages/editor-ui/src/index.ts", import.meta.url)),
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
  server: {
    strictPort: true,
    port: 5173,
  },
});
