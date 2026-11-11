import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { excalidrawBreakpointPatches, patchExcalidrawMobileBreakpoint } from "../../../../scripts/patch-excalidraw-mobile-breakpoint.mjs";

const upstream = (build) => {
  const installed = readFileSync(new URL(`../../../../node_modules/@excalidraw/excalidraw/dist/${build}/index.js`, import.meta.url), "utf8");
  const { before, after } = excalidrawBreakpointPatches[build];
  return installed.replace(after, () => before);
};

describe("Excalidraw desktop breakpoint", () => {
  for (const build of ["dev", "prod"]) {
    it(`keeps mouse-driven ${build} editors on the desktop layout above 500px`, () => {
      const source = upstream(build);
      const result = patchExcalidrawMobileBreakpoint(source, build);
      expect(result.changed).toBe(true);
      expect(result.source).toContain('matchMedia?.("(pointer: coarse)")');
      expect(result.source.replace(excalidrawBreakpointPatches[build].after, () => excalidrawBreakpointPatches[build].before)).toBe(source);
    });
    it(`is idempotent and fails closed when ${build} changes`, () => {
      const source = upstream(build);
      const result = patchExcalidrawMobileBreakpoint(source, build);
      expect(patchExcalidrawMobileBreakpoint(result.source, build)).toEqual({ changed: false, source: result.source });
      expect(() => patchExcalidrawMobileBreakpoint(source.replace(excalidrawBreakpointPatches[build].before, ""), build)).toThrow("review");
      expect(() => patchExcalidrawMobileBreakpoint(source + source, build)).toThrow("review");
    });
  }
});
