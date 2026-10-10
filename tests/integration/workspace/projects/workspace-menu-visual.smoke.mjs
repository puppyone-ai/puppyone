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
const inlineObservations = [];
const slideObservations = [];

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
  let projectRowAppearance;
  for (const state of ["local-only", "local-github", "local-cloud-no-github", "local-cloud", "cloud-only", "resolving", "signed-out"]) {
  const url = pathToFileURL(rendererPath);
  url.searchParams.set("project-state", state);
  url.searchParams.set("theme", theme);
  url.searchParams.set("platform", platform);
  url.hash = "workspace-menu-visual-smoke";
  await window.loadURL(url.href);
  await waitForRenderer(window, "Boolean(document.querySelector('.desktop-titlebar-location-button'))");
  if (!projectRowAppearance) projectRowAppearance = await readProjectRowAppearance(window);
  await window.webContents.executeJavaScript("document.querySelector('.desktop-titlebar-location-button').click()");
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
    const create = menu.querySelector('button[data-cloud-action="create"]');
    const separator = track.querySelector('.desktop-project-location-separator');
    const separatorSpacing = separator ? separator.getBoundingClientRect().height
      + parseFloat(getComputedStyle(separator).marginTop) + parseFloat(getComputedStyle(separator).marginBottom)
      + parseFloat(getComputedStyle(track).gap) : 0;
    const github = menu.querySelector('.desktop-project-repository-link');
    const header = document.querySelector('.workspace-menu-visual-titlebar');
    const accentReference = document.createElement('span');
    accentReference.style.color = 'var(--po-accent-text)';
    accentReference.style.display = 'none';
    menu.append(accentReference);
    const accentColor = getComputedStyle(accentReference).color;
    accentReference.remove();
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const luminance = color => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = getComputedStyle(menu).backgroundColor;
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
    const selectedLuminance = luminance(getComputedStyle(selected).backgroundColor);
    return {
      locale: document.documentElement.lang,
      cloudEntry: row.dataset.cloudEntry,
      devicePlatform: document.querySelector('[data-device-platform]')?.dataset.devicePlatform,
      controlsFit: buttons.every(button => button.getBoundingClientRect().right <= track.getBoundingClientRect().right + 1)
        && (!github || github.getBoundingClientRect().right <= menu.getBoundingClientRect().right - 6),
      createIcon: !!create?.querySelector('[data-cloud-icon="ant-design"]'),
      separatorSpacing,
      createColor: create ? getComputedStyle(create).color : null,
      accentColor,
      createContrast: create ? contrast(luminance(getComputedStyle(create).color), luminance(getComputedStyle(create).backgroundColor)) : null,
      state: document.querySelector('[data-project-state]')?.dataset.projectState,
      location: selected.dataset.projectLocation,
      currentCount: menu.querySelectorAll('[aria-current="true"]').length,
      pressedCount: menu.querySelectorAll('[aria-pressed="true"]').length,
      menuWidth: menu.getBoundingClientRect().width,
      menuHeight: menu.getBoundingClientRect().height,
      menuPadding: parseFloat(getComputedStyle(menu).paddingLeft),
      rowGap: parseFloat(getComputedStyle(track).gap),
      buttonHeights: buttons.map(button => button.getBoundingClientRect().height),
      buttonYs: buttons.map(button => button.getBoundingClientRect().y),
      buttonXs: buttons.map(button => button.getBoundingClientRect().x),
      buttonWidths: buttons.map(button => button.getBoundingClientRect().width),
      fonts: buttons.map(button => getComputedStyle(button).font),
      labels: buttons.map(button => button.textContent),
      labelsFit: buttons.every(button => {
        const label = button.querySelector('.desktop-menu-item-label');
        return button.scrollWidth <= button.clientWidth && label.scrollWidth <= label.clientWidth;
      }),
      selectedTextColor: getComputedStyle(selected).color,
      normalTextColor: getComputedStyle(menu).color,
      selectedContrast: contrast(selectedLuminance, luminance(getComputedStyle(selected).color)),
      iconWidths: buttons.map(button => button.querySelector('.desktop-menu-item-icon').getBoundingClientRect().width),
      iconColorsMatch: buttons.every(button => getComputedStyle(button.querySelector('.desktop-menu-item-icon')).color === getComputedStyle(button.querySelector('.desktop-menu-item-label')).color),
      selectedBackground: getComputedStyle(selected).backgroundColor,
      selectedCheck: !!selected.querySelector('.desktop-menu-item-trailing .lucide-check'),
      checkCount: menu.querySelectorAll('.desktop-menu-item-trailing .lucide-check').length,
      hasSlider: !!menu.querySelector('.desktop-project-location-indicator'),
      headerColorsMatch: getComputedStyle(header.querySelector('.desktop-titlebar-workspace-mark')).color === getComputedStyle(header.querySelector('.desktop-titlebar-workspace-name')).color,
      menuBackground: getComputedStyle(menu).backgroundColor,
      headerBackground: getComputedStyle(header).backgroundColor,
      menuShadow: getComputedStyle(menu).boxShadow,
      menuOutline: getComputedStyle(menu).outlineStyle,
      selectedShadow: getComputedStyle(selected).boxShadow,
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
  assert(snapshot.menuWidth >= 200 && snapshot.menuWidth <= 480
    && snapshot.menuHeight === 2 * projectRowAppearance.height + 10 + snapshot.separatorSpacing && snapshot.controlsFit,
    `Project location list must fit translated labels within two compact rows: ${evidence}`);
  assert(snapshot.menuPadding === 3 && snapshot.rowGap === 2, `List padding and row gap must match the project menu: ${evidence}`);
  assert(snapshot.buttonHeights.every(height => height === projectRowAppearance.height)
    && snapshot.buttonYs[1] === snapshot.buttonYs[0] + projectRowAppearance.height + snapshot.rowGap + snapshot.separatorSpacing
    && snapshot.buttonXs[0] === snapshot.buttonXs[1] && snapshot.buttonWidths[0] === snapshot.buttonWidths[1],
    `Local must appear above Cloud in equal full-width project-menu rows: ${evidence}`);
  assert(snapshot.currentCount === 1 && snapshot.pressedCount === 1, `Exactly one surface must be selected: ${evidence}`);
  const creating = state === "local-only" || state === "local-github";
  assert(snapshot.locale === locale && snapshot.devicePlatform === platform, `Wrong locale or device platform: ${evidence}`);
  assert(snapshot.cloudEntry === (creating ? "create" : "switch"), `Use creation only for a confirmed unhosted project: ${evidence}`);
  assert(snapshot.labelsFit && snapshot.labels.join("|") === [catalog[platform === "macos" ? "workspaceSwitcher.location.thisMac" : "workspaceSwitcher.location.thisComputer"], catalog[creating ? "workspaceSwitcher.shareToCloud" : "navigation.cloud"]].join("|"), `Only the two unclipped localized actions belong in this menu: ${evidence}`);
  assert(creating ? snapshot.createIcon && snapshot.separatorSpacing === 7
    && snapshot.createContrast >= 4.5 && snapshot.createColor === snapshot.accentColor
    : !snapshot.createIcon && snapshot.separatorSpacing === 0 && snapshot.createContrast === null,
    `Unhosted projects keep a readable Share to Cloud row with the shared Cloud mark and a compact divider: ${evidence}`);
  assert(snapshot.iconWidths.every(width => width === projectRowAppearance.iconWidth) && snapshot.iconColorsMatch
    && (state === "cloud-only" || snapshot.headerColorsMatch), `Small icons must match their labels; the committed Cloud Header mark keeps its brand tint: ${evidence}`);
  assert(snapshot.selectedTextColor === projectRowAppearance.color && snapshot.selectedContrast >= 7
    && snapshot.selectedBackground === projectRowAppearance.background && snapshot.selectedShadow === projectRowAppearance.shadow
    && snapshot.fonts.every(font => font === projectRowAppearance.font)
    && snapshot.selectedCheck && snapshot.checkCount === 1 && !snapshot.hasSlider,
    `Selection, typography and checkmark must match the project menu: ${evidence}`);
  assert(snapshot.menuBackground === snapshot.headerBackground && snapshot.menuShadow !== "none", `Popup must use themed Header color and a floating shadow: ${evidence}`);
  assert(snapshot.location === (state === "cloud-only" ? "cloud" : "local"), `Current surface drifted: ${evidence}`);
  assert(snapshot.localDisabled === (state === "cloud-only") && !snapshot.cloudDisabled, `Destination availability drifted: ${evidence}`);
  assert(!snapshot.githubUrl, `Project location controls must omit the GitHub shortcut: ${evidence}`);
  assert(snapshot.menuOutline === "none", `Initial dialog focus must not outline the whole popup: ${evidence}`);
  const localSelection = observations.find(scene => scene.locale === locale && scene.platform === platform
    && scene.theme === theme && scene.state === "local-cloud");
  if (state === "cloud-only") assert(snapshot.selectedBackground === localSelection.selectedBackground
    && snapshot.selectedShadow === localSelection.selectedShadow,
    `Local and Cloud must use the same selected row appearance: ${evidence}`);

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
  if (!creating && state !== "cloud-only") await checkPopoverSelection(window);
  await checkInlinePresentation(window, url, { locale, platform, theme, state }, catalog);
  }
  }
  }
  console.log(`workspace menu visual smoke passed: ${locale}, 42 scenarios`);
  }
  if (screenshotPath) {
    await writeFile(path.join(path.dirname(screenshotPath), "visual-results.json"), JSON.stringify({ popover: observations, headerIcons: inlineObservations, slides: slideObservations }, null, 2) + "\n");
  }
  console.log(`workspace menu visual smoke passed: ${observations.length} scenarios`);
  console.log(`Header location icons visual smoke passed: ${inlineObservations.length} scenarios`);
  console.log(`Header location slider motion passed: ${slideObservations.length} transitions`);
  } finally {
    if (!window.isDestroyed()) window.destroy();
    app.quit();
  }
}

