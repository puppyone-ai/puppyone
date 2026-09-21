import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(file), "utf8");
describe("Mermaid computation boundary", () => {
  it("keeps the engine out of shared rendering and the application bootstrap", () => {
    for (const file of [
      "packages/shared-ui/src/editor/markdown/features/mermaid/mermaidRenderer.ts",
      "packages/shared-ui/src/editor/markdown/features/mermaid/mermaidRenderService.ts",
      "src/platform/mermaid/desktopMermaidClient.ts",
      "src/main.tsx",
    ]) expect(read(file)).not.toMatch(/import\(["']mermaid["']\)|import\s+(?!type\b)[^;]+from\s+["']mermaid["']/);
    expect(read("src/platform/mermaid/renderer.ts")).toContain('import("mermaid")');
    expect(read("electron/main.mjs")).toContain("registerMermaidIpc({ ipcMain: trustedIpcMain");
  });
  it("keeps the compute preload capability small and engine cache version explicit", () => {
    const preload = read("electron/mermaid-preload.cjs");
    expect(preload).not.toMatch(/puppyoneDesktop|ipcRenderer\.invoke|require\(["'](?:node:)?fs/);
    const installed = JSON.parse(read("node_modules/mermaid/package.json")) as { version: string };
    expect(read("packages/shared-ui/src/editor/markdown/features/mermaid/mermaidRenderService.ts"))
      .toContain(`mermaid-${installed.version}-`);
  });
});
