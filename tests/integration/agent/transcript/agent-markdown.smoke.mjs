#!/usr/bin/env electron

import { app, BrowserWindow, ipcMain, WebContentsView, session } from "electron";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createMermaidRendererHost } from "../../../../electron/main/mermaid/renderer-host.mjs";
import { createMermaidRenderService } from "../../../../electron/main/mermaid/render-service.mjs";
import { registerMermaidIpc } from "../../../../electron/main/ipc/mermaid-ipc.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const indexPath = path.join(repoRoot, "dist", "index.html");
const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "puppyone-agent-markdown-"));
app.setPath("userData", path.join(tempRoot, "user-data"));
app.commandLine.appendSwitch("disable-renderer-backgrounding");
// Keep explicit success/failure ownership through async host and profile cleanup.
app.on("window-all-closed", () => {});

let ownerWindow = null;
let renderProcessFailure = null;
let mermaidService = null;

async function runSmoke() {
  await fsp.access(indexPath);
  mermaidService = createMermaidRenderService({ createHost: () => createMermaidRendererHost({
    WebContentsView, session,
    url: pathToFileURL(path.join(repoRoot, "dist/src/platform/mermaid/host.html")).href,
    assetRoot: pathToFileURL(path.join(repoRoot, "dist/")).href,
    preload: path.join(repoRoot, "electron/mermaid-preload.cjs"),
  }) });
  registerMermaidIpc({ ipcMain, service: mermaidService });
  ownerWindow = new BrowserWindow({
    show: false,
    width: 760,
    height: 900,
    webPreferences: {
      preload: path.join(repoRoot, "tests/support/agent/mermaid-smoke-preload.cjs"),
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  ownerWindow.webContents.on("render-process-gone", (_event, details) => {
    renderProcessFailure = `${details.reason}:${details.exitCode}`;
  });

  for (const theme of ["light", "dark"]) await inspectTheme(theme);
}

async function inspectTheme(theme) {
  const url = pathToFileURL(indexPath);
  url.searchParams.set("theme", theme);
  url.searchParams.set("state", "streaming-table");
  url.hash = "agent-visual-smoke";
  await ownerWindow.loadURL(url.href);
  await waitFor("document.querySelector('.desktop-agent-markdown-table-scroll table')");
  await ownerWindow.webContents.executeJavaScript(
    "document.querySelector('.desktop-agent-mermaid')?.scrollIntoView({ block: 'center' })",
    true,
  );
  await waitFor("document.querySelector('.desktop-agent-mermaid.is-ready .po-safe-mermaid-svg-root')?.shadowRoot?.querySelector('svg')");
  await ownerWindow.webContents.executeJavaScript(
    "document.querySelectorAll('.desktop-agent-tool-fold-row').forEach(button => button.click())",
    true,
  );
  await waitFor("document.querySelector('.desktop-agent-tool-group-item .desktop-agent-tool-row')");

  const result = await ownerWindow.webContents.executeJavaScript(`(() => {
    const viewports = [...document.querySelectorAll('.desktop-agent-markdown-table-scroll')];
    const viewport = viewports.find((entry) => entry.querySelector('thead')?.textContent?.includes('Layer'));
    const table = viewport?.querySelector('table');
    const streamingViewport = viewports.find((entry) => entry.querySelector('thead')?.textContent?.includes('Tool'));
    const streamingTable = streamingViewport?.querySelector('table');
    const streamingTail = streamingViewport?.closest('.desktop-agent-markdown')
      ?.querySelector('.desktop-agent-markdown-stream-tail');
    const tasks = [...document.querySelectorAll('.desktop-agent-markdown .task-list-item input')];
    const mermaidRoot = document.querySelector('.desktop-agent-mermaid .po-safe-mermaid-svg-root');
    const transcript = document.querySelector('.desktop-agent-transcript');
    const chineseMarkdown = [...document.querySelectorAll('.desktop-agent-markdown')]
      .find((entry) => entry.lang === 'zh-Hans');
    const chineseStyle = chineseMarkdown ? getComputedStyle(chineseMarkdown) : null;
    const chineseEmphasis = chineseMarkdown?.querySelector('strong, th');
    const userMessage = document.querySelector('.desktop-agent-message.is-user .desktop-agent-message-text');
    const userMessageStyle = userMessage ? getComputedStyle(userMessage) : null;
    const composerEditor = document.querySelector('.desktop-agent-prompt-editor .cm-editor');
    const composerStyle = composerEditor ? getComputedStyle(composerEditor) : null;
    return {
      tableHeaders: table ? [...table.querySelectorAll('thead th')].map((cell) => cell.textContent?.trim()) : [],
      tableRows: table?.querySelectorAll('tbody tr').length ?? 0,
      tableViewportIsFocusable: viewport?.tabIndex === 0,
      tableViewportFitsTranscript: Boolean(viewport && transcript && viewport.getBoundingClientRect().width <= transcript.getBoundingClientRect().width),
      streamingTableHeaders: streamingTable ? [...streamingTable.querySelectorAll('thead th')].map((cell) => cell.textContent?.trim()) : [],
      streamingTableRows: streamingTable?.querySelectorAll('tbody tr').length ?? 0,
      streamingTailText: streamingTail?.textContent?.trim() ?? '',
      streamingViewportFitsTranscript: Boolean(streamingViewport && transcript && streamingViewport.getBoundingClientRect().width <= transcript.getBoundingClientRect().width),
      taskStates: tasks.map((task) => ({ checked: task.checked, disabled: task.disabled })),
      mermaidUsesShadowDom: Boolean(mermaidRoot?.shadowRoot),
      mermaidHasSvg: Boolean(mermaidRoot?.shadowRoot?.querySelector('svg')),
      chineseTypography: chineseStyle ? {
        language: chineseMarkdown.lang,
        fontSize: chineseStyle.fontSize,
        fontWeight: chineseStyle.fontWeight,
        lineHeight: chineseStyle.lineHeight,
        letterSpacing: chineseStyle.letterSpacing,
        emphasisWeight: chineseEmphasis ? getComputedStyle(chineseEmphasis).fontWeight : null,
      } : null,
      userMessageTypography: userMessageStyle ? {
        fontSize: userMessageStyle.fontSize,
        lineHeight: userMessageStyle.lineHeight,
      } : null,
      composerTypography: composerStyle ? {
        fontSize: composerStyle.fontSize,
        lineHeight: composerStyle.lineHeight,
      } : null,
      toolTypography: [...document.querySelectorAll('.desktop-agent-tool-row')].map(row => ({
        fontSize: getComputedStyle(row).fontSize,
        lineHeight: getComputedStyle(row).lineHeight,
        childSizes: [...row.querySelectorAll('.desktop-agent-tool-name, .desktop-agent-tool-summary, .desktop-agent-tool-subject-code')]
          .map(child => getComputedStyle(child).fontSize),
      })),
      toolGlyphs: [...document.querySelectorAll('.desktop-agent-tool-glyph')].map(glyph => ({
        width: getComputedStyle(glyph).width,
        height: getComputedStyle(glyph).height,
        strokeWidth: getComputedStyle(glyph).strokeWidth,
        vectorEffects: [...glyph.querySelectorAll('path, circle, rect, line, polyline, polygon, ellipse')]
          .map(shape => getComputedStyle(shape).vectorEffect),
      })),
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()`, true);

  assert(result.tableHeaders.join("|") === "Layer|Owner|Contract", "GFM table headers did not render semantically.");
  assert(result.tableRows === 2, "GFM table body did not render both rows.");
  assert(result.tableViewportIsFocusable, "Wide table viewport is not keyboard-focusable.");
  assert(result.tableViewportFitsTranscript, "Table escaped the Agent transcript boundary.");
  assert(result.streamingTableHeaders.join("|") === "Tool|State", "Streaming GFM table headers did not render.");
  assert(result.streamingTableRows === 1, "Streaming GFM table committed an incomplete body row.");
  assert(result.streamingTailText.includes("| Bash | run"), "Incomplete streaming GFM row did not remain in the live tail.");
  assert(result.streamingViewportFitsTranscript, "Streaming table escaped the Agent transcript boundary.");
  assert(result.taskStates.length === 2 && result.taskStates.every((task) => task.disabled), "Task-list inputs are not inert.");
  assert(result.taskStates[0]?.checked === true && result.taskStates[1]?.checked === false, "Task-list state was not preserved.");
  assert(result.mermaidUsesShadowDom && result.mermaidHasSvg, "Mermaid did not use the shared safe Shadow DOM mount.");
  assert(result.chineseTypography?.fontSize === "14px", `Agent response missed the conversation reading scale: ${JSON.stringify(result.chineseTypography)}`);
  assert(result.chineseTypography?.fontWeight === "400", `Agent copy diverged from the shared Sidebar weight: ${JSON.stringify(result.chineseTypography)}`);
  assert(result.chineseTypography?.lineHeight === "22.4px", `Agent response missed the 1.6 reading line height: ${JSON.stringify(result.chineseTypography)}`);
  assert(result.chineseTypography?.emphasisWeight === "600", `Agent emphasis escaped the restrained weight ramp: ${JSON.stringify(result.chineseTypography)}`);
  assert(result.chineseTypography?.letterSpacing === "normal" || result.chineseTypography?.letterSpacing === "0px", `Agent copy retained non-neutral tracking: ${JSON.stringify(result.chineseTypography)}`);
  assert(result.userMessageTypography?.fontSize === "14px" && result.userMessageTypography?.lineHeight === "22.4px", `Sent prompts escaped the shared conversation scale: ${JSON.stringify(result.userMessageTypography)}`);
  assert(result.composerTypography?.fontSize === "14px" && result.composerTypography?.lineHeight === "21px", `Composer copy escaped the shared conversation scale: ${JSON.stringify(result.composerTypography)}`);
  assert(result.documentOverflow <= 1, "Agent Markdown introduced page-level horizontal overflow.");
  assert(result.toolTypography.length > 0 && result.toolTypography.every(row =>
    row.fontSize === "12px" && row.lineHeight === "19px" && row.childSizes.every(size => size === "12px")),
  `Tool summaries and expanded rows missed the compact type scale: ${JSON.stringify(result.toolTypography)}`);
  assert(result.toolGlyphs.length > 0 && result.toolGlyphs.every(glyph =>
    glyph.width === "16px" && glyph.height === "16px" && glyph.strokeWidth === "1.25px"
      && glyph.vectorEffects.length > 0 && glyph.vectorEffects.every(effect => effect === "non-scaling-stroke")),
  `Tool glyphs missed the shared fine stroke: ${JSON.stringify(result.toolGlyphs)}`);
  if (renderProcessFailure) throw new Error(`Agent Markdown smoke renderer exited: ${renderProcessFailure}`);

  console.log(JSON.stringify({ schema: "puppyone-agent-markdown-smoke/v1", theme, ...result }, null, 2));
}

async function waitFor(expression, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (renderProcessFailure) throw new Error(`Agent Markdown smoke renderer exited: ${renderProcessFailure}`);
    const ready = await ownerWindow.webContents.executeJavaScript(`Boolean(${expression})`, true);
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Agent Markdown smoke timed out waiting for: ${expression}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function finish(exitCode) {
  await mermaidService?.dispose();
  ownerWindow?.destroy();
  await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  app.exit(exitCode);
}

app.whenReady().then(runSmoke).then(() => finish(0)).catch(async (error) => {
  console.error(error);
  await finish(1);
});
