import { availableParallelism } from "node:os";
import { mergeConfig } from "vite";
import { defineConfig } from "vitest/config";
import desktopConfig from "../../vite.config";
import { testInclude, benchmarkInclude } from "./discovery.mjs";
import SourceReceiptReporter from "../support/runners/source-receipt-reporter.mjs";
import { createTestArtifacts } from "../support/runners/test-artifacts.mjs";

export async function createTestConfig({ include = testInclude }: { include?: string[] } = {}) {
  const artifacts = await createTestArtifacts();
  return mergeConfig(desktopConfig, defineConfig({
    test: {
      include,
      exclude: ["**/node_modules/**"],
      isolate: true,
      // Filesystem/Git and DOM suites share host resources; bound concurrent forks.
      maxWorkers: Math.min(2, availableParallelism()),
      reporters: ["default", "json", new SourceReceiptReporter({ directory: artifacts.directory })],
      outputFile: { json: artifacts.results },
      coverage: { reportsDirectory: artifacts.coverage },
      benchmark: {
        include: benchmarkInclude,
        reporters: ["default", new SourceReceiptReporter({ directory: artifacts.directory })],
        outputJson: artifacts.benchmarks,
      },
    },
  }));
}

export default defineConfig(() => createTestConfig());
