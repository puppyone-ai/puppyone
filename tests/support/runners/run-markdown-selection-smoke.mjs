#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const scriptPath = path.join(repoRoot, "tests/integration/editor/formats/markdown/rendering/markdown-selection-stability.smoke.mjs");
const artifactRoot = path.join(repoRoot, "artifacts/tests/markdown-selection");
await fsp.mkdir(artifactRoot, { recursive: true });
const reportDir = process.env.PUPPYONE_MARKDOWN_SELECTION_ARTIFACT_DIR
  ?? await fsp.mkdtemp(path.join(artifactRoot, `${new Date().toISOString().replaceAll(":", "-")}-`));
await fsp.mkdir(reportDir, { recursive: true });
let child = null;
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM", "SIGUSR2"]) {
  process.on(signal, () => {
    interrupted = true;
    child?.kill(signal);
  });
}

async function runCase(directory, args) {
  assert.ok(!interrupted, "Markdown selection runner interrupted");
  child = spawn(electronPath, [scriptPath, ...args], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, PUPPYONE_MARKDOWN_SELECTION_ARTIFACT_DIR: directory },
  });
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  child = null;
  assert.ok(!interrupted && !result.signal, "Electron selection check was interrupted");
  // Never infer success from exit code alone: Electron can quit early when
  // its last window closes. Missing or negative completion evidence fails.
  const report = JSON.parse(await fsp.readFile(path.join(directory, "report.json"), "utf8"));
  return { ...result, report };
}

const receipt = { failureExitVerified: false, completed: false, error: null };
try {
  const probe = await runCase(path.join(reportDir, "exit-code-probe"), ["--self-test-failure"]);
  assert.equal(probe.code, 1, "intentional assertion must exit with failure");
  assert.equal(probe.report.ok, false);
  assert.match(probe.report.error, /Intentional runner exit-code verification/);
  receipt.failureExitVerified = true;
  const result = await runCase(reportDir, []);
  assert.equal(result.code, 0, "Markdown selection scenarios failed");
  assert.equal(result.report.ok, true, "Markdown selection scenarios did not publish success");
  receipt.completed = true;
} catch (error) {
  receipt.error = error instanceof Error ? error.stack : String(error);
  console.error(error);
  process.exitCode = 1;
} finally {
  await fsp.writeFile(path.join(reportDir, "runner.json"), JSON.stringify(receipt, null, 2));
}
