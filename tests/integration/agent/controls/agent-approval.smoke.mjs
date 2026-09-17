#!/usr/bin/env electron

import { app, BrowserWindow } from "electron";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const indexPath = path.join(repoRoot, "dist", "index.html");
const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "puppyone-agent-approval-"));
const fixtureTitle = "Web search: Notion 1.0 2016 launch Product Hunt original version screenshots Ivan Zhao Kyoto rewrite";
const captureDirectory = process.argv.find((argument) => argument.startsWith("--capture-dir="))?.slice("--capture-dir=".length) || null;
app.setPath("userData", path.join(tempRoot, "user-data"));
app.commandLine.appendSwitch("disable-renderer-backgrounding");

let ownerWindow = null;
let renderProcessFailure = null;

async function runSmoke() {
  await fsp.access(indexPath);
  ownerWindow = new BrowserWindow({
    show: false,
    width: 520,
    height: 800,
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

  const results = [];
  for (const theme of ["dark", "light"]) {
    for (const width of [520, 340]) {
      ownerWindow.setContentSize(width, 800);
      const url = pathToFileURL(indexPath);
      url.searchParams.set("theme", theme);
      url.searchParams.set("state", "approval");
      url.hash = "agent-visual-smoke";
      await ownerWindow.loadURL(url.href);
      if (theme === "light") {
        await ownerWindow.webContents.executeJavaScript(`(() => {
          document.documentElement.removeAttribute('data-initial-theme');
          document.documentElement.classList.remove('dark');
          document.body.classList.remove('dark');
        })()`, true);
      }
      await waitFor("document.querySelector('.desktop-agent-approval') && document.fonts.status === 'loaded'");
      results.push(await inspect(theme, width));
      if (captureDirectory) {
        await fsp.mkdir(captureDirectory, { recursive: true });
        const capture = await ownerWindow.webContents.capturePage();
        await fsp.writeFile(path.join(captureDirectory, `agent-approval-${theme}-${width}.png`), capture.toPNG());
      }
    }
  }

  console.log(JSON.stringify({ schema: "puppyone-agent-approval-smoke/v1", results }, null, 2));
  for (const result of results) {
    assert(result.titleOccurrences === 1, `${result.label}: provider copy was repeated.`);
    assert(!result.hasDuplicateDetails, `${result.label}: duplicate reason left an empty details region.`);
    assert(result.cardWithinBoundary, `${result.label}: approval card escaped the Agent boundary.`);
    assert(result.actionsWithinCard, `${result.label}: approval actions escaped their card.`);
    assert(!result.buttonsOverlap, `${result.label}: approval buttons overlap.`);
    assert(result.controlSize > 0 && result.buttonHeights.every((height) => Math.abs(height - result.controlSize) <= 0.5), `${result.label}: approval controls left the shared product scale.`);
    assert(result.cardRadius === result.composerRadius, `${result.label}: approval and Composer radii diverged.`);
    assert(result.buttonRadii.every((radius) => radius === "6px"), `${result.label}: approval buttons left the product radius.`);
    assert(result.primaryUsesThemeForeground, `${result.label}: primary action did not follow the neutral theme ramp.`);
    assert(result.iconSize.width === 24 && result.iconSize.height === 24, `${result.label}: approval status icon geometry changed.`);
    assert(result.state === "waiting", `${result.label}: approval did not expose its waiting state.`);
    assert(result.titleWeight === "500", `${result.label}: approval title left the shared medium text hierarchy.`);
    assert(result.attentionAnimation === "desktop-agent-approval-attention" && result.attentionIterations === "3", `${result.label}: approval attention treatment is missing or unbounded.`);
    assert(result.documentOverflow <= 1, `${result.label}: approval UI introduced page overflow.`);
    if (result.width === 340) assert(result.actionsDisplay === "grid", `${result.label}: narrow actions did not stack.`);
  }
  if (renderProcessFailure) throw new Error(`Agent approval smoke renderer exited: ${renderProcessFailure}`);

}

async function inspect(theme, width) {
  return ownerWindow.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.desktop-agent-approval');
    const boundary = document.querySelector('.desktop-agent-boundary');
    const composer = document.querySelector('.desktop-agent-composer');
    const actions = card.querySelector('.desktop-agent-approval-actions');
    const icon = card.querySelector('.desktop-agent-approval-icon');
    const details = card.querySelector('.desktop-agent-approval-details');
    const buttons = [...actions.querySelectorAll('button')];
    const primary = actions.querySelector('.is-primary');
    const titleElement = card.querySelector('.desktop-agent-approval-title');
    const cardRect = card.getBoundingClientRect();
    const boundaryRect = boundary.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    const buttonRects = buttons.map((button) => button.getBoundingClientRect());
    const overlaps = buttonRects.some((first, index) => buttonRects.slice(index + 1).some((second) => (
      first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top
    )));
    const title = ${JSON.stringify(fixtureTitle)};
    return {
      label: ${JSON.stringify(theme)} + '-' + ${width},
      theme: ${JSON.stringify(theme)},
      width: ${width},
      titleOccurrences: card.innerText.split(title).length - 1,
      hasDuplicateDetails: Boolean(details),
      cardWithinBoundary: cardRect.left >= boundaryRect.left - 0.5 && cardRect.right <= boundaryRect.right + 0.5,
      actionsWithinCard: actionsRect.left >= cardRect.left - 0.5 && actionsRect.right <= cardRect.right + 0.5,
      buttonsOverlap: overlaps,
      controlSize: parseFloat(getComputedStyle(boundary).getPropertyValue("--po-control-size")),
      buttonHeights: buttonRects.map((rect) => rect.height),
      cardRadius: getComputedStyle(card).borderRadius,
      composerRadius: getComputedStyle(composer).borderRadius,
      buttonRadii: buttons.map((button) => getComputedStyle(button).borderRadius),
      primaryUsesThemeForeground: getComputedStyle(primary).backgroundColor === getComputedStyle(boundary).color,
      iconSize: { width: icon.getBoundingClientRect().width, height: icon.getBoundingClientRect().height },
      state: card.dataset.state,
      titleWeight: getComputedStyle(titleElement).fontWeight,
      attentionAnimation: getComputedStyle(card, '::before').animationName,
      attentionIterations: getComputedStyle(card, '::before').animationIterationCount,
      actionsDisplay: getComputedStyle(actions).display,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()`, true);
}

async function waitFor(expression, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (renderProcessFailure) throw new Error(`Agent approval smoke renderer exited: ${renderProcessFailure}`);
    const ready = await ownerWindow.webContents.executeJavaScript(`Boolean(${expression})`, true);
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Agent approval smoke timed out waiting for: ${expression}`);
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
