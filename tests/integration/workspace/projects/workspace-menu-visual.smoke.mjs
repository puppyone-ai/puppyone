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
  const url = pathToFileURL(rendererPath);
  url.hash = "workspace-menu-visual-smoke";
  await window.loadURL(url.href);
  await waitForRenderer(window, `Boolean(
    document.querySelector('[data-workspace-menu-visual-ready="true"]')
    && document.querySelector('[data-workspace-menu-layout="workspace-composition-v1"]')
  )`);
  await window.webContents.executeJavaScript(
    "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    true,
  );

  const snapshot = await window.webContents.executeJavaScript(`(() => {
    const menu = document.querySelector('[data-titlebar-context-menu="true"]');
    const rows = [...menu.querySelectorAll('.desktop-project-option')];
    const currentLocation = menu.querySelector('.desktop-project-current-location');
    const locationAction = menu.querySelector('.desktop-project-cloud-setup');
    const locationActionLabel = locationAction?.querySelector('.desktop-menu-item-label');
    const homeGroup = menu.querySelector('.desktop-project-home-group');
    const addProject = menu.querySelector('.desktop-project-add-folder');
    return {
      addProjectEnabled: addProject instanceof HTMLButtonElement && !addProject.disabled,
      currentLocationHeight: currentLocation?.getBoundingClientRect().height ?? 0,
      currentLocationWidth: currentLocation?.getBoundingClientRect().width ?? 0,
      currentLocationBackground: currentLocation ? getComputedStyle(currentLocation).backgroundColor : "",
      hasRepeatedProjectName: currentLocation?.textContent.includes('To-Do-List') ?? false,
      hasHomeDivider: getComputedStyle(homeGroup).borderTopWidth === '1px',
      locationActionHeight: locationAction?.getBoundingClientRect().height ?? 0,
      locationActionWidth: locationAction?.getBoundingClientRect().width ?? 0,
      locationActionBackground: locationAction ? getComputedStyle(locationAction).backgroundColor : "",
      locationActionLabelFits: locationActionLabel
        ? locationActionLabel.scrollWidth <= locationActionLabel.clientWidth
        : false,
      locationActionLabelClientWidth: locationActionLabel?.clientWidth ?? 0,
      locationActionLabelScrollWidth: locationActionLabel?.scrollWidth ?? 0,
      menuWidth: menu.getBoundingClientRect().width,
      projectCount: rows.length,
      projectHeights: rows.map((row) => row.getBoundingClientRect().height),
      text: menu.textContent,
    };
  })()`, true);

  assert(snapshot.projectCount === 2, `Expected two additional attached Projects: ${JSON.stringify(snapshot)}`);
  assert(snapshot.projectHeights.every((height) => height === 32), `Project rows must remain 32px: ${JSON.stringify(snapshot)}`);
  assert(snapshot.currentLocationHeight === 32, `Current location must stay one compact row: ${JSON.stringify(snapshot)}`);
  assert(!snapshot.hasRepeatedProjectName, `Header Project name must not repeat inside the menu: ${JSON.stringify(snapshot)}`);
  assert(snapshot.locationActionHeight === 28, `Cloud setup action must stay compact: ${JSON.stringify(snapshot)}`);
  assert(snapshot.locationActionWidth === snapshot.currentLocationWidth, `Cloud setup action must align with the selected location row: ${JSON.stringify(snapshot)}`);
  assert(snapshot.currentLocationBackground !== "rgba(0, 0, 0, 0)", `Current location must have a selected background: ${JSON.stringify(snapshot)}`);
  assert(snapshot.locationActionBackground === "rgba(0, 0, 0, 0)", `Cloud setup action must remain visually quiet at rest: ${JSON.stringify(snapshot)}`);
  assert(snapshot.locationActionLabelFits, `Cloud setup label must remain fully visible: ${JSON.stringify(snapshot)}`);
  assert(snapshot.menuWidth === 280, `Workspace menu must remain 280px wide: ${JSON.stringify(snapshot)}`);
  assert(snapshot.addProjectEnabled, `Add Project must be enabled: ${JSON.stringify(snapshot)}`);
  assert(snapshot.hasHomeDivider, `Home divider is missing: ${JSON.stringify(snapshot)}`);
  assert(
    snapshot.text.includes("Go to Home")
      && snapshot.text.includes("Online")
      && snapshot.text.includes("Make it always available to Agents")
      && snapshot.text.includes("Add Project"),
    `Required actions are missing: ${JSON.stringify(snapshot)}`,
  );
  assert(!snapshot.text.includes("Open Folder in New Window"), `New-window action leaked into the composition menu: ${JSON.stringify(snapshot)}`);

  const capture = await window.capturePage();
  assert(!capture.isEmpty(), "Workspace menu screenshot capture was empty.");
  if (screenshotPath) {
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await writeFile(screenshotPath, capture.toPNG());
  }
  console.log(`workspace menu visual smoke passed: ${JSON.stringify(snapshot)}`);
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
