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
import { conversionTablePdf, conversionCjkPdf, conversionScanPdf, conversionRasterPdf } from "../../../support/editor/conversionSamples.mjs";
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
for (const name of ["english", "chinese", "mixed", "table"]) await fs.writeFile(path.join(project, `OCR-${name}.pdf`), conversionRasterPdf(await fs.readFile(path.join(repo, `tests/fixtures/editor/conversion/${name}.png`))));
await fs.writeFile(path.join(project, "OCR-native-and-scan.pdf"), conversionRasterPdf(await fs.readFile(path.join(repo, "tests/fixtures/editor/conversion/mixed.png")), true));
await fs.writeFile(path.join(project, "OCR-header-and-scan.pdf"), conversionRasterPdf(await fs.readFile(path.join(repo, "tests/fixtures/editor/conversion/mixed.png")), false, true));
await fs.writeFile(path.join(project, "使用说明.md"), "# 文档转换体验\n\n打开 DOCX 或 PDF，点击「转换」。可以对照原文查看 Markdown 和表格，再点击「保存并打开」。\n\n- 示例报告.docx：包含正文、图片和表格。\n- 表格示例.pdf：可提取文本和表格。\n- 中文示例.pdf：检查原有中文文字。\n- OCR-english/chinese/mixed/table.pdf：真实图片扫描页，分别验证英文、中文、混排和表格。\n- OCR-native-and-scan.pdf：原有文字和扫描页混合。\n- 扫描页示例.pdf：空白图形页，检查未找到文字时的提示。\n\n结果统一保存在项目根目录 converted/。也可以在这个窗口打开你自己的项目和文档。\n");
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
async function convert(name, language = "chi_sim+eng", mode = "auto") {
  console.log("Conversion acceptance: opening", name);
  await openFile(name); await click(".document-conversion__toolbar .document-conversion__button");
  if (name.endsWith(".pdf")) await evaluate(`(() => {const selects=document.querySelectorAll('.document-conversion__ocr-options select'); for (const [index,value] of [[0,${JSON.stringify(mode)}],[1,${JSON.stringify(language)}]]) {selects[index].value=value; selects[index].dispatchEvent(new Event('change',{bubbles:true}));}})()`);
  await click(".document-conversion__footer .document-conversion__button--primary");
  await until(() => evaluate("Boolean(document.querySelector('.document-conversion__summary, .document-conversion__error'))"), `result ${name}`);
  console.log("Conversion acceptance: result", name);
}
const timer = setTimeout(() => { console.error("Document conversion acceptance exceeded deadline"); app.exit(1); }, 300_000);
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
    const output = path.join(project, "converted", "示例报告");
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
    const recognized = [];
    for (const [name, language, phrases] of [["english", "eng", ["Document conversion test", "Hello world", "0012", "1234.50"]], ["chinese", "chi_sim", ["文档转换测试", "中文识别", "0012", "1234.50"]], ["mixed", "chi_sim+eng", ["文档转换", "Document conversion", "Local OCR", "0012", "1234.50"]], ["table", "eng", ["0012", "1234.50", "0013", "5678.90"]], ["native-and-scan", "chi_sim+eng", ["Native page before scanned content.", "文档转换", "Local OCR"]], ["header-and-scan", "chi_sim+eng", ["Native header", "文档转换", "Local OCR"]]]) {
      await convert(`OCR-${name}.pdf`, language);
      assert.equal(await evaluate("Boolean(document.querySelector('.document-conversion__summary'))"), true, await evaluate("document.querySelector('.document-conversion__error')?.textContent"));
      await click('.document-conversion__tabs .document-conversion__text-button');
      const text = (await evaluate("document.querySelector('.document-conversion__source-text').textContent")).replace(/\\/g, "");
      for (const phrase of phrases) assert(text.includes(phrase), `${name}: missing ${phrase}: ${text}`);
      if (name === "native-and-scan") assert(text.indexOf("Native page") < text.indexOf("文档转换"));
      await click(".document-conversion__footer .document-conversion__button--primary");
      const savedFolder = path.join(project, "converted", `OCR-${name}`);
      await until(async () => { try { return await fs.readFile(path.join(savedFolder, `OCR-${name}.md`), "utf8"); } catch { return false; } }, `OCR ${name} saved`);
      const savedText = (await fs.readFile(path.join(savedFolder, `OCR-${name}.md`), "utf8")).replace(/\\/g, "");
      for (const phrase of phrases) assert(savedText.includes(phrase));
      if (name === "table") {
        const csvFiles = await fs.readdir(path.join(savedFolder, "tables"));
        assert(csvFiles.length > 0, "OCR table CSV saved");
        const csv = await fs.readFile(path.join(savedFolder, "tables", csvFiles[0]), "utf8");
        for (const phrase of phrases) assert(csv.includes(phrase), `CSV missing ${phrase}`);
      }
      await until(() => evaluate("!document.querySelector('.document-conversion--expanded')"), "OCR saved Markdown opened");
      recognized.push({ name, language, phrases });
    }
    await openFile("OCR-chinese.pdf"); await click(".document-conversion__toolbar .document-conversion__button");
    await click(".document-conversion__footer .document-conversion__button--primary");
    await until(() => evaluate("Boolean(document.querySelector('[data-conversion-stage=ocr]'))"), "OCR running before cancel");
    await click(".document-conversion__footer .document-conversion__button");
    await wait(200);
    assert.equal(await evaluate("Boolean(document.querySelector('.document-conversion__summary'))"), false, "cancel publishes no result");
    await click(".document-conversion__footer .document-conversion__button--primary");
    await until(() => evaluate("Boolean(document.querySelector('.document-conversion__summary'))"), "OCR retry after cancel");
    await wait(300); // Let the compositor paint the completed result before capturing it.
    await fs.writeFile(path.join(artifacts, "ocr.png"), (await window.webContents.capturePage()).toPNG());
    clearTimeout(timer);
    const sourceAfter = await readSourceIdentity(repo);
    const receipt = { passed: source.fingerprint === sourceAfter.fingerprint, project, source, sourceAfter,
      checks: ["real-docx-worker", "generated-image-native-save", "csv-native-save", "saved-result-open", "pdf-table", "pdf-cjk-cmap", "blank-ocr-error", "real-english-ocr", "real-chinese-ocr", "real-mixed-ocr", "ocr-table-csv", "mixed-native-and-scan-order", "native-header-and-scanned-body", "ocr-cancel-retry"], recognized };
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
