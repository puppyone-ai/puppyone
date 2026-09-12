import { describe, expect, it } from "vitest";
import { testLayoutErrors } from "../../../../scripts/check-test-layout.mjs";
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
});
