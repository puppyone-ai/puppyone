import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readSourceIdentity } from "../../../scripts/release-checks/execution.mjs";

const execute = promisify(execFile);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(read, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await read(); if (value) return value; await wait(50); }
  throw new Error(`Native acceptance timed out: ${label}`);
}
async function bounds(window, selector, index = 0) {
  return until(() => window.webContents.executeJavaScript(`(() => {
    const element = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return r.width && r.height ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  })()`), selector);
}
function point(window, rect, x = 0.5, y = 0.5) {
  const content = window.getContentBounds();
  return [Math.round(content.x + rect.x + rect.width * x), Math.round(content.y + rect.y + rect.height * y)];
}

/** Uses CoreGraphics at the OS boundary. No DOM drag dispatch or sendInputEvent. */
export async function runNativeResourceAcceptance({ windows, entries, temporaryRoot, repoRoot, editorMode, attachPdf }) {
  assert.equal(process.platform, "darwin", "Native resource acceptance requires macOS.");
  const source = await readSourceIdentity(repoRoot);
  const artifactRoot = path.join(repoRoot, "artifacts/tests/native-resource-drag");
  await fs.mkdir(artifactRoot, { recursive: true });
  const directory = await fs.mkdtemp(path.join(artifactRoot, `${Date.now()}-`));
  const binary = path.join(temporaryRoot, "native-input");
  await execute("clang", [path.join(repoRoot, "tests/support/electron/macos-native-input.c"), "-framework", "ApplicationServices", "-o", binary]);
  const steps = [];
  let failure;
  try {
    const drag = async (from, to) => {
      await execute(binary, [...from, ...to].map(String), { timeout: 10_000 });
      await wait(350);
    };
    if (!editorMode) {
      const [origin, receiver] = windows;
      const destination = point(receiver, await bounds(receiver, "pre"));
      for (const [index, count] of [1, 1, 2].entries()) {
        const start = entries.length;
        await drag(point(origin, await bounds(origin, '[draggable="true"]', index)), destination);
        const received = await until(() => entries.slice(start).find((entry) => entry.files?.length), `native Files payload ${index}`);
        assert.equal(received.files.length, count);
        assert(received.types.includes("Files"));
        assert(received.files.every((file) => path.isAbsolute(file.path)));
        const claimed = await until(() => entries.slice(start).find((entry) => entry.claimed), `claim ${index}`);
        assert.equal(claimed.claimed.kind, "workspace-entries");
        assert.equal(claimed.claimed.entries.length, count);
        assert(claimed.claimed.entries.every((entry) => entry.path.startsWith("puppyone-local://workspace/smoke-root/")));
        steps.push({ name: ["file", "directory", "multiple"][index], received, claimed });
      }
    } else {
      const [window] = windows;
      await until(() => entries.some((entry) => entry.panes?.length === 1), "initial editor pane");
      const sourceRect = await bounds(window, '[data-explorer-path*="%E4%B8%AD"]');
      const targetRect = await bounds(window, "[data-editor-pane-id]");
      const pdf = attachPdf ? await attachPdf(window, targetRect) : null;
      if (pdf) {
        assert.equal(pdf.status, "ready");
        steps.push({ name: "native-pdf-ready", status: pdf.status, bounds: targetRect });
      }
      const start = entries.length;
      // Aim inside the native content area, below the pane's DOM title bar.
      await drag(point(window, sourceRect), point(window, targetRect, 0.9, 0.6));
      await until(() => entries.slice(start).some((entry) => entry.panes?.length === 2), "Files → claim → pane split");
      const dropped = entries.slice(start).find((entry) => entry.event === "drop");
      assert(dropped?.types.includes("Files"), "Editor did not receive genuine native Files.");
      assert.equal(dropped.files.length, 1);
      const layout = entries.findLast((entry) => entry.panes);
      assert.equal(layout.editors.length, 2);
      steps.push({ name: "editor-split", dropped, layout });
      await drag(point(window, sourceRect), point(window, await bounds(window, "[data-editor-pane-id]"), 0.9, 0.6));
      assert.equal(entries.findLast((entry) => entry.panes).panes.length, 2, "Repeated drop duplicated a pane.");
      steps.push({ name: "repeat-focus", paneCount: 2 });
      // Releasing over non-target chrome cancels the transfer without mutation.
      await drag(point(window, sourceRect), point(window, { x: 0, y: 0, width: 220, height: 30 }));
      await until(() => entries.findLast((entry) => entry.pointerPassthrough)?.pointerPassthrough.active === false, "cancel routing release");
      assert.equal(entries.findLast((entry) => entry.panes).panes.length, 2);
      if (pdf) {
        await until(() => !pdf.entry.occluded && pdf.entry.view.getVisible(), "PDF restored after drop/cancel");
        assert.equal(pdf.entry.view.webContents.isDestroyed(), false);
      }
      steps.push({ name: "cancel-cleanup", restoredPdf: Boolean(pdf) });
    }
    for (const [index, window] of windows.entries()) await fs.writeFile(path.join(directory, `window-${index}.png`), (await window.webContents.capturePage()).toPNG());
  } catch (error) { failure = error; }
  const sourceAfter = await readSourceIdentity(repoRoot);
  if (source.fingerprint !== sourceAfter.fingerprint) failure ??= new Error("Source changed during native acceptance.");
  await fs.writeFile(path.join(directory, "result.json"), JSON.stringify({
    ok: !failure, source, sourceAfter, system: { platform: process.platform, arch: process.arch, release: os.release(), electron: process.versions.electron },
    input: "CoreGraphics CGHIDEventTap", editorMode, pdf: Boolean(attachPdf), steps, entries,
    error: failure?.stack ?? null,
  }, null, 2));
  console.log(`NATIVE_RESOURCE_ACCEPTANCE ${directory}`);
  if (failure) throw failure;
}
