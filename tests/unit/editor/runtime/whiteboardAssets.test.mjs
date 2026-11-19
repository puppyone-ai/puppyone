import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { excalidrawAssetsPlugin } from "../../../../scripts/desktop/build/excalidraw-assets-plugin.mjs";
import { classifyLocalFile, getMimeType, isLocalFilePreviewable, resolveCopyNameExtension } from "../../../../electron/local-api/files/file-format-policy.mjs";

describe("whiteboard desktop resources", () => {
  it("uses matching text admission, MIME and compound suffixes in the filesystem host", () => {
    for (const name of ["a.excalidraw", "a.excalidraw.json"]) {
      expect(classifyLocalFile(name)).toBe("whiteboard");
      expect(isLocalFilePreviewable(name)).toBe(true);
      expect(getMimeType(name)).toBe("application/vnd.excalidraw+json; charset=utf-8");
    }
    expect(resolveCopyNameExtension("a.excalidraw.json")).toBe(".excalidraw.json");
  });

  it("keeps the SDK font fallback offline and emits every referenced font", () => {
    const plugin = excalidrawAssetsPlugin();
    const emitted = new Set();
    plugin.generateBundle.call({ emitFile: asset => { emitted.add(asset.fileName); } });
    expect(emitted.has("assets/excalidraw/fonts/Cascadia/CascadiaCode-Regular.woff2")).toBe(true);
    for (const mode of ["dev", "prod"]) {
      const directory = new URL(`../../../../node_modules/@excalidraw/excalidraw/dist/${mode}/`, import.meta.url);
      const file = readdirSync(directory).find(file => file.endsWith('.js') && readFileSync(new URL(file, directory), 'utf8').includes('ASSETS_FALLBACK_URL'));
      expect(file).toBeTruthy();
      const original = readFileSync(new URL(file, directory), 'utf8');
      const transformed = plugin.transform(original, new URL(file, directory).pathname);
      expect(transformed).not.toBe(original);
      expect(transformed).not.toContain('`https://esm.sh/');
      expect(transformed).toContain('() => { this.callbacks.delete(');
      expect(transformed).not.toMatch(/if\s*\(!this\.callbacks\.has\(/);
      for (const [, font] of original.matchAll(/["']\.\/(fonts\/[^"']+\.woff2)["']/g)) {
        expect(emitted.has(`assets/excalidraw/${font}`), font).toBe(true);
      }
    }
  });
});
