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
export async function runNativeResourceAcceptance({ windows, entries, temporaryRoot, repoRoot, editorMode, imageMode = false, attachPdf }) {
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
        assert(received.types.includes("text/plain"), "Native takeover dropped the path text representation.");
        assert.equal(received.text, received.files.map((file) => file.path).join("\n"),
          "Native path text must contain every selected absolute path once, never file contents.");
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
      assert(layout.panes[0].editorId.endsWith("/existing.md"), "Right split replaced or moved the original document.");
      assert(layout.panes[1].editorId.includes("/docs/"), "Right split did not put the dropped file on the right.");
      steps.push({ name: "editor-split", dropped, layout });
      await drag(point(window, sourceRect), point(window, await bounds(window, "[data-editor-pane-id]"), 0.9, 0.6));
      assert.equal(entries.findLast((entry) => entry.panes).panes.length, 2, "Repeated drop duplicated a pane.");
      steps.push({ name: "repeat-focus", paneCount: 2 });
      let expectedPaneCount = 2;
      if (imageMode) {
        const imageSource = await bounds(window, '[data-explorer-path*="photo%20"]');
        const editorPane = await bounds(window, "[data-editor-pane-id]");
        const start = entries.length;
        await drag(point(window, imageSource), point(window, editorPane, 0.5, 0.6));
        const saved = await until(() => entries.slice(start).find(entry => entry.persisted && entry.content?.includes("![photo #1%]")), "image inserted and persisted");
        assert(saved.content.includes("(<assets/photo %231%25.png>)"), "Image path was not portable or escaped correctly.");
        assert.equal(entries.findLast(entry => entry.panes).panes.length, expectedPaneCount, "Inline insertion created another pane.");
        const received = entries.slice(start).find(entry => entry.event === "drop");
        assert(received?.types.includes("Files"), "Image did not arrive through a native Files drop.");
        const onDisk = await fs.readFile(path.join(temporaryRoot, "existing.md"), "utf8");
        assert.equal(onDisk, saved.content);
        assert(await window.webContents.executeJavaScript(`Boolean(document.activeElement?.closest('.markdown-codemirror-editor'))`), "Inserted image did not hand keyboard focus to the editor.");
        await until(() => window.webContents.executeJavaScript(`Boolean(document.querySelector('.cm-md-image-widget img[data-preview-state="ready"]'))`), "rendered image preview");
        await fs.writeFile(path.join(directory, "inline-image.png"), (await window.webContents.capturePage()).toPNG());
        steps.push({ name: "inline-image", received, saved });
        await drag(point(window, imageSource), point(window, await bounds(window, "[data-editor-pane-id]"), 0.9, 0.6));
        expectedPaneCount += 1;
        await until(() => entries.findLast(entry => entry.panes).panes.length === expectedPaneCount, "image edge split");
        const imageLayout = entries.findLast(entry => entry.panes);
        assert(imageLayout.panes[1].editorId.includes("/assets/"), "Image did not split to the right of its target pane.");
        steps.push({ name: "image-edge-split", paneCount: expectedPaneCount, layout: imageLayout });

        // Outside the visible cards, the same image must still insert.
        const outsideStart = entries.length;
        await drag(point(window, imageSource), point(window, await bounds(window, "[data-editor-pane-id]"), 0.85, 0.15));
        const outsideSaved = await until(() => entries.slice(outsideStart).find(entry => entry.persisted
          && (entry.content?.match(/!\[photo #1%\]/g) ?? []).length === 2), "image insertion outside visible split cards");
        assert.equal(entries.findLast(entry => entry.panes).panes.length, expectedPaneCount);
        assert.equal(await fs.readFile(path.join(temporaryRoot, "existing.md"), "utf8"), outsideSaved.content);
        steps.push({ name: "outside-card-insert", paneCount: expectedPaneCount, saved: outsideSaved });

        const leftSource = await bounds(window, '[data-explorer-path$="/left.md"]');
        const leftStart = entries.length;
        await drag(point(window, leftSource), point(window, await bounds(window, "[data-editor-pane-id]"), 0.1, 0.6));
        expectedPaneCount += 1;
        await until(() => entries.findLast(entry => entry.panes).panes.length === expectedPaneCount, "left card split");
        const leftLayout = entries.findLast(entry => entry.panes);
        assert(leftLayout.panes[0].editorId.endsWith("/left.md"), "Left split did not put the dropped file before its target.");
        assert(leftLayout.panes[1].editorId.endsWith("/existing.md"), "Left split lost its original target pane.");
        assert(entries.slice(leftStart).some(entry => entry.event === "drop" && entry.types.includes("Files")), "Left card did not receive native Files.");
        steps.push({ name: "left-card-split", layout: leftLayout });
      }
      // Releasing over non-target chrome cancels the transfer without mutation.
      await drag(point(window, sourceRect), point(window, { x: 0, y: 0, width: 220, height: 30 }));
      await until(() => entries.findLast((entry) => entry.pointerPassthrough)?.pointerPassthrough.active === false, "cancel routing release");
      assert.equal(entries.findLast((entry) => entry.panes).panes.length, expectedPaneCount);
      await until(() => window.webContents.executeJavaScript("document.querySelectorAll('[data-file-split-targets], [data-drop-target], [data-drop-kind]').length === 0"), "cancelled split card cleanup");
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
    input: "CoreGraphics CGHIDEventTap", editorMode, imageMode, pdf: Boolean(attachPdf), steps, entries,
    error: failure?.stack ?? null,
  }, null, 2));
  console.log(`NATIVE_RESOURCE_ACCEPTANCE ${directory}`);
  if (failure) throw failure;
}
