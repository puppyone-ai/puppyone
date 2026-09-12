#!/usr/bin/env electron

import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import JSZip from "jszip";
import { createGitDiffResourceBroker } from "../../../../electron/main/git-diff-resource-broker.mjs";
import { registerWorkspaceGitIpcHandlers } from "../../../../electron/main/ipc/workspace-git-ipc.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "puppyone-format-diff-smoke-"));
const workspacePath = path.join(tempRoot, "workspace");
const userDataPath = path.join(tempRoot, "user-data");
const preloadPath = path.join(repoRoot, "electron", "preload.cjs");
const broker = createGitDiffResourceBroker();
const windows = [];

await fsp.mkdir(workspacePath, { recursive: true });
await fsp.mkdir(userDataPath, { recursive: true });
app.setPath("userData", userDataPath);
app.commandLine.appendSwitch("disable-gpu");

async function runSmoke() {
  await initializeFixture();
  registerWorkspaceGitIpcHandlers({
    ipcMain,
    BrowserWindow,
    dialog,
    gitDiffResourceBroker: broker,
    authorizeWorkspaceRoot: async (_event, requestedRoot) => {
      if (requestedRoot !== workspacePath) throw new Error("Smoke workspace authorization failed closed.");
      return workspacePath;
    },
  });

  const owner = await createWindow("owner");
  const other = await createWindow("other");
  const sessionId = "git-diff-session:electron-smoke";
  const detail = await owner.webContents.executeJavaScript(`
    window.puppyoneDesktop.getGitFileDiff(${JSON.stringify({
      rootPath: workspacePath,
      path: "report.docx",
      scope: "unstaged",
      requestId: "electron-smoke-request",
      sessionId,
    })})
  `, true);
  const file = detail.files?.find((candidate) => candidate.path === "report.docx");
  const pair = file?.revisionPair;
  if (pair?.before?.kind !== "resource" || pair?.after?.kind !== "resource") {
    throw new Error("Electron smoke did not receive two opaque DOCX resource descriptors.");
  }
  if ("bytes" in pair.before || "bytes" in pair.after) {
    throw new Error("Electron smoke leaked revision bytes in the detail response.");
  }

  const crossAudienceError = await other.webContents.executeJavaScript(`
    window.puppyoneDesktop.readGitDiffResource(${JSON.stringify({
      handle: pair.before.handle,
      sessionId,
      selectionIdentity: pair.selectionIdentity,
      revisionIdentity: pair.before.identity,
      offset: 0,
      length: 1,
    })}).then(() => "unexpected-success", (error) => String(error?.message || error))
  `, true);
  if (!/audience|another renderer|another window/i.test(crossAudienceError)) {
    throw new Error(`Cross-renderer resource read did not fail closed: ${crossAudienceError}`);
  }

  const readSummary = await owner.webContents.executeJavaScript(`
    (async () => {
      const pair = ${JSON.stringify(pair)};
      const summaries = [];
      for (const side of [pair.before, pair.after]) {
        let offset = 0;
        let checksum = 0;
        let chunks = 0;
        while (offset < side.size) {
          const result = await window.puppyoneDesktop.readGitDiffResource({
            handle: side.handle,
            sessionId: pair.sessionId,
            selectionIdentity: pair.selectionIdentity,
            revisionIdentity: side.identity,
            offset,
            length: Math.min(4 * 1024 * 1024, side.size - offset),
          });
          if (result.offset !== offset || result.size !== side.size) throw new Error("range mismatch");
          for (const value of result.bytes) checksum = (checksum + value) >>> 0;
          offset += result.bytes.byteLength;
          chunks += 1;
          if (result.done !== (offset === side.size)) throw new Error("completion mismatch");
        }
        summaries.push({ size: side.size, chunks, checksum });
      }
      await window.puppyoneDesktop.releaseGitDiffResources({ sessionId: pair.sessionId });
      const revokedError = await window.puppyoneDesktop.readGitDiffResource({
        handle: pair.before.handle,
        sessionId: pair.sessionId,
        selectionIdentity: pair.selectionIdentity,
        revisionIdentity: pair.before.identity,
        offset: 0,
        length: 1,
      }).then(() => "unexpected-success", (error) => String(error?.message || error));
      return { summaries, revokedError };
    })()
  `, true);
  if (readSummary.summaries.some((side) => side.chunks < 2 || side.size <= 4 * 1024 * 1024)) {
    throw new Error("Electron smoke did not exercise multi-chunk revision reads.");
  }
  if (!/revoked|unknown|expired/i.test(readSummary.revokedError)) {
    throw new Error(`Released resource remained readable: ${readSummary.revokedError}`);
  }
  if (broker.getUsage().bytes !== 0) throw new Error("Broker retained bytes after renderer release.");

  console.log(JSON.stringify({
    ok: true,
    selectionIdentity: pair.selectionIdentity,
    chunks: readSummary.summaries.map((side) => side.chunks),
    bytes: readSummary.summaries.map((side) => side.size),
  }, null, 2));
}

async function initializeFixture() {
  await runGit(["init"]);
  await runGit(["config", "user.name", "PuppyOne Smoke"]);
  await runGit(["config", "user.email", "smoke@puppyone.invalid"]);
  await fsp.writeFile(path.join(workspacePath, "report.docx"), await createDocx("Before revision", 17));
  await runGit(["add", "report.docx"]);
  await runGit(["commit", "-m", "fixture"]);
  await fsp.writeFile(path.join(workspacePath, "report.docx"), await createDocx("After revision", 29));
}

async function createDocx(text, fillByte) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("_rels/.rels", "<Relationships/>");
  zip.file(
    "word/document.xml",
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  zip.file("word/media/padding.bin", new Uint8Array(4 * 1024 * 1024 + 256).fill(fillByte));
  return zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
}

async function runGit(args) {
  await execFileAsync("git", args, { cwd: workspacePath });
}

async function createWindow(label) {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  windows.push(window);
  await window.loadURL(`data:text/html,<title>${label}</title>`);
  return window;
}

async function finish() {
  broker.dispose();
  for (const window of windows) window.destroy();
  await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  app.quit();
}

app.whenReady().then(async () => {
  try {
    await runSmoke();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await finish();
  }
}).catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
  await finish();
});
