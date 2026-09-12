#!/usr/bin/env electron

import { app, BrowserWindow } from "electron";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const indexPath = path.join(repoRoot, "dist", "index.html");
const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "puppyone-markdown-theme-inheritance-"));
app.setPath("userData", path.join(tempRoot, "user-data"));
app.commandLine.appendSwitch("disable-gpu");

const windows = [];

async function runSmoke() {
  await fsp.access(indexPath);
  const followTheme = await runScenario("theme");
  assert(followTheme.before.editorContentFontMode === "follow-theme", "Follow-theme scenario started with a user font override.");
  assert(
    followTheme.after.fontFamily.includes("PuppyOne PT Serif")
      && followTheme.after.fontFamily.includes("Songti SC"),
    `Newspaper did not reach the mounted Markdown editor: ${followTheme.after.fontFamily}`,
  );
  assert(
    followTheme.after.hostFont.includes("PuppyOne PT Serif")
      && followTheme.after.hostFont.includes("Songti SC"),
    `Newspaper host font token was not projected: ${followTheme.after.hostFont}`,
  );
  assert(followTheme.preservedHost, "Changing Sub Theme remounted the Markdown editor.");
  assert(
    followTheme.after.fontFamily !== followTheme.before.fontFamily,
    "Mounted Markdown typography did not react to the Sub Theme change.",
  );

  const explicitSystem = await runScenario("system");
  assert(
    explicitSystem.before.editorContentFontMode === "explicit"
      && explicitSystem.before.editorContentFont === "builtin:system-sans",
    "Explicit-font scenario did not publish its override identity.",
  );
  assert(
    !explicitSystem.after.fontFamily.includes("PuppyOne PT Serif")
      && explicitSystem.after.fontFamily.includes("system-ui"),
    `Explicit Markdown font did not retain precedence: ${explicitSystem.after.fontFamily}`,
  );
  assert(
    explicitSystem.after.hostFont.includes("PuppyOne PT Serif"),
    "Newspaper host token disappeared when a user override was active.",
  );
  assert(explicitSystem.preservedHost, "Explicit-font theme change remounted the Markdown editor.");

  console.log(JSON.stringify({ followTheme, explicitSystem }, null, 2));
}

async function runScenario(font) {
  const window = new BrowserWindow({
    show: false,
    width: 900,
    height: 620,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  windows.push(window);
  const url = pathToFileURL(indexPath);
  url.searchParams.set("font", font);
  url.hash = "markdown-theme-inheritance-smoke";
  await window.loadURL(url.toString());
  await waitForReady(window);

  const before = await readSnapshot(window, true);
  await window.webContents.executeJavaScript(
    "document.querySelector('[data-smoke-select-newspaper=true]').click()",
    true,
  );
  await waitForSubTheme(window, "default.newspaper");
  await window.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    true,
  );
  const after = await readSnapshot(window, false);
  window.hide();
  return {
    before,
    after,
    preservedHost: after.preservedHost,
  };
}

async function readSnapshot(window, captureHost) {
  return window.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-po-appearance-root=true]');
    const host = document.querySelector('.markdown-codemirror-editor[data-preview-state=ready]');
    const content = host?.querySelector('.cm-content');
    if (!root || !host || !content) throw new Error('Markdown appearance smoke is missing its production surface.');
    if (${captureHost ? "true" : "false"}) window.__PUPPYONE_MARKDOWN_THEME_HOST__ = host;
    const rootStyle = getComputedStyle(root);
    return {
      subThemeId: root.dataset.subThemeId,
      editorContentFontMode: root.dataset.fontEditorContentMode,
      editorContentFont: root.dataset.fontEditorContent,
      hostFont: rootStyle.getPropertyValue('--po-host-md-content-font').trim(),
      fontFamily: getComputedStyle(content).fontFamily,
      preservedHost: window.__PUPPYONE_MARKDOWN_THEME_HOST__ === host,
    };
  })()`, true);
}

async function waitForReady(window) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const ready = await window.webContents.executeJavaScript(
      "Boolean(document.querySelector('.markdown-codemirror-editor[data-preview-state=ready]'))",
      true,
    );
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Markdown theme inheritance smoke did not become ready within 20 seconds.");
}

async function waitForSubTheme(window, expected) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const actual = await window.webContents.executeJavaScript(
      "document.querySelector('[data-po-appearance-root=true]')?.dataset.subThemeId ?? null",
      true,
    );
    if (actual === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Markdown theme inheritance smoke did not switch to ${expected}.`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function finish(exitCode) {
  for (const window of windows) {
    if (!window.isDestroyed()) window.destroy();
  }
  await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  app.exit(exitCode);
}

app.whenReady().then(runSmoke).then(() => finish(0)).catch(async (error) => {
  console.error(error);
  await finish(1);
});
