import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { excalidrawHostPatches, patchExcalidrawHostIntegration } from "../../../../scripts/patch-excalidraw-host-integration.mjs";

const unpatch = (source, build) => excalidrawHostPatches[build].reduce((text, { before, after }) => text.replace(after, () => before), source);
const upstream = (build) => unpatch(readFileSync(new URL(`../../../../node_modules/@excalidraw/excalidraw/dist/${build}/index.js`, import.meta.url), "utf8"), build);

describe("Excalidraw Desktop host integration", () => {
  for (const build of ["dev", "prod"]) {
    it(`keeps mouse-driven ${build} editors on desktop layout and portals in the themed overlay root`, () => {
      const source = upstream(build);
      const result = patchExcalidrawHostIntegration(source, build);
      expect(result.changed).toBe(true);
      expect(result.source).toContain('matchMedia?.("(pointer: coarse)")');
      expect(result.source.split('getElementById("desktop-overlay-root")').length - 1).toBe(2);
      expect(result.source.split("Puppyone container coordinates").length - 1).toBe(2);
      expect(unpatch(result.source, build)).toBe(source);
    });
    it(`is idempotent and fails closed when ${build} changes`, () => {
      const source = upstream(build);
      const result = patchExcalidrawHostIntegration(source, build);
      expect(patchExcalidrawHostIntegration(result.source, build)).toEqual({ changed: false, source: result.source });
      for (const { before } of excalidrawHostPatches[build]) {
        expect(() => patchExcalidrawHostIntegration(source.replace(before, ""), build)).toThrow("review");
      }
      expect(() => patchExcalidrawHostIntegration(source + source, build)).toThrow("review");
    });
  }
});
