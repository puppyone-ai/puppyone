#!/usr/bin/env electron

import { app, BrowserWindow } from "electron";
import { access, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// A local folder and its Cloud project are two projects (puppy-issues
// ADR-001). The Header carries one project menu and no Local / Cloud switch;
// the project rail lists a folder, a folder with its own Cloud project, and a
// Cloud project as separate rows.
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
    show: false, width: 996, height: 744, frame: false, backgroundColor: "#151515",
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  try {
    await window.loadURL(pathToFileURL(rendererPath).href + "#workspace-menu-visual-smoke");
    await waitForRenderer(window, "Boolean(document.querySelector('[data-workspace-menu-visual-ready]'))");
    for (const locale of locales) {
      await window.webContents.executeJavaScript(`localStorage.setItem('puppyone.desktop.developmentLanguage', ${JSON.stringify(locale)})`);
      for (const platform of ["macos", "windows", "linux"]) for (const theme of ["light", "dark"]) {
        const scene = { locale, platform, theme };
        observations.push({ ...scene, menu: await checkProjectMenu(window, scene) });
        observations.push({ ...scene, rail: await checkProjectRail(window, scene) });
      }
      console.log(`workspace menu visual smoke passed: ${locale}`);
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

function sceneUrl({ theme, platform }, menu) {
  const url = pathToFileURL(rendererPath);
  url.searchParams.set("theme", theme);
  url.searchParams.set("platform", platform);
  url.searchParams.set("menu", menu);
  url.hash = "workspace-menu-visual-smoke";
  return url.href;
}

async function checkProjectMenu(window, scene) {
  await window.loadURL(sceneUrl(scene, "project-list"));
  await waitForRenderer(window, "Boolean(document.querySelector('.desktop-titlebar-workspace-button'))");
  await window.webContents.executeJavaScript("document.querySelector('.desktop-titlebar-workspace-button').click()", true);
  await waitForRenderer(window, "Boolean(document.querySelector('.desktop-project-menu .desktop-project-switcher-list'))");
  await window.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))", true);
  const snapshot = await window.webContents.executeJavaScript(`(() => {
    const menu = document.querySelector('.desktop-project-menu');
    const list = menu.querySelector('.desktop-project-switcher-list');
    const labels = [...list.querySelectorAll('.desktop-menu-item-label')];
    const long = labels.find(label => label.textContent.includes('puppyone-payments-experiment-sandbox'));
    return { locale: document.documentElement.lang, devicePlatform: document.querySelector('[data-device-platform]')?.dataset.devicePlatform,
      locationControl: Boolean(document.querySelector('.desktop-titlebar-location-button, .desktop-project-location-controls, .desktop-project-location-menu')),
      current: list.querySelectorAll('[aria-current="page"]').length,
      horizontalOverflow: menu.scrollWidth > menu.clientWidth || list.scrollWidth > list.clientWidth,
      longEllipsized: Boolean(long) && getComputedStyle(long).textOverflow === 'ellipsis' && long.scrollWidth > long.clientWidth,
      outline: getComputedStyle(menu).outlineStyle, githubUrl: Boolean(menu.querySelector('.desktop-project-repository-link')) };
  })()`, true);
  const evidence = JSON.stringify({ ...scene, ...snapshot });
  assert(snapshot.locale === scene.locale && snapshot.devicePlatform === scene.platform, `Wrong locale or device platform: ${evidence}`);
  assert(!snapshot.locationControl, `The Header must not switch one project between this computer and the Cloud: ${evidence}`);
  assert(snapshot.current === 1, `Exactly one project is current: ${evidence}`);
  assert(!snapshot.horizontalOverflow && snapshot.longEllipsized, `A long project name ends in an ellipsis instead of widening the menu: ${evidence}`);
  assert(snapshot.outline === "none" && !snapshot.githubUrl, `The project menu has no outer outline or GitHub shortcut: ${evidence}`);
  await capture(window, scene, "project-menu", ".desktop-project-menu");
  return snapshot;
}

async function checkProjectRail(window, scene) {
  await window.loadURL(sceneUrl(scene, "project-actions"));
  await waitForRenderer(window, "document.querySelectorAll('.desktop-project-switcher-rail-project').length >= 5");
  const snapshot = await window.webContents.executeJavaScript(`(() => {
    const rows = [...document.querySelectorAll('.desktop-project-switcher-rail-project')];
    return { kinds: rows.map(row => row.dataset.contextAssetKind),
      linkedBadge: Boolean(rows[1]?.querySelector('[data-project-location="linked"] .onboarding-project-cloud-badge')),
      cloudPlaces: [...document.querySelectorAll('.desktop-project-switcher-rail-project-row')]
        .map(row => Boolean(row.querySelector('.desktop-project-switcher-rail-place'))) };
  })()`, true);
  const evidence = JSON.stringify({ ...scene, ...snapshot });
  assert(snapshot.kinds.slice(0, 5).join("|") === "local|linked|cloud|cloud|local",
    `A folder, a folder with its own Cloud project and Cloud projects are separate rows: ${evidence}`);
  assert(snapshot.linkedBadge, `A folder with its own Cloud project carries the Cloud badge on its folder mark: ${evidence}`);
  assert(snapshot.cloudPlaces.slice(0, 5).join("|") === "false|false|true|true|false",
    `Only Cloud projects state the Cloud place: ${evidence}`);
  await capture(window, scene, "project-rail", ".desktop-project-switcher-rail");
  return snapshot;
}

async function capture(window, { locale, platform, theme }, name, selector) {
  const bounds = await window.webContents.executeJavaScript(`(() => {
    const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: Math.max(0, Math.floor(rect.left - 20)), y: 0, width: Math.ceil(rect.width + 40), height: Math.ceil(rect.bottom + 24) };
  })()`, true);
  const image = await window.capturePage(bounds);
  assert(!image.isEmpty(), `${name} screenshot capture was empty.`);
  if (!screenshotPath) return;
  await mkdir(path.dirname(screenshotPath), { recursive: true });
  const extension = path.extname(screenshotPath);
  await writeFile(`${screenshotPath.slice(0, extension ? -extension.length : undefined)}-${name}-${locale}-${platform}-${theme}${extension || ".png"}`, image.toPNG());
}

async function waitForRenderer(window, expression, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(expression, true)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Renderer did not satisfy ${expression}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
