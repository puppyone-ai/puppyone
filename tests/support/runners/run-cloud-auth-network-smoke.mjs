import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-auth-proxy-"));
const environment = { ...process.env, PUPPYONE_AUTH_PROXY_QA_DIR: profile };
delete environment.ELECTRON_RUN_AS_NODE;
// Match the repository's existing isolated Electron CI launch policy.
if (environment.GITHUB_ACTIONS === "true") environment.ELECTRON_DISABLE_SANDBOX = "1";
try {
  const electron = createRequire(import.meta.url)("electron");
  const args = [path.join(root, "tests/integration/cloud/auth/cloud-auth-proxy.smoke.mjs")];
  const headless = process.platform === "linux" && !process.env.DISPLAY;
  const execution = promisify(execFile)(headless ? "xvfb-run" : electron, headless ? ["-a", electron, ...args] : args, {
    cwd: root, env: environment, timeout: 45_000, killSignal: "SIGKILL", maxBuffer: 4 * 1024 * 1024,
  });
  execution.child.stderr.pipe(process.stderr);
  await execution;
  const report = JSON.parse(await fs.readFile(path.join(profile, "report.json"), "utf8"));
  assert.equal(report.result, "passed", "Real Electron proxy smoke did not produce a passing receipt.");
  const output = path.join(root, "artifacts/tests/cloud-auth-network");
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, `smoke-${process.platform}.json`), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally {
  await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
