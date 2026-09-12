import { expect, it } from "vitest";
import { createVitest } from "vitest/node";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import SourceReceiptReporter from "../../../support/runners/source-receipt-reporter.mjs";
import { createTestArtifacts } from "../../../support/runners/test-artifacts.mjs";

it("preserves each watch cycle's actual JSON result and completed source receipt", () => verifyWatchEvidence("test"), 30_000);
it("preserves actual benchmark output and source receipts across watch cycles", () => verifyWatchEvidence("benchmark"), 30_000);

async function verifyWatchEvidence(mode) {
  const root = await mkdtemp(path.join(os.tmpdir(), "puppyone-watch-evidence-"));
  const artifacts = await createTestArtifacts({ environment: { npm_lifecycle_event: "watch-fixture" } });
  const directories = [artifacts.directory];
  let runner;
  try {
    await symlink(fileURLToPath(new URL("../../../../node_modules", import.meta.url)), path.join(root, "node_modules"), "junction");
    const isBenchmark = mode === "benchmark";
    const fileName = isBenchmark ? "example.bench.mjs" : "example.test.mjs";
    const testFile = path.join(root, fileName);
    await writeFile(testFile, isBenchmark
      ? 'import { bench } from "vitest"; bench("watch fixture", () => Math.sqrt(4), { time: 1, iterations: 1, warmupTime: 0, warmupIterations: 0 });'
      : 'import { test, expect } from "vitest"; test("watch fixture", () => expect(2 + 2).toBe(4));');
    runner = await createVitest(mode, {
      root, config: false, watch: true, maxWorkers: 1,
      include: ["example.test.mjs"],
      reporters: ["json", new SourceReceiptReporter({ directory: artifacts.directory })],
      outputFile: { json: artifacts.results },
      benchmark: { include: ["example.bench.mjs"], outputJson: artifacts.benchmarks, reporters: ["default", new SourceReceiptReporter({ directory: artifacts.directory })] },
    }, { server: { watch: null } });
    await runner.start();
    const firstFile = isBenchmark ? artifacts.benchmarks : artifacts.results;
    const verifyResult = (text) => {
      const result = JSON.parse(text);
      if (isBenchmark) expect(result.files.flatMap(file => file.groups.flatMap(group => group.benchmarks)).map(bench => bench.name)).toEqual(["watch fixture"]);
      else expect(result).toMatchObject({ numPassedTests: 1, success: true });
    };
    const original = await readFile(firstFile, "utf8");
    verifyResult(original);
    await runner.rerunFiles([testFile]);
    const rerunFile = isBenchmark ? runner.config.benchmark.outputJson : runner.config.outputFile.json;
    directories.push(path.dirname(rerunFile));
    expect(rerunFile).not.toBe(firstFile);
    expect(await readFile(firstFile, "utf8")).toBe(original);
    verifyResult(await readFile(rerunFile, "utf8"));
    for (const directory of directories) {
      const receipt = JSON.parse(await readFile(path.join(directory, "invocation.json"), "utf8"));
      expect(receipt).toMatchObject({ outcome: "passed", sourceChanged: false, completedAt: expect.any(String) });
      expect(receipt.source.fingerprint).toBe(receipt.sourceAfter.fingerprint);
    }
  } finally {
    await runner?.close();
    await rm(root, { recursive: true, force: true });
    await Promise.all(directories.map(directory => rm(directory, { recursive: true, force: true })));
  }
}