async function checkInlinePresentation(window, url, scene, catalog) {
  const inlineUrl = new URL(url);
  inlineUrl.searchParams.set("location-presentation", "header-icons");
  await window.loadURL(inlineUrl.href);
  await waitForRenderer(window, "Boolean(document.querySelector('[data-location-presentation=\"header-icons\"] button[data-project-location=\"cloud\"]'))");
  for (const width of [996, 640]) {
    window.setContentSize(width, 744);
    await window.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))", true);
    const snapshot = await window.webContents.executeJavaScript(`(() => {
      const wrap = document.querySelector('[data-location-presentation="header-icons"]');
      const buttons = [...wrap.querySelectorAll('button[data-project-location]')];
      const label = document.querySelector('.desktop-titlebar-workspace-name');
      const plate = wrap.querySelector('.desktop-project-location-indicator');
      const selected = wrap.querySelector('button[aria-pressed="true"]');
      const track = wrap.querySelector('.desktop-project-location-tabs');
      const header = wrap.closest('.desktop-titlebar');
      const peer = document.createElement('button');
      peer.className = 'desktop-titlebar-action';
      peer.setAttribute('aria-pressed', 'true');
      header.append(peer);
      const peerBounds = peer.getBoundingClientRect();
      const peerStyle = getComputedStyle(peer);
      const peerSelection = {
        background: peerStyle.backgroundColor, image: peerStyle.backgroundImage,
        color: peerStyle.color, shadow: peerStyle.boxShadow,
        border: peerStyle.borderTop,
      };
      peer.remove();
      const rect = element => {
        const r = element.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
      };
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      const luminance = color => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = getComputedStyle(header).backgroundColor;
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
      const headerLuminance = luminance(getComputedStyle(header).backgroundColor);
      return {
        hasPopup: !!document.querySelector('.desktop-project-location-menu'),
        name: label.textContent, nameBounds: rect(label), nameFont: getComputedStyle(label).font,
        nameColor: getComputedStyle(label).color,
        colorScheme: getComputedStyle(header).colorScheme,
        selectedContrast: contrast(selectedLuminance, luminance(getComputedStyle(selected).color)),
        selectedEmphasis: contrast(selectedLuminance, headerLuminance),
        selectedLighter: selectedLuminance > headerLuminance,
        buttons: buttons.map(button => ({ bounds: rect(button), label: button.getAttribute('aria-label'),
          text: button.textContent, color: getComputedStyle(button).color,
          font: getComputedStyle(button).font, selected: button.getAttribute('aria-pressed') === 'true',
          markColor: getComputedStyle(button.querySelector('.desktop-project-location-tab-mark')).color,
          disabled: button.disabled })),
        currentCount: wrap.querySelectorAll('button[aria-current="true"]').length,
        pressedCount: wrap.querySelectorAll('button[aria-pressed="true"]').length,
        selected: selected.dataset.projectLocation,
        plate: rect(plate), selectedBounds: rect(selected),
        selectedBackground: getComputedStyle(plate).backgroundColor,
        selectedImage: getComputedStyle(plate).backgroundImage,
        selectedShadow: getComputedStyle(plate).boxShadow,
        selectedBorder: getComputedStyle(plate).borderTop,
        headerBackground: getComputedStyle(header).backgroundColor,
        peer: { width: peerBounds.width, height: peerBounds.height, ...peerSelection },
        track: { bounds: rect(track), background: getComputedStyle(track).backgroundColor,
          padding: parseFloat(getComputedStyle(track).paddingLeft),
          border: getComputedStyle(track).borderTopWidth, radius: getComputedStyle(track).borderRadius },
        buttonBackgrounds: buttons.map(button => getComputedStyle(button).backgroundColor),
        loading: !!buttons[1].querySelector('[data-puppy-loader="pulse-grid"]'),
        create: buttons[1].dataset.cloudAction === 'create',
        plus: !!buttons[1].querySelector('.lucide-plus'),
      };
    })()`, true);
    const evidence = JSON.stringify({ ...scene, width, ...snapshot });
    const creating = scene.state === "local-only" || scene.state === "local-github";
    assert(!snapshot.hasPopup && snapshot.name === "To-Do-List", `Inline experiment must keep the name and move location controls into Header: ${evidence}`);
    assert(snapshot.buttons.length === 2 && snapshot.buttons.every(button =>
      (button.selected ? button.text === catalog[scene.state === "cloud-only" ? "navigation.cloud" : "workspaceSwitcher.location.local"]
        : button.text === "" && button.bounds.width === snapshot.peer.width - snapshot.track.padding)
      && button.font === snapshot.nameFont
      && (!button.selected || button.color === snapshot.peer.color)
      && button.bounds.height === snapshot.peer.height - 2 * snapshot.track.padding
      && button.bounds.x >= snapshot.track.bounds.x + snapshot.track.padding
      && button.bounds.right <= snapshot.track.bounds.right - snapshot.track.padding
      && button.bounds.y >= snapshot.track.bounds.y + snapshot.track.padding
      && button.bounds.bottom <= snapshot.track.bounds.bottom - snapshot.track.padding
      && button.bounds.x >= 0 && button.bounds.right <= width && button.bounds.bottom <= 48
      && button.color === button.markColor), `Header current label and icons must fit, match project typography and inherit foreground: ${evidence}`);
    assert(snapshot.nameBounds.right <= snapshot.buttons[0].bounds.x + 1, `Project name and icons must not overlap: ${evidence}`);
    assert(snapshot.buttons[0].label === catalog["workspaceSwitcher.location.local"]
      && snapshot.buttons[1].label === catalog[creating ? "workspaceSwitcher.shareToCloud" : "navigation.cloud"], `Header actions must retain localized accessible names: ${evidence}`);
    assert(snapshot.currentCount === 1 && snapshot.pressedCount === 1 && snapshot.selected === (scene.state === "cloud-only" ? "cloud" : "local"), `Inline selection must match committed state: ${evidence}`);
    assert(snapshot.selectedBackground === snapshot.peer.background && snapshot.selectedImage === snapshot.peer.image
      && snapshot.selectedShadow === snapshot.peer.shadow && snapshot.selectedBorder === snapshot.peer.border,
      `Location selection must match the Header's selected action surface, shadow and border: ${evidence}`);
    if (snapshot.colorScheme === "dark") assert(snapshot.selectedContrast >= 4.5,
      `Dark Header selected text must remain readable: ${evidence}`);
    assert(Math.abs(snapshot.plate.x - snapshot.selectedBounds.x) < 1 && Math.abs(snapshot.plate.y - snapshot.selectedBounds.y) < 1
      && Math.abs(snapshot.plate.width - snapshot.selectedBounds.width) < 1 && snapshot.plate.height === snapshot.selectedBounds.height,
      `Indicator must fit the inset active location without replay: ${evidence}`);
    assert(Math.abs(snapshot.track.bounds.width - snapshot.buttons.reduce((sum, button) => sum + button.bounds.width, 0) - 2 - 2 * snapshot.track.padding) < 1
      && snapshot.track.bounds.height === snapshot.peer.height
      && snapshot.track.padding === 2
      && snapshot.track.background === (scene.style === "windows-xp" ? "rgba(0, 0, 0, 0)" : snapshot.headerBackground)
      && snapshot.selectedBackground !== "rgb(255, 255, 255)" && snapshot.selectedBackground !== snapshot.headerBackground
      && snapshot.buttonBackgrounds.every(background => background === "rgba(0, 0, 0, 0)"),
      `Keep the selected shade inset inside the Header-sized track: ${evidence}`);
    assert(snapshot.loading === (scene.state === "resolving") && snapshot.create === creating && !snapshot.plus,
      `Keep the Cloud glyph and shared loading/creation state: ${evidence}`);
    assert(snapshot.buttons[0].disabled === (scene.state === "cloud-only") && !snapshot.buttons[1].disabled,
      `Inline destination availability must match the popup: ${evidence}`);
    inlineObservations.push({ ...scene, width, ...snapshot });
    if (screenshotPath && scene.locale === "en" && scene.platform === "macos" && scene.state === "local-cloud") {
      const capture = await window.capturePage({ x: 0, y: 0, width, height: 100 });
      await writeFile(path.join(path.dirname(screenshotPath), `header-icons-${scene.theme}-${width}.png`), capture.toPNG());
    }
  }
  if (scene.locale === "en" && scene.platform === "macos" && scene.state === "local-cloud") {
    for (const direction of ["ltr", "rtl"]) {
      for (const destination of ["cloud", "local"]) {
        slideObservations.push({ theme: scene.theme, direction, destination,
          ...await checkHeaderSlide(window, direction, destination) });
      }
    }
  }
  window.setContentSize(996, 744);
}

