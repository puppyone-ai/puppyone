#!/usr/bin/env electron

import { app, BrowserWindow } from "electron";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = path.join(repoRoot, "dist", "index.html");
const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "puppyone-agent-markdown-"));
app.setPath("userData", path.join(tempRoot, "user-data"));
app.commandLine.appendSwitch("disable-renderer-backgrounding");

let ownerWindow = null;
let renderProcessFailure = null;

async function runSmoke() {
  await fsp.access(indexPath);
  ownerWindow = new BrowserWindow({
    show: false,
    width: 760,
    height: 900,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  ownerWindow.webContents.on("render-process-gone", (_event, details) => {
    renderProcessFailure = `${details.reason}:${details.exitCode}`;
  });

  const url = pathToFileURL(indexPath);
  url.searchParams.set("theme", "dark");
  url.searchParams.set("state", "streaming-table");
  url.hash = "agent-visual-smoke";
  await ownerWindow.loadURL(url.href);
  await waitFor("document.querySelector('.desktop-agent-markdown-table-scroll table')");
  await ownerWindow.webContents.executeJavaScript(
    "document.querySelector('.desktop-agent-mermaid')?.scrollIntoView({ block: 'center' })",
    true,
  );
  await waitFor("document.querySelector('.desktop-agent-mermaid.is-ready .po-safe-mermaid-svg-root')?.shadowRoot?.querySelector('svg')");

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
  assert(result.chineseTypography?.fontWeight === "500", `Chinese Agent copy missed its optical reading weight: ${JSON.stringify(result.chineseTypography)}`);
  assert(result.chineseTypography?.lineHeight === "22px", `Agent response missed the intended reading line height: ${JSON.stringify(result.chineseTypography)}`);
  assert(result.chineseTypography?.emphasisWeight === "600", `Agent emphasis escaped the restrained weight ramp: ${JSON.stringify(result.chineseTypography)}`);
  assert(result.chineseTypography?.letterSpacing === "normal" || result.chineseTypography?.letterSpacing === "0px", `Agent copy retained non-neutral tracking: ${JSON.stringify(result.chineseTypography)}`);
  assert(result.userMessageTypography?.fontSize === "14px" && result.userMessageTypography?.lineHeight === "21px", `Sent prompts escaped the shared conversation scale: ${JSON.stringify(result.userMessageTypography)}`);
  assert(result.composerTypography?.fontSize === "14px" && result.composerTypography?.lineHeight === "21px", `Composer copy escaped the shared conversation scale: ${JSON.stringify(result.composerTypography)}`);
  assert(result.documentOverflow <= 1, "Agent Markdown introduced page-level horizontal overflow.");
  if (renderProcessFailure) throw new Error(`Agent Markdown smoke renderer exited: ${renderProcessFailure}`);

  console.log(JSON.stringify({ schema: "puppyone-agent-markdown-smoke/v1", ...result }, null, 2));
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
  ownerWindow?.destroy();
  await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  app.exit(exitCode);
}

app.whenReady().then(runSmoke).then(() => finish(0)).catch(async (error) => {
  console.error(error);
  await finish(1);
});
