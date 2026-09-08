#!/usr/bin/env node

import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const electronPath = require("electron");
const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "smoke-agent-render-stability.mjs");
const statusRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "puppyone-agent-render-stability-status-"));
const statusPath = path.join(statusRoot, "status.json");

let child = null;
try {
  child = spawn(electronPath, [scriptPath], {
    stdio: "inherit",
    env: { ...process.env, PUPPYONE_AGENT_RENDER_STABILITY_STATUS_PATH: statusPath },
  });
  const childResult = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  let status = null;
  try {
    status = JSON.parse(await fsp.readFile(statusPath, "utf8"));
  } catch (error) {
    console.error("Agent render stability smoke did not publish its completion status.", error);
  }
  if (status && Number.isInteger(status.exitCode)) process.exitCode = status.exitCode;
  else if (childResult.code !== null) process.exitCode = childResult.code || 1;
  else {
    console.error(`Agent render stability smoke exited with signal ${childResult.signal || "unknown"}.`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await fsp.rm(statusRoot, { recursive: true, force: true }).catch(() => undefined);
}