async function checkHeaderSlide(window, direction, destination) {
  const result = await window.webContents.executeJavaScript(`(async () => {
    document.documentElement.dir = ${JSON.stringify(direction)};
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const track = document.querySelector('[data-presentation="header-icons"] .desktop-project-location-tabs');
    const plate = track.querySelector('.desktop-project-location-indicator');
    const target = track.querySelector('button[data-project-location=${destination}]');
    const before = plate.getBoundingClientRect().x;
    const geometry = track.getBoundingClientRect();
    const frames = [];
    const started = performance.now();
    target.click();
    await new Promise(resolve => {
      const sample = () => {
        const p = plate.getBoundingClientRect(), t = track.getBoundingClientRect();
        frames.push({ x: p.x, width: t.width, height: t.height, busy: track.getAttribute('aria-busy'),
          retained: plate === track.querySelector('.desktop-project-location-indicator') });
        if (performance.now() - started < 430) requestAnimationFrame(sample);
        else resolve();
      };
      requestAnimationFrame(sample);
    });
    return { before, after: plate.getBoundingClientRect().x, target: target.getBoundingClientRect().x,
      travel: Math.abs(target.getBoundingClientRect().x - before), width: geometry.width, height: geometry.height,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      selected: track.dataset.location, current: track.querySelector('button[aria-current="true"]').dataset.projectLocation,
      frames };
  })()`, true);
  const evidence = JSON.stringify({ direction, destination, ...result });
  assert(result.selected === destination && result.current === "local"
    && Math.abs(result.after - result.target) < 1 && Math.abs(Math.abs(result.after - result.before) - result.travel) < 1,
    `Click must move the plate immediately while the committed provider can still be local: ${evidence}`);
  assert(result.frames.every(frame => frame.retained && frame.width === result.width && frame.height === result.height
    && (destination !== "cloud" || frame.busy === "true")), `Keep the track and plate stable through Cloud loading: ${evidence}`);
  if (!result.reducedMotion) {
    assert(result.frames.some(frame => Math.abs(frame.x - result.before) > 1 && Math.abs(frame.x - result.after) > 1),
      `Slide must have visible intermediate positions: ${evidence}`);
    const sign = Math.sign(result.after - result.before);
    assert(result.frames.every((frame, index) => index === 0 || sign * (frame.x - result.frames[index - 1].x) >= -0.5),
      `Slide must progress smoothly toward its destination: ${evidence}`);
  }
  return result;
}

