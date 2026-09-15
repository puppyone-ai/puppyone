import { describe, expect, it } from "vitest";
import { testLayoutErrors } from "../../../../scripts/check-test-layout.mjs";
import { isRuntimeTest, isBenchmark, testLayers, testDomains, testExtensions } from "../../../config/discovery.mjs";
const packageJson = { build: { files: ["!tests/**", "!**/*.test.*", "!**/*.spec.*", "!**/*.bench.*"] } };

describe("test directory boundaries", () => {
  it("accepts layered cases, isolated fixtures, benchmarks and frozen archives", () => {
    expect(testLayoutErrors([
      "tests/unit/editor/document-session/revisions.test.ts",
      "tests/component/agent/composer/input.test.tsx",
      "tests/integration/workbench/item-hosts/isolation.smoke.mjs",
      "tests/performance/benchmarks/editor/markdown/render.bench.ts",
      "tests/fixtures/agent/runtimes/server.mjs",
      "archive/legacy/test.test.ts",
    ], packageJson)).toEqual([]);
  });
  it("rejects misplaced cases and old smoke or benchmark locations", () => {
    const files = ["src/editor/view.test.ts", "tests/flat.test.ts", "tests/support/hidden.test.ts", "benchmarks/render.bench.ts", "scripts/smoke-editor.mjs"];
    const errors = testLayoutErrors(files, packageJson);
    for (const file of files) expect(errors.some((error) => error.startsWith(file + ":"))).toBe(true);
  });
  it("requires exclusions even when today's source tree contains no tests", () => {
    expect(testLayoutErrors([], { build: { files: ["electron/**"] } })).toHaveLength(4);
  });
  it.each(["spec.ts", "test.js", "test.jsx", "test.cts", "test.mts", "test.cjs"])(
    "rejects an undiscoverable %s test instead of silently accepting it", (suffix) => {
      const file = `tests/unit/editor/runtime/hidden.${suffix}`;
      expect(isRuntimeTest(file)).toBe(false);
      expect(testLayoutErrors([file], packageJson)).toEqual(expect.arrayContaining([
        expect.stringContaining("would not be discovered"),
      ]));
    },
  );
  it("accepts only executable names throughout the declared layers and domains", () => {
    for (const layer of testLayers) for (const domain of testDomains) for (const extension of testExtensions) {
      const file = `tests/${layer}/${domain}/behavior/example.test.${extension}`;
      expect(isRuntimeTest(file)).toBe(true);
      expect(testLayoutErrors([file], packageJson)).toEqual([]);
    }
  });
  it("rejects unsupported benchmark extensions and misspelled domains", () => {
    const benchmark = "tests/performance/benchmarks/editor/runtime/hidden.bench.js";
    expect(isBenchmark(benchmark)).toBe(false);
    expect(testLayoutErrors([benchmark], packageJson).join("\n")).toContain("would not be discovered");
    for (const file of ["tests/unit/edtiro/runtime/behavior.test.ts", "tests/integration/agnt/events/transport.smoke.mjs"])
      expect(testLayoutErrors([file], packageJson).join("\n")).toContain("unknown test domain");
  });
});
