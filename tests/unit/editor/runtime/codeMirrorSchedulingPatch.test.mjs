import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { patchCodeMirrorScheduling } from "../../../../scripts/patch-codemirror-scheduling.mjs";

const installed = readFileSync(new URL("../../../../node_modules/@codemirror/language/dist/index.js", import.meta.url), "utf8");
const patchedSlice = "12 /* Work.Slice: Puppyone interactive parser budget */";
const patchedAhead = "20000 /* Work.MaxParseAhead: Puppyone bounded syntax lookahead */";
const upstream = installed.replace(patchedSlice, "100 /* Work.Slice */").replaceAll(patchedAhead, "100000 /* Work.MaxParseAhead */");

describe("CodeMirror background work budget", () => {
  it("bounds an upstream slice without changing total parse work or grammar", () => {
    const result = patchCodeMirrorScheduling(upstream);
    expect(result.changed).toBe(true);
    expect(result.source.replace(patchedSlice, "100 /* Work.Slice */").replaceAll(patchedAhead, "100000 /* Work.MaxParseAhead */")).toBe(upstream);
    expect(result.source).toContain("3000 /* Work.ChunkBudget */");
  });
  it("is idempotent and fails closed when the dependency implementation changes", () => {
    const result = patchCodeMirrorScheduling(upstream);
    expect(patchCodeMirrorScheduling(result.source)).toEqual({ changed: false, source: result.source });
    expect(() => patchCodeMirrorScheduling(upstream.replace("100 /* Work.Slice */", "80 /* Work.Slice */"))).toThrow("review");
    expect(() => patchCodeMirrorScheduling(upstream + upstream)).toThrow("review");
  });
});
