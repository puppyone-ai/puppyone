import { afterEach, describe, expect, it } from "vitest";
import { createVitest } from "vitest/node";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { benchmarkInclude, testExtensions, testInclude, testLayers } from "../../../config/discovery.mjs";
import { testLayoutErrors } from "../../../../scripts/check-test-layout.mjs";

const roots = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

it("discovers every supported test extension in every layer through the actual Vitest engine", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "puppyone-test-discovery-"));
  roots.push(root);
  const runtime = testLayers.flatMap(layer => testExtensions.map(extension => `tests/${layer}/editor/runtime/example.test.${extension}`));
  const benchmark = "tests/performance/benchmarks/editor/runtime/example.bench.ts";
  const rejected = ["tests/unit/editor/runtime/hidden.spec.ts", "tests/unit/editor/runtime/hidden.test.js", "tests/performance/benchmarks/editor/runtime/hidden.bench.js"];
  const files = [...runtime, benchmark, ...rejected];
  for (const file of files) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), "// Discovery fixture: no execution necessary.\n");
  }
  const metadata = { build: { files: ["!tests/**", "!**/*.test.*", "!**/*.spec.*", "!**/*.bench.*"] } };
  expect(testLayoutErrors([...runtime, benchmark], metadata)).toEqual([]);
  expect(testLayoutErrors(rejected, metadata)).toHaveLength(rejected.length);
  for (const mode of ["test", "benchmark"]) {
    const runner = await createVitest(mode, { root, config: false, watch: false, include: testInclude,
      benchmark: { include: benchmarkInclude } }, { server: { watch: null } });
    try {
      const specifications = await runner.globTestSpecifications();
      expect(specifications.map(specification => path.relative(root, specification.moduleId).split(path.sep).join("/")).sort())
        .toEqual((mode === "test" ? runtime : [benchmark]).sort());
    } finally { await runner.close(); }
  }
}, 15_000);
