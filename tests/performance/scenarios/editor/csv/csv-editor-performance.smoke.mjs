#!/usr/bin/env electron

import { app, BrowserWindow, contentTracing } from "electron";
import fsp from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { readSourceIdentity } from "../../../../../scripts/release-checks/execution.mjs";
import { inspectArtifact } from "../../../../../scripts/release-checks/artifacts.mjs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const indexPath = path.join(repoRoot, "dist", "index.html");
const outputPath = resolveOutputPath(process.argv.slice(2));
const tracePath = resolveOptionalPath(process.argv.slice(2), "--trace");
const sampleTarget = 30;
const statusPath = process.env.PUPPYONE_CSV_SMOKE_STATUS_PATH || null;
const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "puppyone-csv-performance-"));
app.setPath("userData", path.join(tempRoot, "user-data"));
app.commandLine.appendSwitch("disable-renderer-backgrounding");

let window = null;

async function runSmoke() {
  await fsp.access(indexPath);
  const source = await readSourceIdentity(repoRoot);
  const buildArtifact = await inspectArtifact(path.join(repoRoot, "dist"));
  if (tracePath) {
    await contentTracing.startRecording({
      included_categories: [
        "devtools.timeline",
        "v8",
        "blink.user_timing",
        "disabled-by-default-v8.cpu_profiler",
        "disabled-by-default-v8.cpu_profiler.hires",
      ],
    });
  }
  window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await window.loadURL(
    `${pathToFileURL(indexPath).toString()}?csvPerformanceSamples=${sampleTarget}#csv-editor-performance-smoke`,
  );
  const summary = await pollForResult(window).catch(error => ({ error: error.message }));
  if (tracePath) await contentTracing.stopRecording(tracePath);
  const sourceAfter = await readSourceIdentity(repoRoot);
  const report = {
    source, sourceAfter, sourceChanged: source.fingerprint !== sourceAfter.fingerprint, buildArtifact,
    schema: "puppyone-csv-editor-performance/v1",
    environment: {
      capturedAt: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      chromium: process.versions.chrome,
      cpu: os.cpus()[0]?.model ?? "unknown",
      logicalCpuCount: os.cpus().length,
      memoryBytes: os.totalmem(),
      build: "production",
      sampleTarget,
    },
    summary,
  };
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log(`CSV editor performance report written to ${outputPath}`);
  if (summary.error) throw new Error(summary.error);
  // Always retain the measured result, including threshold failures, so a
  // regression has enough evidence to diagnose instead of only an exit code.
  if (report.sourceChanged) throw new Error("Source changed during performance verification.");
  validateSummary(summary);
}

async function pollForResult(ownerWindow) {
  for (let attempt = 0; attempt < 2_400; attempt += 1) {
    const result = await ownerWindow.webContents.executeJavaScript(
      "window.__PUPPYONE_CSV_PERFORMANCE_SMOKE_RESULT__ || null",
      true,
    );
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("CSV editor performance smoke did not publish a result within 120 seconds.");
}

function validateSummary(summary) {
  if (summary.inputTransactions.samples < sampleTarget) {
    throw new Error(`Expected ${sampleTarget} CSV input samples, received ${summary.inputTransactions.samples}.`);
  }
  if (summary.inputTransactions.p95 > 16) {
    throw new Error(`500x20 CSV input p95 exceeded 16ms: ${summary.inputTransactions.p95}ms.`);
  }
  if (summary.openToProjection.p95 > 50) {
    throw new Error(`CSV warm open-to-projection p95 exceeded 50ms: ${summary.openToProjection.p95}ms.`);
  }
  if (summary.longTasks.over50ms > 0) {
    throw new Error(`Observed ${summary.longTasks.over50ms} CSV renderer Long Tasks over 50ms.`);
  }
  const { large, wide } = summary.structural;
  if (large.logicalRows !== 10_000 || large.mountedRows > 80 || large.mountedCells > 2_000) {
    throw new Error(`Large CSV structural bound failed: ${JSON.stringify(large)}.`);
  }
  if (large.virtualRowStartAfterScroll <= 0) {
    throw new Error("Large CSV row window did not advance after scrolling.");
  }
  if (large.rapidScrollSamples < 24 || large.rapidScrollCoverageMisses > 0) {
    throw new Error(`Large CSV rapid-scroll coverage failed: ${JSON.stringify(large)}.`);
  }
  if (large.rapidScrollPeakMountedCells > 2_000) {
    throw new Error(`Large CSV rapid-scroll cell budget failed: ${JSON.stringify(large)}.`);
  }
  if (large.rapidScrollPeakMountedCells <= large.mountedCells) {
    throw new Error(`Large CSV rapid-scroll buffer did not contract: ${JSON.stringify(large)}.`);
  }
  if (wide.logicalColumns !== 100 || wide.mountedColumns >= 100 || wide.mountedCells > 2_000) {
    throw new Error(`Wide CSV structural bound failed: ${JSON.stringify(wide)}.`);
  }
  if (wide.rapidScrollSamples < 24 || wide.rapidScrollCoverageMisses > 0 || wide.rapidScrollPeakMountedCells > 2_000) {
    throw new Error(`Wide CSV rapid-scroll coverage failed: ${JSON.stringify(wide)}.`);
  }
  if (wide.virtualColumnStartAfterScroll <= 0) {
    throw new Error("Wide CSV column window did not advance after scrolling.");
  }
}

function resolveOutputPath(args) {
  const outputIndex = args.indexOf("--outputJson");
  const requested = outputIndex >= 0 ? args[outputIndex + 1] : null;
  return path.resolve(requested || path.join(repoRoot, `artifacts/tests/performance/csv-editor-smoke-${Date.now()}-${randomUUID()}.json`));
}

function resolveOptionalPath(args, flag) {
  const index = args.indexOf(flag);
  const requested = index >= 0 ? args[index + 1] : null;
  return requested ? path.resolve(requested) : null;
}

async function finish(exitCode, error = null) {
  if (statusPath) {
    await fsp.writeFile(statusPath, `${JSON.stringify({
      exitCode,
      error: error instanceof Error ? error.stack || error.message : error ? String(error) : null,
    })}\n`, "utf8");
  }
  window?.destroy();
  await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  app.exit(exitCode);
}

app.whenReady().then(runSmoke).then(() => finish(0)).catch(async (error) => {
  console.error(error);
  await finish(1, error);
});
