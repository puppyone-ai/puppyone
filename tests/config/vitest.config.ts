import { availableParallelism } from "node:os";
import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import desktopConfig from "../../vite.config";

export default mergeConfig(desktopConfig, defineConfig({
  test: {
    include: ["tests/{unit,component,integration,architecture}/**/*.test.{ts,tsx,mjs}"],
    exclude: ["**/node_modules/**"],
    isolate: true,
    // Filesystem/Git and DOM suites share host resources; bound concurrent forks.
    maxWorkers: Math.min(2, availableParallelism()),
    reporters: ["default", "json"],
    outputFile: { json: "artifacts/tests/vitest/results.json" },
    coverage: { reportsDirectory: "artifacts/tests/coverage/all" },
    benchmark: {
      include: ["tests/performance/benchmarks/**/*.bench.ts"],
      outputJson: "artifacts/tests/performance/benchmarks.json",
    },
  },
}));
