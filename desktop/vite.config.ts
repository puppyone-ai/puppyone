import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./cloud-source/frontend", import.meta.url)),
      "next/link": fileURLToPath(new URL("./src/next-shims/link.tsx", import.meta.url)),
    },
  },
  server: {
    strictPort: true,
    port: 5173,
  },
});
