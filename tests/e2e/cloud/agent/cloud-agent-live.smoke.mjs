#!/usr/bin/env node
import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { cloudAgentLiveScenario } from "../../../support/cloud/cloudAgentLiveScenario.mjs";
import { connectCloudAgentLiveDriver } from "../../../support/cloud/cloudAgentLiveDriver.mjs";

const { values } = parseArgs({ options: {
  cdp: { type: "string", default: "http://127.0.0.1:9222" },
  "api-base": { type: "string" }, "project-id": { type: "string" }, workspace: { type: "string" },
  timeout: { type: "string", default: "90000" }, out: { type: "string", default: "artifacts/tests/cloud/agent-live" },
} });
for (const key of ["api-base", "project-id", "workspace"]) {
  if (!values[key]) throw new Error(`--${key} is required. Sign in to the real backend and select an already hosted local repository.`);
}
const cdp = new URL(values.cdp);
if (cdp.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(cdp.hostname) || cdp.username || cdp.password) throw new Error("CDP must use a loopback HTTP address");
const api = new URL(values["api-base"]);
if (!["http:", "https:"].includes(api.protocol) || api.username || api.password || api.search || api.hash || !api.pathname.endsWith("/api/v1")) throw new Error("--api-base must be a credential-free Cloud API base ending in /api/v1");
const timeout = Number(values.timeout);
if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 300000) throw new Error("--timeout must be 1000–300000 ms");
const report = { passed: false, backend: "live", api_base: values["api-base"], project_id: values["project-id"],
  started_at: new Date().toISOString(), steps: [], turns: [] };
let driver;
try {
  driver = await connectCloudAgentLiveDriver({ cdp: cdp.origin, apiBase: values["api-base"],
    projectId: values["project-id"], workspace: values.workspace, timeout });
  await cloudAgentLiveScenario(driver, report);
  report.passed = true;
  console.log("Live Cloud Agent acceptance passed: three replies in one session across two Local/Cloud round trips.");
} catch (error) {
  report.error = { message: error.message, ...(error.status ? { status: error.status } : {}) };
  process.exitCode = 1;
  console.error(`Live Cloud Agent acceptance FAILED: ${error.message}`);
} finally {
  driver?.close();
  report.finished_at = new Date().toISOString();
  await mkdir(path.resolve(values.out), { recursive: true });
  await writeFile(path.join(values.out, "result.json"), JSON.stringify(report, null, 2));
}
