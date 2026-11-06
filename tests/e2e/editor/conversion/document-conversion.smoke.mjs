#!/usr/bin/env electron
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { workspaceFromPath } from "../../../../electron/local-api/workspace.mjs";
import { createWorkspaceStateStore } from "../../../../electron/main/workspace-state-store.mjs";
import { getDesktopBuildChannelPolicy } from "../../../../shared/desktop-build-identity.mjs";
import { readSourceIdentity } from "../../../../scripts/release-checks/execution.mjs";
import { conversionTablePdf, conversionCjkPdf, conversionScanPdf } from "../../../support/editor/conversionSamples.mjs";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const source = await readSourceIdentity(repo);
const keepOpen = process.argv.includes("--keep-open");
if (keepOpen) process.argv.splice(process.argv.indexOf("--keep-open"), 1);
const artifacts = path.join(repo, "artifacts/tests/editor/document-conversion", String(Date.now()));
await fs.mkdir(artifacts, { recursive: true });
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-conversion-preview-"));
const project = path.join(temporary, "转换示例"); await fs.mkdir(project);
await fs.copyFile(path.join(repo, "tests/fixtures/editor/formats/samples/puppyone-preview-sample.docx"), path.join(project, "示例报告.docx"));
await fs.writeFile(path.join(project, "表格示例.pdf"), conversionTablePdf());
await fs.writeFile(path.join(project, "中文示例.pdf"), conversionCjkPdf());
await fs.writeFile(path.join(project, "扫描页示例.pdf"), conversionScanPdf());
await fs.writeFile(path.join(project, "使用说明.md"), "# 文档转换体验\n\n打开 DOCX 或 PDF，点击「转换」。可以对照原文查看 Markdown 和表格，再点击「保存并打开」。\n\n- 示例报告.docx：包含正文、图片和表格。\n- 表格示例.pdf：可提取文本和表格。\n- 中文示例.pdf：检查中文文字。\n- 扫描页示例.pdf：会提示需要 OCR。\n\n也可以在这个窗口打开你自己的项目和文档。\n");
app.setAppPath(repo);
app.setPath("appData", path.join(temporary, "app-data"));
app.setPath("userData", path.join(app.getPath("appData"), getDesktopBuildChannelPolicy("dev").userDataName));
await fs.mkdir(app.getPath("userData"), { recursive: true });
const registry = createWorkspaceStateStore({ app, filename: "desktop-workspace-state.json", canonicalizeWorkspacePath: root => fs.realpath(root), workspaceFromPath });
await registry.rememberWorkspaceComposition([await workspaceFromPath(project)]);
process.argv.push(project);
app.on("browser-window-created", (_event, window) => {
  const setTitle = window.setTitle.bind(window);
  window.setTitle = title => setTitle("[document-conversion] " + String(title).replace(/^\[document-conversion\] /, ""));
  window.on("page-title-updated", (event, title) => { event.preventDefault(); window.setTitle(title); });
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let window;
const evaluate = code => window.webContents.executeJavaScript(code, true);
async function until(read, label) {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) { const value = await read(); if (value) return value; await wait(50); }
  throw new Error(`Document conversion acceptance timed out: ${label}`);
}
async function click(selector) {
  await until(() => evaluate(`(() => { const element=document.querySelector(${JSON.stringify(selector)}); return element && !element.disabled; })()`), selector);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
}
const openFile = name => click(`.tree-row.file[aria-label="${name}"]`);
async function convert(name) {
  console.log("Conversion acceptance: opening", name);
  await openFile(name); await click(".document-conversion__toolbar .document-conversion__button");
  await click(".document-conversion__footer .document-conversion__button--primary");
  await until(() => evaluate("Boolean(document.querySelector('.document-conversion__summary, .document-conversion__error'))"), `result ${name}`);
  console.log("Conversion acceptance: result", name);
}
const timer = setTimeout(() => { console.error("Document conversion acceptance exceeded deadline"); app.exit(1); }, 180_000);
await import("../../../../electron/main.mjs");
app.whenReady().then(async () => {
  try {
    window = await until(() => BrowserWindow.getAllWindows()[0], "main window");
    window.setSize(1440, 940); window.show(); window.focus();
    await until(() => evaluate("Boolean(document.querySelector('.app-shell'))"), "App ready");
    await convert("示例报告.docx");
    assert.equal(await evaluate("Boolean(document.querySelector('.document-conversion__summary'))"), true, await evaluate("document.querySelector('.document-conversion__error')?.textContent"));
    await until(() => evaluate("Boolean(document.querySelector('.document-conversion__result .cm-editor'))"), "Markdown preview");
    await click(".document-conversion__footer .document-conversion__button--primary");
    console.log("Conversion acceptance: saving DOCX outputs");
    await until(async () => { try { return (await fs.readdir(project)).some(name => name.endsWith("-converted")); } catch { return false; } }, "saved folder");
    const output = path.join(project, "示例报告-converted");
    await until(async () => { try { return (await fs.readdir(path.join(output, "assets"))).length; } catch { return false; } }, "image saved");
    assert((await fs.readFile(path.join(output, "示例报告.md"), "utf8")).includes("assets/image-"));
    assert((await fs.readdir(path.join(output, "tables"))).some(name => name.endsWith(".csv")));
    await until(() => evaluate("!document.querySelector('.document-conversion--expanded')"), "saved Markdown opened");
    await convert("表格示例.pdf");
    assert.equal(await evaluate("Boolean(document.querySelector('.document-conversion__summary'))"), true, await evaluate("document.querySelector('.document-conversion__error')?.textContent"));
    await click('.document-conversion__tab:nth-child(2)');
    assert((await evaluate("document.querySelector('.document-conversion__result').textContent")).includes("0012"));
    await convert("中文示例.pdf");
    assert.equal(await evaluate("Boolean(document.querySelector('.document-conversion__summary'))"), true, await evaluate("document.querySelector('.document-conversion__error')?.textContent"));
    await until(() => evaluate("document.querySelector('.document-conversion__result')?.textContent.includes('文档转换测试')"), "CJK text preserved");
    await convert("扫描页示例.pdf");
    assert((await evaluate("document.querySelector('.document-conversion__error')?.textContent")).includes("OCR"));
    await convert("示例报告.docx");
    clearTimeout(timer);
    const sourceAfter = await readSourceIdentity(repo);
    const receipt = { passed: source.fingerprint === sourceAfter.fingerprint, project, source, sourceAfter,
      checks: ["real-docx-worker", "generated-image-native-save", "csv-native-save", "saved-result-open", "pdf-table", "pdf-cjk-cmap", "scan-ocr-error"] };
    await fs.writeFile(path.join(artifacts, "result.json"), JSON.stringify(receipt, null, 2));
    assert(receipt.passed, "Source changed during desktop acceptance");
    console.log(JSON.stringify({ ...receipt, artifacts }));
    if (!keepOpen) { window.destroy(); await fs.rm(temporary, { recursive: true, force: true }); app.exit(0); }
  } catch (error) {
    clearTimeout(timer); console.error(error);
    if (window) console.error(await evaluate("document.querySelector('.document-conversion')?.textContent ?? document.body.textContent.slice(0,1200)"));
    app.exit(1);
  }
});