async function readProjectRowAppearance(window) {
  await window.webContents.executeJavaScript("document.querySelector('.desktop-titlebar-workspace-button').click()", true);
  await waitForRenderer(window, "Boolean(document.querySelector('.desktop-project-switcher-list .desktop-menu-item.selected'))");
  const appearance = await window.webContents.executeJavaScript(`(() => {
    const row = document.querySelector('.desktop-project-switcher-list .desktop-menu-item.selected');
    const css = getComputedStyle(row);
    return { height: row.getBoundingClientRect().height, font: css.font, color: css.color,
      background: css.backgroundColor, shadow: css.boxShadow,
      iconWidth: row.querySelector('.desktop-menu-item-icon').getBoundingClientRect().width };
  })()`, true);
  await window.webContents.executeJavaScript("document.querySelector('.desktop-titlebar-workspace-button').click()", true);
  await waitForRenderer(window, "!document.querySelector('.desktop-project-menu')");
  return appearance;
}

async function checkPopoverSelection(window) {
  const result = await window.webContents.executeJavaScript(`new Promise(resolve => {
    const cloud = document.querySelector('.desktop-project-location-menu button[data-project-location="cloud"]');
    cloud.click();
    const frames = [];
    const sample = () => {
      const menu = document.querySelector('.desktop-project-location-menu');
      const local = menu?.querySelector('button[data-project-location="local"]');
      const selected = menu?.querySelector('button.selected');
      frames.push({ retained: menu?.querySelector('button[data-project-location="cloud"]') === cloud,
        selected: selected?.dataset.projectLocation, current: local?.getAttribute('aria-current'),
        check: !!selected?.querySelector('.lucide-check'),
        busy: menu?.querySelector('.desktop-project-location-tabs').getAttribute('aria-busy'),
        spinner: !!cloud.querySelector('[data-puppy-loader="pulse-grid"]'),
        stacked: local && cloud.getBoundingClientRect().top >= local.getBoundingClientRect().bottom + 2 });
      if (frames.length < 8) requestAnimationFrame(sample); else resolve(frames);
    };
    requestAnimationFrame(sample);
  })`, true);
  assert(result.every(frame => frame.retained && frame.selected === 'cloud' && frame.current === 'true'
    && frame.check && frame.busy === 'true' && frame.spinner && frame.stacked),
    `Cloud preparation must retain the list, requested checkmark and committed provider: ${JSON.stringify(result)}`);
}

