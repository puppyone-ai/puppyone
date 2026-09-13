import { readFile } from "node:fs/promises";
import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import { createTestConfig } from "./vitest.config";
import { coreCoverageDomains, coreCoverageExclude } from "./core-coverage.mjs";

const baseline = JSON.parse(await readFile(new URL("./core-coverage-baseline.json", import.meta.url), "utf8"));
export default defineConfig(async () => mergeConfig(await createTestConfig(), {
  test: {
    coverage: {
      enabled: true,
      provider: "v8",
      reporter: ["text-summary", "json-summary", "json", "html"],
      include: Object.values(coreCoverageDomains),
      exclude: coreCoverageExclude,
      reportOnFailure: true,
      thresholds: Object.fromEntries(Object.entries(coreCoverageDomains).map(([domain, pattern]) => [pattern, baseline.thresholds[domain]])),
    },
  },
}));
