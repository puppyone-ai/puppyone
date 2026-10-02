#!/usr/bin/env electron

import { app, BrowserWindow } from "electron";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const rendererPath = path.join(repoRoot, "dist", "index.html");
const screenshotPath = process.env.PUPPYONE_WORKSPACE_MENU_SCREENSHOT ?? null;
const locales = ["en", "zh-Hans", "de", "es", "fr", "ja", "ko", "pt-BR"];
const observations = [];

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
  await window.loadURL(pathToFileURL(rendererPath).href + "#workspace-menu-visual-smoke");
  await waitForRenderer(window, "Boolean(document.querySelector('[data-workspace-menu-visual-ready]'))");
  for (const locale of locales) {
  const catalog = JSON.parse(await readFile(path.join(repoRoot, "locales", "renderer", locale, "shell.json"), "utf8"));
  await window.webContents.executeJavaScript(`localStorage.setItem('puppyone.desktop.developmentLanguage', ${JSON.stringify(locale)})`);
  for (const theme of ["light", "dark"]) {
  for (const state of ["local-only", "local-github", "local-cloud-no-github", "local-cloud", "cloud-only", "resolving"]) {
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
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const luminance = color => {
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => {
        const component = value / 255;
        return component <= 0.04045 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4;
      });
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    const contrast = (first, second) => (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    const selectedLuminance = luminance(getComputedStyle(selected).backgroundColor);
    const trackLuminance = luminance(getComputedStyle(track).backgroundColor);
    return {
      locale: document.documentElement.lang,
      cloudEntry: row.dataset.cloudEntry,
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
      labels: buttons.map(button => button.textContent),
      labelsFit: buttons.every(button => button.scrollWidth <= button.clientWidth),
      selectedContrast: contrast(selectedLuminance, luminance(getComputedStyle(selected).color)),
      selectedEmphasis: contrast(selectedLuminance, trackLuminance),
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
  assert(snapshot.menuWidth === 248 && snapshot.menuHeight === 46, `Project menu must stay compact: ${evidence}`);
  assert(snapshot.menuPadding === 6 && snapshot.rowGap === snapshot.menuPadding, `Control spacing must match menu padding: ${evidence}`);
  assert(snapshot.buttonHeights.every(height => height === 28) && snapshot.buttonYs[0] === snapshot.buttonYs[1], `Local and Cloud must share one horizontal control: ${evidence}`);
  assert(snapshot.currentCount === 1 && snapshot.pressedCount === 1, `Exactly one surface must be selected: ${evidence}`);
  const creating = state === "local-only" || state === "local-github";
  assert(snapshot.locale === locale, `Wrong locale: ${evidence}`);
  assert(snapshot.cloudEntry === (creating ? "create" : "switch"), `Use creation only for a confirmed unhosted project: ${evidence}`);
  assert(snapshot.labelsFit && snapshot.labels.join("|") === [catalog["navigation.local"], catalog[creating ? "workspaceSwitcher.createCloudVersion" : "navigation.cloud"]].join("|"), `Only the two unclipped localized actions belong in this menu: ${evidence}`);
  assert(snapshot.iconWidths.every(width => width === 14) && snapshot.iconColorsMatch && snapshot.headerColorsMatch, `Small icons must match their labels: ${evidence}`);
  assert(snapshot.selectedContrast >= 7 && snapshot.selectedEmphasis >= 7, `Selected segment must use a strong fill with readable contrasting text: ${evidence}`);
  assert(snapshot.menuBackground === snapshot.headerBackground && snapshot.menuShadow !== "none", `Popup must use themed Header color and a floating shadow: ${evidence}`);
  assert(snapshot.location === (state === "cloud-only" ? "cloud" : "local"), `Current surface drifted: ${evidence}`);
  assert(snapshot.localDisabled === (state === "cloud-only") && snapshot.cloudDisabled === (state === "resolving"), `Destination availability drifted: ${evidence}`);
  if (state === "local-only" || state === "local-cloud-no-github" || state === "resolving") {
    assert(!snapshot.githubUrl, `No repository button without a recognized GitHub remote: ${evidence}`);
  } else {
    assert(snapshot.githubUrl === "https://github.com/example/project" && snapshot.githubWidth === 28 && snapshot.githubIconWidth === 14 && snapshot.githubGap === snapshot.menuPadding, `GitHub must remain a small separate external link after Cloud: ${evidence}`);
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
    const statePath = screenshotPath.slice(0, extension ? -extension.length : undefined) + "-" + locale + "-" + theme + "-" + state + (extension || ".png");
    await writeFile(statePath, capture.toPNG());
  }
  observations.push({ locale, theme, ...snapshot });
  }
  }
  console.log(`workspace menu visual smoke passed: ${locale}, 12 scenarios`);
  }
  if (screenshotPath) {
    await writeFile(path.join(path.dirname(screenshotPath), "visual-results.json"), JSON.stringify(observations, null, 2) + "\n");
  }
  console.log(`workspace menu visual smoke passed: ${observations.length} scenarios`);
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