async function checkStableReopening(window, direction = "ltr") {
  await window.webContents.executeJavaScript("document.querySelector('.desktop-titlebar-location-button').click()", true);
  await waitForRenderer(window, "!document.querySelector('.desktop-project-location-menu')");
  const frames = await window.webContents.executeJavaScript(`new Promise(resolve => {
    document.documentElement.dir = '${direction}';
    document.querySelector('.desktop-titlebar-location-button').click();
    const frames = [];
    const sample = () => {
      const menu = document.querySelector('.desktop-project-location-menu');
      if (menu && getComputedStyle(menu).visibility !== 'hidden') {
        const m = menu.getBoundingClientRect();
        const track = menu.querySelector('.desktop-project-location-tabs');
        const buttons = [...track.querySelectorAll('button')].map(button => button.getBoundingClientRect());
        frames.push({ x:m.x, y:m.y, width:m.width, height:m.height,
          aligned: buttons[0].x === buttons[1].x && buttons[0].width === buttons[1].width,
          stacked: buttons[1].top === buttons[0].bottom + 2,
          hasSlider: !!menu.querySelector('.desktop-project-location-indicator') });
      }
      if (frames.length < 8) requestAnimationFrame(sample); else resolve(frames);
    };
    requestAnimationFrame(sample);
  })`, true);
  assert(frames.every(frame => frame.aligned && frame.stacked && !frame.hasSlider
    && ['x','y','width','height'].every(key => Math.abs(frame[key]-frames[0][key]) < 1)),
    `Every visible opening frame must have final vertical list geometry (${direction}): ${JSON.stringify(frames)}`);
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
