#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const scriptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../performance/scenarios/editor/csv/csv-editor-performance.smoke.mjs",
);
const statusRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "puppyone-csv-smoke-status-"));
const statusPath = path.join(statusRoot, "status.json");
let child = null;

for (const signal of ["SIGINT", "SIGTERM", "SIGUSR2"]) {
  process.on(signal, () => {
    if (child && child.exitCode === null && child.signalCode === null) child.kill(signal);
  });
}

try {
  child = spawn(electronPath, [scriptPath, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: {
      ...process.env,
      PUPPYONE_CSV_SMOKE_STATUS_PATH: statusPath,
    },
  });
  const childResult = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  let status = null;
  try {
    status = JSON.parse(await fsp.readFile(statusPath, "utf8"));
  } catch (error) {
    console.error("CSV performance smoke did not publish its completion status.", error);
  }
  if (status && Number.isInteger(status.exitCode)) process.exitCode = status.exitCode;
  else if (childResult.code !== null) process.exitCode = childResult.code || 1;
  else {
    console.error(`CSV performance smoke exited with signal ${childResult.signal || "unknown"}.`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await fsp.rm(statusRoot, { recursive: true, force: true }).catch(() => undefined);
}
