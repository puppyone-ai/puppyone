import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { patchXtermWebglSource } from "../../../../scripts/patch-xterm-webgl-atlas.mjs";

describe("xterm WebGL glyph-atlas patch", () => {
  it("replaces mipmap generation with explicit non-mipmapped filters", () => {
    const original = "t.texImage2D(t.TEXTURE_2D,0,t.RGBA),t.generateMipmap(t.TEXTURE_2D),page.version=1";
    const result = patchXtermWebglSource(original, "fixture");

    expect(result.changed).toBe(true);
    expect(result.source).not.toContain("generateMipmap");
    expect(result.source).toContain(
      "t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.LINEAR)",
    );
    expect(result.source).toContain(
      "t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.LINEAR)",
    );
  });

  it("is idempotent and fails closed if the upstream bundle shape changes", () => {
    const original = "g.generateMipmap(g.TEXTURE_2D)";
    const first = patchXtermWebglSource(original, "fixture");
    const second = patchXtermWebglSource(first.source, "fixture");

    expect(second).toEqual({ changed: false, source: first.source });
    expect(() => patchXtermWebglSource("const renderer = 'changed';", "fixture"))
      .toThrow(/no longer matches/);
  });

  it("runs after installs and leaves both published bundles on the safe path", () => {
    const manifest = JSON.parse(source("package.json"));
    expect(manifest.scripts.postinstall).toContain("patch-xterm-webgl-atlas.mjs");

    for (const relativePath of [
      "node_modules/@xterm/addon-webgl/lib/addon-webgl.js",
      "node_modules/@xterm/addon-webgl/lib/addon-webgl.mjs",
    ]) {
      const bundle = source(relativePath);
      expect(bundle).not.toContain("generateMipmap");
      expect(bundle).toContain("TEXTURE_MIN_FILTER");
      expect(bundle).toContain("TEXTURE_MAG_FILTER");
    }
  });
});

function source(relativePath) {
  return readFileSync(new URL(`../../../../${relativePath}`, import.meta.url), "utf8");
}
