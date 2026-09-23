#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../../", import.meta.url));
const temporary = await mkdtemp(path.join(os.tmpdir(), "puppyone-selection-"));
const artifactRoot = process.env.PUPPYONE_TEXT_SELECTION_ARTIFACT_DIR
  ?? path.join(root, "artifacts/tests/appearance/text-selection");
await mkdir(artifactRoot, { recursive: true });
// CI supplies an already unique check directory and expects result.json there.
const artifacts = process.env.PUPPYONE_TEXT_SELECTION_ARTIFACT_DIR
  ?? await mkdtemp(path.join(artifactRoot, "run-"));
let child;
let interrupted = false;
const interrupt = () => { interrupted = true; child?.kill(); };
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);

try {
  child = spawn(require("electron"), [path.join(root, "tests/integration/appearance/themes/text-selection.smoke.mjs")], {
    cwd: root,
    stdio: "inherit",
    timeout: 120_000,
    env: {
      ...process.env,
      PUPPYONE_TEXT_SELECTION_TEMP_DIR: temporary,
      PUPPYONE_TEXT_SELECTION_ARTIFACT_DIR: artifacts,
    },
  });
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  assert(!interrupted && !result.signal, "Text selection smoke interrupted");
  assert.equal(result.code, 0, "Text selection smoke failed");
  // A premature Electron quit must not be mistaken for completed assertions.
  const evidence = JSON.parse(await readFile(path.join(artifacts, "result.json"), "utf8"));
  assert(evidence.matrix.length > 0 && evidence.forced && evidence.keyboard, "Missing selection completion evidence");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  // Only delete the unique directory this runner created, after the child exits.
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
  assert(path.basename(temporary).startsWith("puppyone-selection-"));
  await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
