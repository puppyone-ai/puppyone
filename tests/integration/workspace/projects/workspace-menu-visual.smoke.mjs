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
  for (const state of ["local-only", "local-github", "local-cloud", "cloud-only"]) {
  const url = pathToFileURL(rendererPath);
  url.searchParams.set("project-state", state);
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
    const currentLocation = menu.querySelector('.desktop-project-current-location');
    const visual = menu.querySelector('.desktop-project-location-visual');
    const locationAction = menu.querySelector('[data-location-action="enable-cloud-versions"]');
    const locationActionLabel = locationAction?.querySelector('.desktop-menu-item-label');
    const versions = [...menu.querySelectorAll('[data-backup-details]')];
    const labels = versions.map(row => row.querySelector('.desktop-menu-item-label'));
    const details = versions.map(row => row.querySelector('.desktop-menu-item-detail'));
    const header = document.querySelector('.workspace-menu-visual-titlebar');
    return {
      state: document.querySelector('[data-project-state]')?.dataset.projectState,
      location: currentLocation?.dataset.projectLocation,
      currentLocationHeight: currentLocation?.getBoundingClientRect().height ?? 0,
      currentLocationBackground: getComputedStyle(visual).backgroundColor,
      menuBackground: getComputedStyle(menu).backgroundColor,
      headerBackground: getComputedStyle(header).backgroundColor,
      menuShadow: getComputedStyle(menu).boxShadow,
      hasLocationAction: Boolean(locationAction),
      locationActionBackground: locationAction ? getComputedStyle(locationAction).backgroundColor : "",
      locationActionLabelFits: locationActionLabel
        ? locationActionLabel.scrollWidth <= locationActionLabel.clientWidth
        : false,
      menuWidth: menu.getBoundingClientRect().width,
      providerNames: versions.map(row => row.dataset.backupDetails),
      providerHeights: versions.map(row => row.getBoundingClientRect().height),
      providerLabelLefts: labels.map(label => label.getBoundingClientRect().left),
      providerDetailLefts: details.map(detail => detail?.getBoundingClientRect().left),
      providerLabelsFit: labels.every(label => label.scrollWidth <= label.clientWidth),
      providerDetailsFit: details.every(detail => detail && detail.scrollWidth <= detail.clientWidth),
      providerTimes: versions.map(row => row.querySelector('time')?.dateTime),
      versionCloudIcon: Boolean(menu.querySelector('.desktop-project-remote-copies .lucide-cloud')),
      cloudEditionLabel: menu.querySelector('.desktop-project-cloud-edition .desktop-menu-item-label')?.textContent,
      cloudEditionAction: menu.querySelector('.desktop-project-cloud-edition .desktop-project-backup-view')?.textContent,
      cloudEditionCurrent: menu.querySelector('.desktop-project-cloud-edition .desktop-project-edition-current')?.textContent,
      cloudEditionFontSize: menu.querySelector('.desktop-project-cloud-edition .desktop-project-backup-heading')
        ? parseFloat(getComputedStyle(menu.querySelector('.desktop-project-cloud-edition .desktop-project-backup-heading')).fontSize) : null,
      githubFontSize: menu.querySelector('[data-backup-details="github"] .desktop-project-backup-heading')
        ? parseFloat(getComputedStyle(menu.querySelector('[data-backup-details="github"] .desktop-project-backup-heading')).fontSize) : null,
      githubIsSecondary: Boolean(menu.querySelector('.desktop-project-secondary-copies [data-backup-details="github"]')),
      setupBeforeGithub: locationAction ? Boolean(locationAction.compareDocumentPosition(menu.querySelector('[data-backup-details="github"]') ?? locationAction) & Node.DOCUMENT_POSITION_FOLLOWING) : false,
      hasFeatureCopy: /Version recovery|Members and Agents|Access control/.test(menu.textContent),
      currentPath: currentLocation.querySelector('.desktop-project-current-location-path')?.textContent,
      localTitleLeft: currentLocation.querySelector('.desktop-project-location-title')?.getBoundingClientRect().left,
      localPathLeft: currentLocation.querySelector('.desktop-project-path-text')?.getBoundingClientRect().left,
      cloudBackground: menu.querySelector('.desktop-project-cloud-edition') ? getComputedStyle(menu.querySelector('.desktop-project-cloud-edition')).backgroundColor : null,
      cloudMarkWidth: menu.querySelector('.desktop-project-cloud-edition svg')?.getBoundingClientRect().width,
      localMarkWidth: currentLocation.querySelector('.desktop-project-current-location-mark svg')?.getBoundingClientRect().width,
      hasShareAction: Boolean(menu.querySelector('[data-location-action="share"]')),
      text: menu.textContent,
    };
  })()`, true);

  const evidence = JSON.stringify(snapshot);
  assert(snapshot.state === state, `Wrong fixture state: ${evidence}`);
  assert(snapshot.menuWidth === 224, `Project card must stay compact: ${evidence}`);
  assert(snapshot.currentLocationHeight === 108, `Device card height drifted: ${evidence}`);
  assert(snapshot.menuBackground === snapshot.headerBackground, `Popup must share the Header background: ${evidence}`);
  assert(snapshot.currentLocationBackground !== snapshot.menuBackground, `Device card needs a distinct background: ${evidence}`);
  assert(snapshot.menuShadow !== "none", `Floating card needs its scoped shadow: ${evidence}`);
  assert(!snapshot.hasShareAction, `Project-version setup must not route to Share: ${evidence}`);
  assert(!snapshot.hasFeatureCopy, `Feature promotion must stay out of the first-level card: ${evidence}`);
  assert(snapshot.location === (state === "cloud-only" ? "cloud" : "local"), `Working-copy identity drifted: ${evidence}`);
  if (state === "local-only") {
    assert(snapshot.providerNames.length === 0, `Unactivated versions cannot claim a remote service: ${evidence}`);
    assert(snapshot.hasLocationAction && snapshot.locationActionLabelFits, `Activation CTA is missing or clipped: ${evidence}`);
    assert(snapshot.locationActionBackground === "rgba(0, 0, 0, 0)", `Activation must stay quiet: ${evidence}`);
  } else if (state === "local-github") {
    assert(snapshot.providerNames.join(",") === "github", `GitHub does not activate the Cloud edition: ${evidence}`);
    assert(snapshot.hasLocationAction && snapshot.locationActionLabelFits && snapshot.setupBeforeGithub, `Cloud setup must precede third-priority GitHub: ${evidence}`);
    assert(snapshot.githubIsSecondary, `GitHub must be a secondary service row: ${evidence}`);
    assert(!snapshot.text.includes("Files are only on this Mac"), `GitHub must not get a local-only claim: ${evidence}`);
  } else {
    assert(!snapshot.hasLocationAction, `Linked project must not offer activation again: ${evidence}`);
    assert(snapshot.providerNames.join(",") === "puppyone-cloud,github", `Both version services must be listed: ${evidence}`);
    assert(snapshot.providerLabelsFit && snapshot.providerDetailsFit, `Version text is clipped: ${evidence}`);
    assert(snapshot.cloudBackground === snapshot.currentLocationBackground && snapshot.providerHeights[0] === snapshot.currentLocationHeight, `Local and Cloud must share the same carrier: ${evidence}`);
    assert(snapshot.cloudMarkWidth === snapshot.localMarkWidth, `Local and Cloud icon sizes must match: ${evidence}`);
    assert(snapshot.githubIsSecondary && snapshot.githubFontSize < snapshot.cloudEditionFontSize, `GitHub must be below the Cloud edition in visual priority: ${evidence}`);
    assert(snapshot.providerLabelLefts[0] === snapshot.providerLabelLefts[1], `Cloud and service labels must align: ${evidence}`);
    assert(snapshot.providerDetailLefts.every((left, index) => left === snapshot.providerLabelLefts[index]), `Metadata must align with provider names: ${evidence}`);
    assert(snapshot.providerTimes.every(time => time === "2026-10-01T14:32:00Z"), `Remote version dates must stay factual: ${evidence}`);
    assert(snapshot.versionCloudIcon && snapshot.cloudEditionLabel === "Cloud Version", `Cloud edition identity is missing: ${evidence}`);
    assert(state === "cloud-only" ? snapshot.cloudEditionCurrent === "Current" && !snapshot.cloudEditionAction
      : snapshot.cloudEditionAction === "Switch", `Use Switch for another edition and Current for this one: ${evidence}`);
  }
  if (state !== "cloud-only") {
    assert(snapshot.localTitleLeft === snapshot.localPathLeft, `Local title and path must align: ${evidence}`);
    if (snapshot.providerLabelLefts.length) assert(snapshot.localTitleLeft === snapshot.providerLabelLefts[0], `All carrier text must align: ${evidence}`);
  }
  assert(state === "cloud-only" ? !snapshot.currentPath : snapshot.currentPath === "~/Desktop/To-Do-List", `Local path identity drifted: ${evidence}`);

  const capture = await window.capturePage();
  assert(!capture.isEmpty(), "Workspace menu screenshot capture was empty.");
  if (screenshotPath) {
    await mkdir(path.dirname(screenshotPath), { recursive: true });
    const extension = path.extname(screenshotPath);
    const statePath = screenshotPath.slice(0, extension ? -extension.length : undefined) + "-" + state + (extension || ".png");
    await writeFile(statePath, capture.toPNG());
  }
  console.log(`workspace menu visual smoke passed: ${JSON.stringify(snapshot)}`);
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
