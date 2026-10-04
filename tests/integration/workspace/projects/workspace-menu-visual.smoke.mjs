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
  for (const platform of ["macos", "windows", "linux"]) {
  for (const theme of ["light", "dark"]) {
  for (const state of ["local-only", "local-github", "local-cloud-no-github", "local-cloud", "cloud-only", "resolving", "signed-out"]) {
  const url = pathToFileURL(rendererPath);
  url.searchParams.set("project-state", state);
  url.searchParams.set("theme", theme);
  url.searchParams.set("platform", platform);
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

  await checkStableReopening(window);
  if (locale === "en" && platform === "macos" && theme === "light") await checkStableReopening(window, "rtl");

  const snapshot = await window.webContents.executeJavaScript(`(() => {
    const menu = document.querySelector('[data-titlebar-context-menu="true"]');
    const row = menu.querySelector('.desktop-project-location-controls');
    const track = menu.querySelector('.desktop-project-location-tabs');
    const buttons = [...menu.querySelectorAll('button[data-project-location]')];
    const selected = menu.querySelector('button[aria-pressed="true"]');
    const plate = menu.querySelector('.desktop-project-location-indicator');
    const create = menu.querySelector('button[data-cloud-action="create"]');
    const github = menu.querySelector('.desktop-project-repository-link');
    const header = document.querySelector('.workspace-menu-visual-titlebar');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const luminance = color => {
      context.fillStyle = getComputedStyle(track).backgroundColor;
      context.fillRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(value => {
        const component = value / 255;
        return component <= 0.04045 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4;
      });
      return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    };
    const contrast = (first, second) => (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
    const selectedLuminance = luminance(getComputedStyle(plate).backgroundColor);
    const trackLuminance = luminance(getComputedStyle(track).backgroundColor);
    return {
      locale: document.documentElement.lang,
      cloudEntry: row.dataset.cloudEntry,
      devicePlatform: document.querySelector('[data-device-platform]')?.dataset.devicePlatform,
      controlsFit: buttons.every(button => button.getBoundingClientRect().right <= track.getBoundingClientRect().right + 1)
        && (!github || github.getBoundingClientRect().right <= menu.getBoundingClientRect().right - 6),
      createIcon: !!create?.querySelector('.lucide-plus'),
      createContrast: create ? contrast(luminance(getComputedStyle(create).color), luminance(getComputedStyle(create).backgroundColor)) : null,
      createEmphasis: create ? getComputedStyle(create).boxShadow : null,
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
      selectedTextColor: getComputedStyle(selected).color,
      normalTextColor: getComputedStyle(menu).color,
      selectedContrast: contrast(selectedLuminance, luminance(getComputedStyle(selected).color)),
      selectedEmphasis: contrast(selectedLuminance, trackLuminance),
      iconWidths: buttons.map(button => button.querySelector('.desktop-project-location-tab-mark').getBoundingClientRect().width),
      iconColorsMatch: buttons.every(button => getComputedStyle(button.querySelector('.desktop-project-location-tab-mark')).color === getComputedStyle(button.querySelector('span:last-child')).color),
      selectedBackground: getComputedStyle(plate).backgroundColor,
      trackBackground: getComputedStyle(track).backgroundColor,
      headerColorsMatch: getComputedStyle(header.querySelector('.desktop-titlebar-workspace-mark')).color === getComputedStyle(header.querySelector('.desktop-titlebar-workspace-name')).color,
      menuBackground: getComputedStyle(menu).backgroundColor,
      headerBackground: getComputedStyle(header).backgroundColor,
      menuShadow: getComputedStyle(menu).boxShadow,
      menuOutline: getComputedStyle(menu).outlineStyle,
      selectedShadow: getComputedStyle(plate).boxShadow,
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
  assert(snapshot.menuWidth >= 248 && snapshot.menuWidth <= 480 && snapshot.menuHeight === 46 && snapshot.controlsFit, `Project menu must stay compact and fit translated device labels: ${evidence}`);
  assert(snapshot.menuPadding === 6 && snapshot.rowGap === snapshot.menuPadding, `Control spacing must match menu padding: ${evidence}`);
  assert(snapshot.buttonHeights.every(height => height === 28) && snapshot.buttonYs[0] === snapshot.buttonYs[1], `Local and Cloud must share one horizontal control: ${evidence}`);
  assert(snapshot.currentCount === 1 && snapshot.pressedCount === 1, `Exactly one surface must be selected: ${evidence}`);
  const creating = state === "local-only" || state === "local-github";
  assert(snapshot.locale === locale && snapshot.devicePlatform === platform, `Wrong locale or device platform: ${evidence}`);
  assert(snapshot.cloudEntry === (creating ? "create" : "switch"), `Use creation only for a confirmed unhosted project: ${evidence}`);
  assert(snapshot.labelsFit && snapshot.labels.join("|") === [catalog[platform === "macos" ? "workspaceSwitcher.location.thisMac" : "workspaceSwitcher.location.thisComputer"], catalog[creating ? "workspaceSwitcher.createCloudVersion" : "navigation.cloud"]].join("|"), `Only the two unclipped localized actions belong in this menu: ${evidence}`);
  assert(creating ? snapshot.createIcon && snapshot.createContrast >= 4.5 && snapshot.createEmphasis !== "none" : !snapshot.createIcon && snapshot.createContrast === null, `Creation must be a readable accented action with a plus mark, separate from selection: ${evidence}`);
  assert(snapshot.iconWidths.every(width => width === 14) && snapshot.iconColorsMatch
    && (state === "cloud-only" || snapshot.headerColorsMatch), `Small icons must match their labels; the committed Cloud Header mark keeps its brand tint: ${evidence}`);
  assert(snapshot.selectedTextColor === snapshot.normalTextColor && snapshot.selectedContrast >= 7
    && snapshot.selectedEmphasis > 1.03 && snapshot.selectedEmphasis < 1.7,
    `Selection needs a subtle themed background and normal text without inversion: ${evidence}`);
  assert(snapshot.menuBackground === snapshot.headerBackground && snapshot.menuShadow !== "none", `Popup must use themed Header color and a floating shadow: ${evidence}`);
  assert(snapshot.location === (state === "cloud-only" ? "cloud" : "local"), `Current surface drifted: ${evidence}`);
  assert(snapshot.localDisabled === (state === "cloud-only") && !snapshot.cloudDisabled, `Destination availability drifted: ${evidence}`);
  assert(!snapshot.githubUrl, `Project location controls must omit the GitHub shortcut: ${evidence}`);
  assert(snapshot.menuOutline === "none", `Initial dialog focus must not outline the whole popup: ${evidence}`);
  const localSelection = observations.find(scene => scene.locale === locale && scene.platform === platform
    && scene.theme === theme && scene.state === "local-cloud");
  if (state === "cloud-only") assert(snapshot.selectedBackground === localSelection.selectedBackground
    && snapshot.selectedShadow === localSelection.selectedShadow,
    `Local and Cloud must use the same selection plate appearance: ${evidence}`);

  const captureBounds = await window.webContents.executeJavaScript(`(() => {
    const rect = document.querySelector('[data-titlebar-context-menu="true"]').getBoundingClientRect();
    return { x: Math.floor(rect.left - 20), y: 0, width: Math.ceil(rect.width + 40), height: Math.ceil(rect.bottom + 24) };
  })()`, true);
  const capture = await window.capturePage(captureBounds);
  assert(!capture.isEmpty(), "Workspace menu screenshot capture was empty.");
  if (screenshotPath) {
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    const extension = path.extname(screenshotPath);
    const statePath = screenshotPath.slice(0, extension ? -extension.length : undefined) + "-" + locale + "-" + platform + "-" + theme + "-" + state + (extension || ".png");
    await writeFile(statePath, capture.toPNG());
  }
  observations.push({ locale, platform, theme, ...snapshot });
  }
  }
  }
  console.log(`workspace menu visual smoke passed: ${locale}, 42 scenarios`);
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

async function checkStableReopening(window, direction = "ltr") {
  await window.webContents.executeJavaScript("document.querySelector('.desktop-titlebar-workspace-button').click()", true);
  await waitForRenderer(window, "!document.querySelector('.desktop-project-menu')");
  const frames = await window.webContents.executeJavaScript(`new Promise(resolve => {
    document.documentElement.dir = '${direction}';
    document.querySelector('.desktop-titlebar-workspace-button').click();
    const frames = [];
    const sample = () => {
      const menu = document.querySelector('.desktop-project-menu');
      if (menu && getComputedStyle(menu).visibility !== 'hidden') {
        const a = menu.querySelector('.desktop-project-location-indicator').getBoundingClientRect();
        const b = menu.querySelector('button[aria-pressed=true]').getBoundingClientRect();
        const m = menu.getBoundingClientRect();
        const track = menu.querySelector('.desktop-project-location-tabs');
        const css = getComputedStyle(menu.querySelector('.desktop-project-location-indicator'));
        frames.push({x:m.x,y:m.y,width:m.width,height:m.height,offset:Math.abs(a.x-b.x),plateWidth:Math.abs(a.width-b.width),animations:menu.querySelector('.desktop-project-location-indicator').getAnimations().length,rtl:track.matches(':dir(rtl)'),direction:getComputedStyle(track).direction,left:css.left,right:css.right,transform:css.transform});
      }
      if (frames.length < 8) requestAnimationFrame(sample); else resolve(frames);
    };
    requestAnimationFrame(sample);
  })`, true);
  assert(frames.every(frame => frame.offset < 1 && frame.plateWidth < 1 && frame.animations === 0
    && ['x','y','width','height'].every(key => Math.abs(frame[key]-frames[0][key]) < 1)),
    `Every visible opening frame must have final menu and slider geometry (${direction}): ${JSON.stringify(frames)}`);
  if (direction === "rtl") await checkStableReopening(window);
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
