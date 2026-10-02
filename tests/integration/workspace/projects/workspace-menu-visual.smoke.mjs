#!/usr/bin/env electron

import { app, BrowserWindow } from "electron";
import { access, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const rendererPath = path.join(repoRoot, "dist", "index.html");
const screenshotPath = process.env.PUPPYONE_WORKSPACE_MENU_SCREENSHOT ?? null;

app.commandLine.appendSwitch("disable-gpu");
app.setPath("userData", path.join(os.tmpdir(), `puppyone-workspace-menu-smoke-${process.pid}`));

await access(rendererPath).catch(() => {
  throw new Error("Workspace menu visual smoke requires a built renderer. Run `npm run build` first.");
});

app.whenReady().then(runSmoke).catch((error) => {
  console.error(error);
  app.exit(1);
});

async function runSmoke() {
  const window = new BrowserWindow({
    show: false,
    width: 996,
    height: 744,
    frame: false,
    backgroundColor: "#151515",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  try {
  for (const theme of ["light", "dark"]) {
  for (const state of ["local-only", "local-github", "local-cloud", "cloud-only"]) {
  const url = pathToFileURL(rendererPath);
  url.searchParams.set("project-state", state);
  url.searchParams.set("theme", theme);
  url.hash = "workspace-menu-visual-smoke";
  await window.loadURL(url.href);
  await waitForRenderer(window, `Boolean(
    document.querySelector('[data-workspace-menu-visual-ready="true"]')
    && document.querySelector('.desktop-project-location-controls')
  )`);
  await window.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    true,
  );

  const snapshot = await window.webContents.executeJavaScript(`(() => {
    const menu = document.querySelector('[data-titlebar-context-menu="true"]');
    const row = menu.querySelector('.desktop-project-location-controls');
    const track = menu.querySelector('.desktop-project-location-tabs');
    const buttons = [...menu.querySelectorAll('button[data-project-location]')];
    const selected = menu.querySelector('button[aria-pressed="true"]');
    const github = menu.querySelector('.desktop-project-repository-link');
    const header = document.querySelector('.workspace-menu-visual-titlebar');
    return {
      state: document.querySelector('[data-project-state]')?.dataset.projectState,
      location: selected.dataset.projectLocation,
      currentCount: menu.querySelectorAll('[aria-current="true"]').length,
      pressedCount: menu.querySelectorAll('[aria-pressed="true"]').length,
      menuWidth: menu.getBoundingClientRect().width,
      menuHeight: menu.getBoundingClientRect().height,
      menuPadding: parseFloat(getComputedStyle(menu).paddingLeft),
      rowGap: parseFloat(getComputedStyle(row).gap),
      buttonHeights: buttons.map(button => button.getBoundingClientRect().height),
      buttonYs: buttons.map(button => button.getBoundingClientRect().y),
      labelsFit: buttons.every(button => button.scrollWidth <= button.clientWidth),
      iconWidths: buttons.map(button => button.querySelector('svg').getBoundingClientRect().width),
      iconColorsMatch: buttons.every(button => getComputedStyle(button.querySelector('.desktop-project-location-tab-mark')).color === getComputedStyle(button.querySelector('span:last-child')).color),
      selectedBackground: getComputedStyle(selected).backgroundColor,
      trackBackground: getComputedStyle(track).backgroundColor,
      headerColorsMatch: getComputedStyle(header.querySelector('.desktop-titlebar-workspace-mark')).color === getComputedStyle(header.querySelector('.desktop-titlebar-workspace-name')).color,
      menuBackground: getComputedStyle(menu).backgroundColor,
      headerBackground: getComputedStyle(header).backgroundColor,
      menuShadow: getComputedStyle(menu).boxShadow,
      localDisabled: buttons[0].disabled,
      cloudDisabled: buttons[1].disabled,
      githubUrl: github?.href,
      githubWidth: github?.getBoundingClientRect().width,
      githubIconWidth: github?.querySelector('.desktop-project-github-mark').getBoundingClientRect().width,
      githubGap: github ? github.getBoundingClientRect().left - track.getBoundingClientRect().right : null,
      text: menu.textContent,
    };
  })()`, true);

  const evidence = JSON.stringify(snapshot);
  assert(snapshot.state === state, `Wrong fixture state: ${evidence}`);
  assert(snapshot.menuWidth === 248 && snapshot.menuHeight <= 56, `Project menu must stay compact: ${evidence}`);
  assert(snapshot.menuPadding === 8 && snapshot.rowGap === snapshot.menuPadding, `Control spacing must match menu padding: ${evidence}`);
  assert(snapshot.buttonHeights.every(height => height === 32) && snapshot.buttonYs[0] === snapshot.buttonYs[1], `Local and Cloud must share one horizontal control: ${evidence}`);
  assert(snapshot.currentCount === 1 && snapshot.pressedCount === 1, `Exactly one surface must be selected: ${evidence}`);
  assert(snapshot.labelsFit && snapshot.text === "LocalCloud", `Only the two unclipped switch labels belong in this menu: ${evidence}`);
  assert(snapshot.iconWidths.every(width => width === 16) && snapshot.iconColorsMatch && snapshot.headerColorsMatch, `Small icons must match their labels: ${evidence}`);
  assert(snapshot.selectedBackground !== snapshot.trackBackground, `Current surface must have a distinct selected background: ${evidence}`);
  assert(snapshot.menuBackground === snapshot.headerBackground && snapshot.menuShadow !== "none", `Popup must use themed Header color and a floating shadow: ${evidence}`);
  assert(snapshot.location === (state === "cloud-only" ? "cloud" : "local"), `Current surface drifted: ${evidence}`);
  assert(snapshot.localDisabled === (state === "cloud-only") && !snapshot.cloudDisabled, `Destination availability drifted: ${evidence}`);
  if (state === "local-only") {
    assert(!snapshot.githubUrl, `No repository button without a recognized GitHub remote: ${evidence}`);
  } else {
    assert(snapshot.githubUrl === "https://github.com/example/project" && snapshot.githubWidth === 32 && snapshot.githubIconWidth === 16 && snapshot.githubGap === snapshot.menuPadding, `GitHub must remain a small separate external link after Cloud: ${evidence}`);
  }

  const captureBounds = await window.webContents.executeJavaScript(`(() => {
    const rect = document.querySelector('[data-titlebar-context-menu="true"]').getBoundingClientRect();
    return { x: Math.floor(rect.left - 20), y: 0, width: Math.ceil(rect.width + 40), height: Math.ceil(rect.bottom + 24) };
  })()`, true);
  const capture = await window.capturePage(captureBounds);
  assert(!capture.isEmpty(), "Workspace menu screenshot capture was empty.");
  if (screenshotPath) {
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    const extension = path.extname(screenshotPath);
    const statePath = screenshotPath.slice(0, extension ? -extension.length : undefined) + "-" + theme + "-" + state + (extension || ".png");
    await writeFile(statePath, capture.toPNG());
  }
  console.log(`workspace menu visual smoke passed: ${JSON.stringify(snapshot)}`);
  }
  }
  } finally {
    if (!window.isDestroyed()) window.destroy();
    app.quit();
  }
}

async function waitForRenderer(window, expression, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await window.webContents.executeJavaScript(expression, true)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for Renderer expression: ${expression}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
