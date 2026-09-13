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
const coldFirstOpen = process.argv.includes("--cold");
const linkIndex = process.argv.includes("--with-link-index");
const visible = process.argv.includes("--visible");
const oversizedBlocks = !process.argv.includes("--skip-oversized-blocks");
const sampleTarget = coldFirstOpen ? 1 : 30;
const statusPath = process.env.PUPPYONE_RENDERER_SMOKE_STATUS_PATH || null;
const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "puppyone-renderer-performance-"));
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
    show: visible,
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
    `${pathToFileURL(indexPath).toString()}?rendererPerformanceSamples=${sampleTarget}&rendererPerformanceCold=${coldFirstOpen}&rendererPerformanceLinkIndex=${linkIndex}&rendererPerformanceOversizedBlocks=${oversizedBlocks}#renderer-performance-smoke`,
  );

  const summary = await pollForResult(window).catch(error => ({ error: error.message }));
  if (tracePath) await contentTracing.stopRecording(tracePath);
  const sourceAfter = await readSourceIdentity(repoRoot);
  const report = {
    source, sourceAfter, sourceChanged: source.fingerprint !== sourceAfter.fingerprint, buildArtifact,
    schema: "puppyone-renderer-performance/v1",
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
      coldFirstOpen,
      linkIndex,
      visible,
      oversizedBlocks,
    },
    summary,
  };

  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await fsp.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (summary.error) throw new Error(summary.error);
  if (report.sourceChanged) throw new Error("Source changed during performance verification.");
  validateReport(report);
  console.log(JSON.stringify(report, null, 2));
  console.log(`Renderer performance report written to ${outputPath}`);
}

async function pollForResult(ownerWindow) {
  for (let attempt = 0; attempt < 1_200; attempt += 1) {
    const result = await ownerWindow.webContents.executeJavaScript(
      "window.__PUPPYONE_RENDERER_PERFORMANCE_SMOKE_RESULT__ || null",
      true,
    );
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Renderer performance smoke did not publish a result within 60 seconds.");
}

function validateReport(report) {
  const { summary } = report;
  const requiredSamples = report.environment.sampleTarget;
  if (summary.completedSamples < requiredSamples) {
    throw new Error(`Expected at least ${requiredSamples} completed samples, received ${summary.completedSamples}.`);
  }
  for (const stage of ["preview_shell_committed", "content_ready", "editor_base_ready", "preview_ready"]) {
    if ((summary.stages?.[stage]?.samples ?? 0) < requiredSamples) {
      throw new Error(`Stage ${stage} did not retain ${requiredSamples} samples.`);
    }
  }
  if (summary.staleCommitCount !== 0) {
    throw new Error(`Observed ${summary.staleCommitCount} stale renderer commits.`);
  }
  if ((summary.inputTransactions?.samples ?? 0) < requiredSamples) {
    throw new Error(`Expected at least ${requiredSamples} editor input transaction samples, received ${summary.inputTransactions?.samples ?? 0}.`);
  }
  if ((summary.inputTransactions?.p95 ?? Number.POSITIVE_INFINITY) > 16) {
    throw new Error(`10k-line editor input transaction p95 exceeded 16ms: ${summary.inputTransactions.p95}ms.`);
  }
  if ((summary.stages.preview_shell_committed?.p95 ?? Number.POSITIVE_INFINITY) > 16) {
    throw new Error(`Explorer selection p95 exceeded 16ms: ${summary.stages.preview_shell_committed.p95}ms.`);
  }
  if ((summary.stages.editor_base_ready?.p95 ?? Number.POSITIVE_INFINITY) > 50) {
    throw new Error(`Click-to-editor-base p95 exceeded 50ms: ${summary.stages.editor_base_ready.p95}ms.`);
  }
  if (
    report.environment.coldFirstOpen
    && (summary.stages.preview_ready?.p95 ?? Number.POSITIVE_INFINITY) > 150
  ) {
    throw new Error(`Cold click-to-preview p95 exceeded 150ms: ${summary.stages.preview_ready.p95}ms.`);
  }
  if (summary.longTasks.over50ms > 0) {
    throw new Error(`Observed ${summary.longTasks.over50ms} renderer long tasks over 50ms.`);
  }
  if (report.environment.oversizedBlocks) {
    const table = summary.structural?.oversizedTable;
    if (!table) throw new Error("Oversized-table structural result is missing.");
    if (table.logicalRows !== 1_001) {
      throw new Error(`Expected 1001 logical table rows, received ${table.logicalRows}.`);
    }
    if (table.mountedRowsInitial > 80 || table.mountedRowsAfterScroll > 80) {
      throw new Error(
        `Oversized-table DOM bound exceeded 80 rows (${table.mountedRowsInitial}/${table.mountedRowsAfterScroll}).`,
      );
    }
    if (table.virtualStartAfterScroll <= 0) {
      throw new Error("Oversized-table row window did not advance after document scrolling.");
    }
  }
}

function resolveOutputPath(args) {
  const outputIndex = args.indexOf("--outputJson");
  const requested = outputIndex >= 0 ? args[outputIndex + 1] : null;
  return path.resolve(requested || path.join(repoRoot, `artifacts/tests/performance/renderer-smoke-${Date.now()}-${randomUUID()}.json`));
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
  // Publish before destroying the last BrowserWindow: on macOS the Electron
  // process may terminate its lifecycle before later asynchronous work runs.
  window?.destroy();
  await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  app.exit(exitCode);
}

app.whenReady().then(runSmoke).then(() => finish(0)).catch(async (error) => {
  console.error(error);
  await finish(1, error);
});
