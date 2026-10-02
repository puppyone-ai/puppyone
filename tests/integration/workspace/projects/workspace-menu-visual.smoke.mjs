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
    const cards = [...menu.querySelectorAll('.desktop-project-location-visual, .desktop-project-backup-details:not(.desktop-project-location-visual), .desktop-project-location-actions')];
    const localMark = currentLocation.querySelector('.desktop-project-current-location-mark, .desktop-menu-item-icon');
    const localTitle = currentLocation.querySelector('.desktop-project-location-title, .desktop-menu-item-label');
    const labels = versions.map(row => row.querySelector('.desktop-menu-item-label'));
    const details = versions.map(row => row.querySelector('.desktop-menu-item-detail'));
    const centerY = element => {
      const rect = element?.getBoundingClientRect();
      return rect ? rect.top + rect.height / 2 : null;
    };
    const header = document.querySelector('.workspace-menu-visual-titlebar');
    return {
      state: document.querySelector('[data-project-state]')?.dataset.projectState,
      location: currentLocation?.dataset.projectLocation,
      currentLocationHeight: currentLocation?.getBoundingClientRect().height ?? 0,
      currentLocationBackground: getComputedStyle(visual).backgroundColor,
      menuBackground: getComputedStyle(menu).backgroundColor,
      headerBackground: getComputedStyle(header).backgroundColor,
      menuShadow: getComputedStyle(menu).boxShadow,
      menuBorder: getComputedStyle(menu).borderTopColor,
      cardBorder: getComputedStyle(visual).outlineColor,
      hasLocationAction: Boolean(locationAction),
      locationActionBackground: locationAction ? getComputedStyle(locationAction).backgroundColor : "",
      locationActionLabelFits: locationActionLabel
        ? locationActionLabel.scrollWidth <= locationActionLabel.clientWidth
        : false,
      menuWidth: menu.getBoundingClientRect().width,
      menuPadding: parseFloat(getComputedStyle(menu).paddingLeft),
      cardGaps: cards.slice(1).map((card, index) => card.getBoundingClientRect().top - cards[index].getBoundingClientRect().bottom),
      currentBadgeCount: menu.querySelectorAll('.desktop-project-edition-current').length,
      currentBadgeText: currentLocation.querySelector('.desktop-project-edition-current')?.textContent,
      currentBadgeFits: (() => {
        const badge = currentLocation.querySelector('.desktop-project-edition-current');
        return badge && badge.getBoundingClientRect().right <= currentLocation.getBoundingClientRect().right;
      })(),
      currentLocationAriaCurrent: currentLocation.getAttribute('aria-current'),
      currentTitleFits: localTitle.scrollWidth <= localTitle.clientWidth,
      localIconColor: getComputedStyle(localMark).color,
      localTitleColor: getComputedStyle(localTitle).color,
      headerIconColor: getComputedStyle(header.querySelector('.desktop-titlebar-workspace-mark')).color,
      headerTitleColor: getComputedStyle(header.querySelector('.desktop-titlebar-workspace-name')).color,
      providerNames: versions.map(row => row.dataset.backupDetails),
      providerHeights: versions.map(row => row.getBoundingClientRect().height),
      providerLabelLefts: labels.map(label => label.getBoundingClientRect().left),
      providerDetailLefts: details.map(detail => detail?.getBoundingClientRect().left),
      providerLabelsFit: labels.every(label => label.scrollWidth <= label.clientWidth),
      providerDetailsFit: details.every(detail => detail && detail.scrollWidth <= detail.clientWidth),
      providerTimes: versions.map(row => row.querySelector('time')?.dateTime),
      versionCloudIcon: Boolean(menu.querySelector('.desktop-project-cloud-edition .lucide-cloud')),
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
      localMarkCenterY: centerY(localMark),
      localTitleCenterY: centerY(localTitle),
      localPathFontSize: currentLocation.querySelector('.desktop-project-current-location-path')
        ? getComputedStyle(currentLocation.querySelector('.desktop-project-current-location-path')).fontSize : null,
      providerMarkCenterYs: versions.map(row => centerY(row.querySelector('.desktop-menu-item-icon'))),
      providerTitleCenterYs: labels.map(label => centerY(label)),
      providerDetailFontSizes: details.map(detail => detail ? getComputedStyle(detail).fontSize : null),
      providerIconColors: versions.map(row => getComputedStyle(row.querySelector('.desktop-menu-item-icon')).color),
      providerTitleColors: labels.map(label => getComputedStyle(label).color),
      cloudBackground: menu.querySelector('.desktop-project-cloud-edition') ? getComputedStyle(menu.querySelector('.desktop-project-cloud-edition')).backgroundColor : null,
      cloudMarkWidth: menu.querySelector('.desktop-project-cloud-edition svg')?.getBoundingClientRect().width,
      localMarkWidth: localMark.querySelector('svg')?.getBoundingClientRect().width,
      hasShareAction: Boolean(menu.querySelector('[data-location-action="share"]')),
      text: menu.textContent,
    };
  })()`, true);

  const evidence = JSON.stringify(snapshot);
  assert(snapshot.state === state, `Wrong fixture state: ${evidence}`);
  assert(snapshot.menuWidth === 248, `Project card must fit the current-location label: ${evidence}`);
  assert(snapshot.currentLocationHeight === 64 && snapshot.providerHeights.every(height => height === 64), `Project cards must stay compact and consistent: ${evidence}`);
  assert(snapshot.menuPadding === 8 && snapshot.cardGaps.every(gap => gap === snapshot.menuPadding), `Card gaps must match the spacious menu padding: ${evidence}`);
  assert(snapshot.currentBadgeCount === 1 && snapshot.currentBadgeText === "Current" && snapshot.currentBadgeFits
    && snapshot.currentLocationAriaCurrent === "true", `Exactly one working copy must be clearly marked current: ${evidence}`);
  assert(snapshot.currentTitleFits, `Current-location title is clipped: ${evidence}`);
  assert(snapshot.localMarkWidth === 16, `Location icons must stay small: ${evidence}`);
  assert(snapshot.localIconColor === snapshot.localTitleColor && snapshot.headerIconColor === snapshot.headerTitleColor
    && snapshot.providerIconColors.every((color, index) => color === snapshot.providerTitleColors[index]), `Icons must follow their title colors: ${evidence}`);
  assert(snapshot.localMarkCenterY === snapshot.localTitleCenterY, `Device mark must align with the first line: ${evidence}`);
  assert(snapshot.providerMarkCenterYs.every((center, index) => center === snapshot.providerTitleCenterYs[index]), `Service marks must align with the first line: ${evidence}`);
  assert(snapshot.menuBackground === snapshot.headerBackground, `Popup must share the Header background: ${evidence}`);
  assert(snapshot.currentLocationBackground !== snapshot.menuBackground, `Device card needs a distinct background: ${evidence}`);
  assert(snapshot.menuShadow !== "none", `Floating card needs its scoped shadow: ${evidence}`);
  assert(snapshot.menuBorder === snapshot.cardBorder, `Popup border must follow the same themed divider as its cards: ${evidence}`);
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
    assert(snapshot.providerNames.join(",") === "puppyone-cloud,github", `Both version services must be listed exactly once: ${evidence}`);
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
    assert(snapshot.providerDetailFontSizes.every(size => size === snapshot.localPathFontSize), `Path and update metadata must share typography: ${evidence}`);
    if (snapshot.providerLabelLefts.length) assert(snapshot.localTitleLeft === snapshot.providerLabelLefts[0], `All carrier text must align: ${evidence}`);
  }
  assert(state === "cloud-only" ? !snapshot.currentPath : snapshot.currentPath === "~/Desktop/To-Do-List", `Local path identity drifted: ${evidence}`);

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
