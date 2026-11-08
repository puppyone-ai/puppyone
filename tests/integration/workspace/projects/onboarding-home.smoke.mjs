#!/usr/bin/env electron
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "puppyone-onboarding-visual-"));
const screenshots = path.join(repoRoot, "artifacts/tests/onboarding-home");
app.setPath("userData", path.join(temporaryRoot, "profile"));
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("force-prefers-reduced-motion");
let window;
let server;

/** The smallest window the app allows, and the column the page keeps down to it. */
const MINIMUM_WIDTH = 720;
const MINIMUM_HEIGHT = 520;
const PROJECT_COLUMN = 640;
const EMPTY_COLUMN = 440;
const TITLE_INSET = 32;
/** From the head to the first group's label. */
const GROUP_LABEL_GAP = 12;
/** The projects run to the window's edge; what is below shows there. */
const PAGE_END_INSET = 0;
const GRID_COLUMNS = 5;
// A group's label and a row's details in the caption, New in the meta, names in the body.
const PROJECT_TYPE = ["12px/400", "12px/500", "13px/600", "14px/400"];
/** Under a folder a name is a caption, so the Grid has no body type. */
const GRID_TYPE = ["12px/400", "12px/500", "13px/600"];
const EMPTY_TYPE = ["14px/400", "19px/500"];

const evaluate = (source) => window.webContents.executeJavaScript(source);
async function until(expression) {
  for (let attempt = 0; attempt < 240; attempt++) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${expression}`);
}
const press = (keyCode, modifiers = []) => {
  window.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
  if (keyCode === "Enter") window.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
};
const settle = "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))).then(() => Promise.all(document.getAnimations().map(animation => animation.finished)))";
const typeLevels = `(() => {
  const levels = new Set();
  const walker = document.createTreeWalker(document.querySelector('.onboarding-launcher'), NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    if (!walker.currentNode.textContent.trim()) continue;
    const style = getComputedStyle(walker.currentNode.parentElement);
    levels.add(style.fontSize + '/' + style.fontWeight);
  }
  return [...levels].sort((a, b) => parseFloat(a) - parseFloat(b) || a.localeCompare(b));
})()`;
const shot = async (name) => writeFile(path.join(screenshots, `${name}.png`), (await window.capturePage()).toPNG());

const timeout = setTimeout(() => { console.error("Onboarding visual smoke timed out"); app.exit(1); }, 170_000);
app.whenReady().then(runSmoke).catch((error) => { console.error(error); app.exit(1); });

async function open({ theme, state, width, height, count = 1, mixed = false, held = false, layout }) {
  window.setContentSize(width, height);
  const url = new URL(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/workspace/projects/onboarding-home.html`);
  url.searchParams.set("theme", theme);
  url.searchParams.set("state", state);
  url.searchParams.set("count", String(count));
  if (mixed) url.searchParams.set("mixed", "1");
  if (held) url.searchParams.set("held", "1");
  await window.loadURL(url.href);
  // Attach only after navigation creates the renderer target. The app-level
  // reduced-motion switch is already visible during the initial React mount.
  if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach("1.3");
  await window.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
  await until("!!document.querySelector('[data-onboarding-action=create]') && !document.querySelector('[data-onboarding-empty-state-intro]')");
  await until("[...document.querySelectorAll('.onboarding-brand-lockup img')].every(image => image.complete && image.naturalWidth > 0)");
  if (layout) await chooseLayout(layout);
  await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 39 });
  await evaluate(settle);
}

/** The groups scroll together, as one area; each group's projects are a list inside it. */
const SCROLLPORT = ".onboarding-project-groups";
const CONTROLS = ".onboarding-project-view .onboarding-view-menu-root .po-icon-button";
const SORT = `document.querySelectorAll('${CONTROLS}')[0]`;
const LAYOUT = `document.querySelectorAll('${CONTROLS}')[1]`;
async function chooseLayout(layout) {
  if (await evaluate(`document.querySelector('.onboarding-project-list').dataset.projectLayout === '${layout}'`)) return;
  await evaluate(`${LAYOUT}.click()`);
  await until(`!!document.querySelector('[data-project-layout-option=${layout}]')`);
  await evaluate(`document.querySelector('[data-project-layout-option=${layout}]').click()`);
  await until(`document.querySelector('.onboarding-project-list').dataset.projectLayout === '${layout}'`);
}

async function runSmoke() {
  let exitCode = 0;
  try {
    const { createServer } = await import("vite");
    server = await createServer({
      root: repoRoot,
      cacheDir: path.join(temporaryRoot, "vite-cache"),
      logLevel: "error",
      optimizeDeps: { entries: ["tests/fixtures/workspace/projects/onboarding-home.html"] },
      server: { host: "127.0.0.1", port: 5299, strictPort: false, hmr: false, watch: null },
    });
    await server.listen();
    await mkdir(screenshots, { recursive: true });
    window = new BrowserWindow({
      show: true, width: 900, height: 680, frame: false, enableLargerThanScreen: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
    });
    window.webContents.on("console-message", (details) => {
      if (details.level === "error") console.error(details.message);
    });
    for (const theme of ["dark", "light"]) {
      for (const [width, height] of [[900, 680], [MINIMUM_WIDTH, MINIMUM_HEIGHT]]) {
        await validateFirstRun(theme, width, height);
        await validateProjectsHead(theme, width, height);
        await validateProjectsArea(theme, width, height);
      }
      await validateToolbar(theme);
      await validateMenuPlacement(theme);
      await validatePointerFocus(theme);
      await validateGrid(theme);
      await validateScrollport(theme);
    }
    await validateScrollPolicy();
    console.log(`Onboarding visual smoke passed; screenshots: ${screenshots}`);
  } catch (error) {
    console.error(error);
    if (window && !window.isDestroyed()) console.error(await evaluate("({ active: document.activeElement?.outerHTML, dialogs: document.querySelectorAll('[role=dialog]').length, text: document.body.innerText })"));
    exitCode = 1;
  } finally {
    clearTimeout(timeout);
    window?.destroy();
    await server?.close();
    app.exit(exitCode);
  }
}

const rects = `const rect = (node) => { if (!node) return null; const r = node.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; };`;

async function validateChrome(context, theme, column, width) {
  const page = await evaluate(`(() => { ${rects}
    const brand = document.querySelector('.onboarding-brand-lockup');
    const mark = document.querySelector('.onboarding-brand-mark-artwork');
    const title = brand.querySelector('.onboarding-brand-name');
    const controls = [...document.querySelectorAll('.onboarding-launcher button')];
    return {
      brand:rect(brand), launcher:rect(document.querySelector('.onboarding-launcher')),
      mark:mark?.getAttribute('src').split('/').pop() ?? null,
      markFilter:mark ? getComputedStyle(mark).filter : null,
      headerMark:!!document.querySelector('.desktop-titlebar .onboarding-header-brand :is(img, svg)'),
      titleClipped:!!title && title.scrollWidth > title.clientWidth + 1,
      outside:controls.some(control => { const r = control.getBoundingClientRect(); return r.width && (r.left < 0 || r.right > innerWidth || r.top < 38); }),
      sideways:document.documentElement.scrollWidth > innerWidth,
    };
  })()`);
  assert.equal(page.headerMark, false, `${context}: the Header names the product in words alone`);
  if (column === PROJECT_COLUMN) {
    assert.equal(page.mark, null, `${context}: with projects, the page carries no mark either`);
  } else {
    assert.equal(page.mark, theme === "light" ? "puppy-lite.svg" : "puppy-dark.svg", `${context}: the product's mark for this place`);
    assert.equal(page.markFilter, theme === "light" ? "none" : "grayscale(1) brightness(0.7)", `${context}: the mark's treatment`);
  }
  assert.ok(!page.titleClipped, `${context}: the title is not cut`);
  assert.ok(!page.outside && !page.sideways, `${context}: controls stay onscreen`);
  assert.equal(page.brand.width, column, `${context}: the column keeps its width`);
  assert.ok(Math.abs(page.brand.x + page.brand.width / 2 - width / 2) < 1, `${context}: the column is centred`);
  assert.equal(page.launcher.x, page.brand.x, `${context}: one left edge`);
}

async function validateFirstRun(theme, width, height) {
  const context = `empty/${theme}/${width}x${height}`;
  await open({ theme, state: "empty", width, height });
  await until("[...document.querySelectorAll('.onboarding-entry-import img')].every(image => image.complete && image.naturalWidth > 0)");
  await validateChrome(context, theme, EMPTY_COLUMN, width);
  { const levels = await evaluate(typeLevels); assert.deepEqual(levels, EMPTY_TYPE, `${context}: two levels of type (${levels})`); }
  const page = await evaluate(`(() => { ${rects}
    const create = document.querySelector('[data-onboarding-action=create]');
    const openFolder = document.querySelector('[data-onboarding-action=open]');
    const importButton = document.querySelector('.onboarding-entry-import');
    const primary = document.querySelector('.onboarding-home-primary');
    const marks = [...importButton.querySelectorAll('.onboarding-import-mark')];
    return { create:rect(create), open:rect(openFolder), import:rect(importButton), launcher:rect(document.querySelector('.onboarding-launcher')),
      primaryBorder:getComputedStyle(primary).borderTopWidth, primaryFill:getComputedStyle(primary).backgroundColor,
      radius:getComputedStyle(create).borderRadius, icons:[create, openFolder, importButton].map(key => rect(key.querySelector('.po-button__icon svg')).width),
      brands:marks.map(mark => mark.dataset.importBrand), alts:marks.map(mark => mark.alt), filters:marks.map(mark => getComputedStyle(mark).filter),
      divider:!!document.querySelector('.onboarding-entry-action-divider'), label:create.textContent, reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,
      title:document.querySelector('.onboarding-brand-name').textContent };
  })()`);
  assert.equal(page.reduced, true, `${context}: visual smoke skips the full intro animation`);
  assert.equal(page.title, "Start with your files. Agent-ready.", `${context}: the first-run title`);
  assert.equal(page.label, "New project", context);
  assert.equal(page.primaryBorder, "0px", `${context}: no rule around the create action`);
  assert.equal(page.primaryFill, "rgba(0, 0, 0, 0)", `${context}: first run has no surface`);
  assert.equal(page.create.width, EMPTY_COLUMN, `${context}: New spans the column`);
  assert.equal(page.open.y, page.import.y, `${context}: the other entries share a row`);
  assert.equal(page.open.width, page.import.width, `${context}: the other entries are equal keys`);
  assert.equal(page.open.x, page.create.x, `${context}: one left edge`);
  assert.equal(page.import.right, page.create.right, `${context}: one right edge`);
  assert.equal(page.radius, "6px", `${context}: the shared control radius`);
  assert.deepEqual(page.icons, [14, 14, 14], `${context}: one icon size`);
  assert.deepEqual(page.brands, ["github", "gitlab"], `${context}: only production sources`);
  assert.deepEqual(page.alts, ["GitHub", "GitLab"], `${context}: named logos for assistive technology`);
  assert.deepEqual(page.filters, theme === "dark" ? ["invert(1)", "none"] : ["none", "none"], `${context}: the solid mark adapts to the theme`);
  assert.equal(page.divider, false, context);
  assert.ok(Math.abs(page.launcher.y + page.launcher.height / 2 - height / 2) < 1, `${context}: first run is centred`);
  await shot(`first-run-${theme}-${width}`);
  // Keyboard: a visible ring on each key, and Enter opens each dialog.
  window.focus();
  window.webContents.focus();
  await evaluate("document.querySelector('[data-onboarding-action=create]').focus()");
  press("Tab");
  await until("document.activeElement?.dataset.onboardingAction === 'open'");
  press("Tab", ["shift"]);
  await until("document.activeElement?.dataset.onboardingAction === 'create' && document.activeElement.matches(':focus-visible')");
  assert.equal(await evaluate("getComputedStyle(document.activeElement).outlineStyle"), "solid", `${context}: focus ring`);
  press("Enter");
  await until("!!document.querySelector('.onboarding-entry-dialog')");
  await until("!document.querySelector('.onboarding-entry-dialog button[type=submit]').disabled");
  const dialog = await evaluate(`(() => { const d = document.querySelector('.onboarding-entry-dialog'); return { name:d.querySelector('input').value, selects:d.querySelectorAll('select').length, starter:/Getting Started|Blank folder/.test(d.textContent) }; })()`);
  assert.match(dialog.name, /^My project [A-F0-9]{4}$/, `${context}: collision-resistant default name`);
  assert.deepEqual({ selects: dialog.selects, starter: dialog.starter }, { selects: 0, starter: false }, `${context}: one-action create dialog`);
  press("Escape");
  await until("!document.querySelector('.onboarding-entry-dialog')");
  await evaluate("document.querySelector('[data-onboarding-action=open]').focus()");
  press("Tab");
  await until("document.activeElement?.dataset.onboardingAction === 'import'");
  press("Enter");
  await validateImportPicker(context);
  await shot(`first-run-import-${theme}-${width}`);
  press("Escape");
  await until("!document.querySelector('[role=dialog]') && document.activeElement?.dataset.onboardingAction === 'import'");
  console.log(`Passed ${context}`);
}

async function validateImportPicker(context) {
  await until("!!document.querySelector('.is-import-sources')");
  await evaluate("Promise.all(document.querySelector('.is-import-sources').getAnimations().map(animation => animation.finished))");
  await until("document.activeElement?.dataset.importSource === 'github'");
  await until("[...document.querySelectorAll('.onboarding-import-source img')].length === 2 && [...document.querySelectorAll('.onboarding-import-source img')].every(image => image.complete && image.naturalWidth > 0)");
  const picker = await evaluate(`(() => {
    const dialog = document.querySelector('.is-import-sources');
    const bounds = dialog.getBoundingClientRect();
    return { width:bounds.width, height:bounds.height, sources:[...dialog.querySelectorAll('.onboarding-import-source')].map(row => row.dataset.importSource),
      modes:[...dialog.querySelectorAll('.onboarding-import-source')].map(row => row.dataset.importMode), listItems:dialog.querySelectorAll('ul > li > button').length,
      clipped:[...dialog.querySelectorAll('.onboarding-import-source')].some(row => row.scrollWidth > row.clientWidth) };
  })()`);
  assert.ok(picker.width <= 360 && picker.height <= 360, `${context}: compact source dialog`);
  assert.deepEqual(picker.sources, ["github", "gitlab"], `${context}: experimental sources stay hidden`);
  assert.deepEqual(picker.modes, ["repository", "repository"], `${context}: source capability is explicit`);
  assert.equal(picker.listItems, 2, `${context}: native list and button semantics`);
  assert.equal(picker.clipped, false, `${context}: source names are not cut`);
}

/** The projects' area runs from the head to the page's end, so its wait sits in the middle of it. */
async function validateProjectsArea(theme, width, height) {
  const measure = `(() => { ${rects}
    return { area:rect(document.querySelector('.onboarding-home-primary')), mark:rect(document.querySelector('.onboarding-project-list-loading')), height:innerHeight };
  })()`;
  const context = `projects-area/${theme}/${width}x${height}`;
  await open({ theme, state: "projects", width, height, count: 3, layout: "list" });
  const short = await evaluate(measure);
  assert.equal(Math.round(short.area.bottom), short.height - PAGE_END_INSET, `${context}: a short history's area still runs to the page's end`);

  await open({ theme, state: "projects", width, height, held: true });
  await until("!!document.querySelector('.onboarding-project-list-loading')");
  const wait = await evaluate(measure);
  assert.equal(Math.round(wait.area.bottom), wait.height - PAGE_END_INSET, `${context}: the area runs to the page's end while it waits`);
  const centre = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  const [mark, area] = [centre(wait.mark), centre(wait.area)];
  assert.ok(Math.abs(mark.x - area.x) <= 1 && Math.abs(mark.y - area.y) <= 1, `${context}: the wait sits in the middle of the area, not under the head (${Math.round(mark.y)} vs ${Math.round(area.y)})`);
  await shot(`projects-wait-${theme}-${width}`);
  console.log(`Passed ${context}: area ${Math.round(wait.area.y)}-${Math.round(wait.area.bottom)}, wait at ${Math.round(mark.y)}`);
}

async function validateProjectsHead(theme, width, height) {
  const context = `projects/${theme}/${width}x${height}`;
  await open({ theme, state: "projects", width, height, count: 3, layout: "list" });
  await validateChrome(context, theme, PROJECT_COLUMN, width);
  { const levels = await evaluate(typeLevels); assert.deepEqual(levels, PROJECT_TYPE, `${context}: the page's levels of type (${levels})`); }
  const page = await evaluate(`(() => { ${rects}
    const head = document.querySelector('.onboarding-brand-lockup');
    const surface = document.querySelector('.onboarding-home-primary');
    const create = document.querySelector('[data-onboarding-action=create]');
    const more = document.querySelector('[data-onboarding-action=more]');
    const label = create.querySelector('.po-button__label');
    const brand = document.querySelector('.desktop-titlebar .onboarding-header-brand');
    const brandName = brand?.querySelector('.desktop-titlebar-context-name');
    const surfaceStyle = getComputedStyle(surface);
    return { header:rect(document.querySelector('.desktop-titlebar')), head:rect(head), surface:rect(surface), create:rect(create), more:rect(more),
      chevron:rect(more.querySelector('svg')), label:rect(label), labelClip:getComputedStyle(label).clipPath,
      brandName:brandName?.textContent, brandMark:rect(brand?.querySelector('img, svg')), brandFont:brandName && getComputedStyle(brandName).fontSize,
      brandColor:brandName && getComputedStyle(brandName).color,
      headerMuted:(probe => { document.querySelector('.desktop-titlebar').append(probe); probe.style.color = 'var(--desktop-titlebar-text-muted)'; const color = getComputedStyle(probe).color; probe.remove(); return color; })(document.createElement('span')),
      headMark:!!head.querySelector('img'), title:!!head.querySelector('.onboarding-brand-name'),
      border:surfaceStyle.borderTopWidth, fill:surfaceStyle.backgroundColor,
      keys:!!document.querySelector('.onboarding-entry-actions'), other:document.querySelectorAll('[data-onboarding-action=open], [data-onboarding-action=import]').length };
  })()`);
  assert.equal(page.brandName, "puppyone", `${context}: the Header names the product`);
  assert.equal(page.brandColor, page.headerMuted, `${context}: the name wears a project name's muted ink`);
  assert.equal(page.brandMark, null, `${context}: the Header names the product in words alone`);
  assert.equal(page.headMark, false, `${context}: one mark on the page`);
  assert.equal(page.title, false, `${context}: the head holds no title`);
  assert.equal(page.head.y - page.header.bottom, TITLE_INSET, `${context}: the inset above the head`);
  assert.equal(page.border, "0px", `${context}: no rule`);
  assert.equal(page.fill, "rgba(0, 0, 0, 0)", `${context}: the projects sit on the page itself`);
  assert.equal(page.keys, false, `${context}: the entries live at the head`);
  assert.equal(page.other, 0, `${context}: the other entries wait behind the arrow`);
  assert.equal(page.more.right, page.head.right, `${context}: the entry menu ends on the column's edge`);
  assert.equal(page.more.x - page.create.right, 1, `${context}: the two halves of one button`);
  assert.equal(page.chevron.width, 14, `${context}: the arrow never disappears`);
  assert.equal(page.labelClip, "none", `${context}: New keeps its words down to the smallest window`);
  assert.ok(page.label.width > 60, `${context}: New keeps its words down to the smallest window`);
  await shot(`projects-${theme}-${width}`);
  // The entry menu by keyboard, and focus coming home from the dialog it opens.
  window.focus();
  window.webContents.focus();
  await evaluate("document.querySelector('[data-onboarding-action=more]').focus()");
  press("Enter");
  await until("document.activeElement?.dataset.onboardingAction === 'open'");
  const menu = await evaluate(`(() => { ${rects} const surface = document.querySelector('.onboarding-entry-menu'); const item = surface.querySelector('.desktop-menu-item');
    return { rect:rect(surface), padding:getComputedStyle(surface).paddingTop, radius:getComputedStyle(surface).borderRadius, icon:rect(item.querySelector('svg')).width, gap:getComputedStyle(item).columnGap }; })()`);
  assert.equal(menu.padding, "4px", `${context}: the menu's standard inset`);
  assert.equal(menu.radius, "8px", `${context}: the menu's standard radius`);
  assert.equal(menu.icon, 14, `${context}: menu icons match the rest of the page`);
  assert.ok(menu.rect.right <= width, `${context}: the menu stays onscreen`);
  await shot(`projects-entry-menu-${theme}-${width}`);
  press("Down");
  await until("document.activeElement?.dataset.onboardingAction === 'import'");
  press("Escape");
  await until("!document.querySelector('.onboarding-entry-menu') && document.activeElement?.dataset.onboardingAction === 'more'");
  press("Enter");
  await until("document.activeElement?.dataset.onboardingAction === 'open'");
  press("Down");
  await until("document.activeElement?.dataset.onboardingAction === 'import'");
  press("Enter");
  await validateImportPicker(context);
  press("Escape");
  await until("!document.querySelector('[role=dialog]') && document.activeElement?.dataset.onboardingAction === 'more'");
  await evaluate("document.querySelector('[data-onboarding-action=create]').focus()");
  press("Enter");
  await until("!!document.querySelector('.onboarding-entry-dialog')");
  press("Escape");
  await until("!document.querySelector('.onboarding-entry-dialog')");
  console.log(`Passed ${context}`);
}

async function validateToolbar(theme) {
  const context = `toolbar/${theme}`;
  await open({ theme, state: "projects", width: 1180, height: 760, count: 9, mixed: true, layout: "grid" });
  const view = `(() => { ${rects}
    const controls = [...document.querySelectorAll('${CONTROLS}')];
    return { controls:controls.map(rect), tips:controls.map(control => control.dataset.tooltip), words:controls.map(control => control.textContent),
      head:rect(document.querySelector('.onboarding-brand-lockup')), create:rect(document.querySelector('[data-onboarding-action=create]')),
      chevrons:document.querySelectorAll('.onboarding-project-toolbar .lucide-chevron-down').length, segments:document.querySelectorAll('.desktop-theme-segment').length,
      shown:[...document.querySelectorAll('.onboarding-project-row-wrap')].map(row => row.dataset.projectLocation),
      groups:[...document.querySelectorAll('.onboarding-project-group')].map(group => [...group.querySelectorAll('.onboarding-project-tile-name')].map(name => name.textContent)) };
  })()`;
  const rest = await evaluate(view);
  assert.deepEqual(rest.words, ["", ""], `${context}: two icons, without words`);
  assert.deepEqual(rest.tips, ["Sort projects: Last modified", "Project layout: Grid"], `${context}: the tooltips carry what the icons leave out`);
  assert.equal(rest.chevrons, 0, `${context}: no dropdown arrows`);
  assert.equal(rest.segments, 0, `${context}: the layout is one icon, not a highlighted switch`);
  assert.equal(rest.create.x - rest.controls[1].right, 8, `${context}: the icons sit just before New`);
  assert.ok(rest.controls[0].right <= rest.controls[1].x, `${context}: order, then layout`);
  assert.equal(rest.shown.length, 9, context);
  const item = (name) => `[...document.querySelectorAll('.onboarding-view-menu .desktop-menu-item')].find(node => node.textContent === ${JSON.stringify(name)})`;
  await evaluate(`${SORT}.click()`);
  await until(`!!${item("Name")}`);
  await evaluate(`${item("Name")}.click()`);
  await until("!document.querySelector('.onboarding-view-menu')");
  const named = await evaluate(view);
  assert.equal(named.tips[0], "Sort projects: Name", `${context}: the tooltip names the order`);
  // Each group keeps its own projects; the order applies within it.
  assert.deepEqual(named.groups, rest.groups.map((names) => [...names].sort((a, b) => a.localeCompare(b, "en", { numeric: true }))),
    `${context}: each group ordered by name, as a person reads it`);
  // The order is remembered, so leave the next page as it was found.
  await evaluate(`${SORT}.click()`);
  await until(`!!${item("Last modified")}`);
  await evaluate(`${item("Last modified")}.click()`);
  await until("!document.querySelector('.onboarding-view-menu')");
  console.log(`Passed ${context}`);
}

/** With a real pointer, closing a menu hands focus back without drawing a keyboard ring. */
async function validatePointerFocus(theme) {
  const context = `pointer/${theme}`;
  await open({ theme, state: "projects", width: 1180, height: 760, count: 9, layout: "grid" });
  const press = async (selector) => {
    const { x, y } = await evaluate(`(() => { const r = ${selector}.getBoundingClientRect(); return { x:r.x + r.width / 2, y:r.y + r.height / 2 }; })()`);
    for (const [type, buttons] of [["mouseMoved", 0], ["mousePressed", 1], ["mouseReleased", 0]]) {
      await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", buttons, clickCount: type === "mouseMoved" ? 0 : 1 });
    }
  };
  await press(LAYOUT);
  await until("!!document.querySelector('[data-project-layout-option=list]')");
  await press("document.querySelector('[data-project-layout-option=list]')");
  await until("document.querySelector('.onboarding-project-list').dataset.projectLayout === 'list'");
  await evaluate(settle);
  assert.equal(await evaluate(`${LAYOUT} === document.activeElement`), true, `${context}: focus comes home to the control`);
  assert.equal(await evaluate(`${LAYOUT}.matches(':focus-visible')`), false, `${context}: no keyboard ring after a pointer choice`);
  console.log(`Passed ${context}`);
}

async function validateMenuPlacement(theme) {
  for (const [width, height] of [[1180, 760], [MINIMUM_WIDTH, MINIMUM_HEIGHT]]) {
    await open({ theme, state: "projects", width, height, count: 9, mixed: true, layout: "grid" });
    for (const name of ["sort", "layout"]) {
      const context = `menu/${name}/${theme}/${width}x${height}`;
      const trigger = { sort: SORT, layout: LAYOUT }[name];
      await evaluate(`${trigger}.click()`);
      await until("!!document.querySelector('.onboarding-view-menu')");
      const placement = await evaluate(`(() => { const t = ${trigger}.getBoundingClientRect(); const m = document.querySelector('.onboarding-view-menu').getBoundingClientRect();
        return { trigger:t.left + t.width / 2, menu:m.left + m.width / 2, left:m.left, right:m.right, top:m.top - t.bottom, width:m.width }; })()`);
      assert.ok(Math.abs(placement.trigger - placement.menu) < 1, `${context}: centred under its control (${placement.trigger} vs ${placement.menu})`);
      assert.ok(placement.left >= 0 && placement.right <= width, `${context}: stays in the window (${placement.left}-${placement.right})`);
      assert.equal(placement.top, 4, `${context}: hangs just under its control`);
      await shot(`menu-${name}-${theme}-${width}`);
      await evaluate(`${trigger}.click()`);
      await until("!document.querySelector('.onboarding-view-menu')");
      console.log(`Passed ${context}: ${Math.round(placement.width)}px wide, ${Math.round(width - placement.right)}px from the edge`);
    }
  }
}

async function validateGrid(theme) {
  const column = `(() => { const edges = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return [r.left, r.right]; };
    return { brand:edges('.onboarding-brand-lockup'), surface:edges('.onboarding-home-primary') }; })()`;
  for (const [width, height, count] of [[1180, 760, 40], [MINIMUM_WIDTH, MINIMUM_HEIGHT, 40], [1200, 900, 3]]) {
    const context = `grid/${theme}/${width}x${height}/${count}`;
    await open({ theme, state: "projects", width, height, count, layout: "list" });
    const list = await evaluate(column);
    await chooseLayout("grid");
    await evaluate(settle);
    assert.deepEqual(await evaluate(column), list, `${context}: switching layouts never moves the column`);
    { const levels = await evaluate(typeLevels); assert.deepEqual(levels, GRID_TYPE, `${context}: the page's levels of type (${levels})`); }
    const snapshot = await evaluate(`(() => { const element = document.querySelector('${SCROLLPORT}');
      const folders = [...document.querySelectorAll('.onboarding-project-folder')].map(folder => folder.getBoundingClientRect());
      return { sideways:element.scrollWidth - element.clientWidth, overflows:element.scrollHeight > element.clientHeight, columns:new Set(folders.map(folder => folder.left)).size,
        toLabel:document.querySelector('.onboarding-project-group-title').getBoundingClientRect().top - document.querySelector('.onboarding-brand-lockup').getBoundingClientRect().bottom,
        labelEdges:(r => [r.left, r.right])(document.querySelector('.onboarding-project-group-head').getBoundingClientRect()),
        gridEdges:[document.querySelector('.onboarding-project-tile').getBoundingClientRect().left, document.querySelector('.onboarding-brand-lockup').getBoundingClientRect().right],
        lastColumn:Math.max(...[...document.querySelectorAll('.onboarding-project-tile')].map(t => t.getBoundingClientRect().right)),
        overrun:[...document.querySelectorAll('.onboarding-project-tile')].filter(tile => { const name = tile.querySelector('.onboarding-project-tile-label').getBoundingClientRect(); const cell = tile.getBoundingClientRect(); return name.left < cell.left - 0.5 || name.right > cell.right + 0.5; }).map(tile => tile.textContent),
        fade:getComputedStyle(element).maskImage, sheets:document.querySelector('.project-folder-glyph').querySelectorAll('.project-folder-sheet').length };
    })()`);
    assert.equal(snapshot.sideways, 0, `${context}: the Grid never scrolls sideways`);
    assert.equal(snapshot.toLabel, GROUP_LABEL_GAP, `${context}: the first group's label hangs just under the head (${snapshot.toLabel})`);
    assert.deepEqual(snapshot.labelEdges, snapshot.gridEdges, `${context}: a group's label and rule start on the first folder's edge and run the column`);
    if (count >= GRID_COLUMNS) assert.equal(snapshot.lastColumn, snapshot.gridEdges[1], `${context}: a full row ends on the column's edge`);
    assert.deepEqual(snapshot.overrun, [], `${context}: no name runs past its folder's cell`);
    assert.equal(snapshot.columns, Math.min(count, GRID_COLUMNS), `${context}: five folders across, down to the smallest window`);
    assert.equal(snapshot.sheets, 1, `${context}: each folder holds one sheet`);
    assert.equal(await evaluate("document.querySelector('.onboarding-project-tile').dataset.tooltip"), "/example/Projects", `${context}: the tooltip adds only what the folder does not show`);
    await validateProjectActions(context);
    if (snapshot.overflows) assert.match(snapshot.fade, /gradient/, `${context}: more projects below fade into the window's edge`);
    await shot(`grid-${theme}-${width}x${height}-${count}`);
    console.log(`Passed ${context}`);
  }
}

/** With a real pointer: the dots brighten by themselves, then open their menu in the window. */
async function validateProjectActions(context) {
  const move = async (x, y) => window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  const press = async (type, { x, y }) => window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  const tile = await evaluate(`(() => { const r = document.querySelector('.onboarding-project-tile').getBoundingClientRect(); return { x:r.x + r.width / 2, y:r.y + r.height / 2 }; })()`);
  await move(tile.x, tile.y);
  await until("document.querySelector('.onboarding-project-row-wrap').matches(':hover')");
  const mark = await evaluate(`(() => { const r = document.querySelector('.onboarding-project-actions').getBoundingClientRect(); return { x:r.x + r.width / 2, y:r.y + r.height / 2 }; })()`);
  await move(mark.x, mark.y);
  await until("document.querySelector('.onboarding-project-actions').matches(':hover')");
  await evaluate(settle);
  const style = await evaluate(`(() => { const actions = document.querySelector('.onboarding-project-actions');
    const probe = document.createElement('span'); probe.style.color = 'var(--po-text)'; actions.parentElement.append(probe);
    const text = getComputedStyle(probe).color; probe.remove();
    return { background:getComputedStyle(actions).backgroundColor, color:getComputedStyle(actions).color, text }; })()`);
  assert.equal(style.background, "rgba(0, 0, 0, 0)", `${context}: no backdrop behind the project actions`);
  assert.equal(style.color, style.text, `${context}: the project actions brighten by themselves`);
  await press("mousePressed", mark);
  await press("mouseReleased", mark);
  await until("document.querySelector('.desktop-project-row-actions-menu')");
  await move(1, 39);
  await evaluate(settle);
  const opened = await evaluate(`(() => { const r = document.querySelector('.desktop-project-row-actions-menu').getBoundingClientRect();
    const actions = document.querySelector('.onboarding-project-actions');
    return { inside:r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, shown:getComputedStyle(actions).opacity === '1' }; })()`);
  assert.equal(opened.inside, true, `${context}: the project menu stays inside the window`);
  assert.equal(opened.shown, true, `${context}: the dots stay up while their menu is open`);
  await window.webContents.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await window.webContents.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await until("!document.querySelector('.desktop-project-row-actions-menu')");
}

async function validateScrollport(theme) {
  const titleTop = 40 + TITLE_INSET;
  for (const [width, height, minimumListHeight] of [
    [MINIMUM_WIDTH, MINIMUM_HEIGHT, 280], [992, 596, 355], [900, 680, 440], [1200, 900, 660], [1200, 1200, 960],
  ]) {
    const context = `long-projects/${theme}/${width}x${height}`;
    await open({ theme, state: "projects", width, height, count: 40, layout: "list" });
    const snapshot = await evaluate(`(() => { ${rects}
      const list = document.querySelector('${SCROLLPORT}');
      return { viewport:{ width:innerWidth, height:innerHeight }, list:rect(list), brand:rect(document.querySelector('.onboarding-brand-lockup')),
        surface:rect(document.querySelector('.onboarding-home-primary')), scrollHeight:list.scrollHeight, clientHeight:list.clientHeight,
        gutter:list.offsetWidth - list.clientWidth, thumb:getComputedStyle(list, '::-webkit-scrollbar-thumb').backgroundColor, fade:getComputedStyle(list).maskImage,
        thumbInset:getComputedStyle(list, '::-webkit-scrollbar-thumb').borderTopWidth, hover:list.matches(':hover'),
        sharedInset:(probe => { probe.dataset.poScrollbar = list.dataset.poScrollbar; document.body.append(probe); const inset = getComputedStyle(probe, '::-webkit-scrollbar-thumb').borderTopWidth; probe.remove(); return inset; })(document.createElement('div')),
        outerOverflow:document.querySelector('.onboarding-shell').scrollHeight > innerHeight, tag:document.querySelector('.onboarding-project-list').tagName, stops:list.querySelectorAll('[data-project-open][tabindex="0"]').length };
    })()`);
    assert.deepEqual(snapshot.viewport, { width, height }, `${context}: test the requested viewport, not an OS-clamped window`);
    assert.equal(snapshot.brand.y, titleTop, `${context}: the title's position never moves`);
    assert.ok(snapshot.list.height >= minimumListHeight, `${context}: the list uses the available height (${snapshot.list.height}px)`);
    assert.equal(height - snapshot.surface.bottom, PAGE_END_INSET, `${context}: the surface runs to the window's edge`);
    assert.ok(snapshot.scrollHeight > snapshot.clientHeight && !snapshot.outerOverflow, `${context}: only the projects scroll`);
    assert.equal(snapshot.gutter, 12, `${context}: the shared scrollbar lane`);
    assert.equal(snapshot.thumbInset, snapshot.sharedInset, `${context}: the shared scrollbar thumb, not a local one`);
    assert.equal(snapshot.hover, false, `${context}: visibility must not depend on hovering the list`);
    // At rest the bar would be the heaviest line on the page; the fade says there is more.
    assert.equal(snapshot.thumb, "rgba(0, 0, 0, 0)", `${context}: no thumb at rest`);
    assert.match(snapshot.fade, /gradient/, `${context}: more projects below fade into the window's edge`);
    assert.equal(snapshot.tag, "UL", `${context}: the projects are a list`);
    assert.equal(snapshot.stops, 1, `${context}: the list is one stop for Tab`);
    await shot(`long-projects-${theme}-${width}x${height}`);
    await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseWheel",
      x: Math.round(snapshot.list.x + 30), y: Math.round(snapshot.list.y + 20), deltaX: 0, deltaY: 250 });
    await until(`document.querySelector('${SCROLLPORT}').scrollTop > 0`);
    await evaluate("document.querySelector('[data-project-open][tabindex=\"0\"]').focus()");
    press("End");
    await until(`(() => { const el = document.querySelector('${SCROLLPORT}'); return el.scrollTop >= el.scrollHeight - el.clientHeight - 2; })()`);
    assert.equal(await evaluate("document.querySelector('.onboarding-brand-lockup').getBoundingClientRect().top"), snapshot.brand.y, `${context}: scrolling does not move the title`);
    console.log(`Passed ${context}: ${snapshot.list.height}px list, fading edge, wheel/End scrolling`);
  }
}

async function validateScrollPolicy() {
  await open({ theme: "dark", state: "projects", width: 1200, height: 900, count: 40, layout: "list" });
  const longRow = await evaluate("document.querySelector('.onboarding-project-row').getBoundingClientRect().width");
  // The opt-in must not change ordinary scroll owners or override system mode.
  const policy = await evaluate(`(() => {
    const ordinary = document.createElement('div'); ordinary.dataset.poScrollbar = 'content';
    ordinary.style.cssText = 'position:fixed;top:0;left:0;width:20px;height:20px;overflow:auto';
    ordinary.innerHTML = '<div style="height:80px"></div>'; document.body.appendChild(ordinary);
    const transient = getComputedStyle(ordinary, '::-webkit-scrollbar-thumb').backgroundColor;
    ordinary.remove();
    document.documentElement.dataset.poScrollbarMode = 'system';
    const systemWidth = getComputedStyle(document.querySelector('${SCROLLPORT}'), '::-webkit-scrollbar').width;
    document.documentElement.dataset.poScrollbarMode = 'product';
    return { transient, systemWidth };
  })()`);
  assert.equal(policy.transient, "rgba(0, 0, 0, 0)", "Other default scroll owners remain transient");
  assert.notEqual(policy.systemWidth, "12px", "System scrollbar mode retains OS-owned geometry");
  await open({ theme: "dark", state: "projects", width: 1200, height: 900, count: 1, layout: "list" });
  const short = await evaluate(`(() => { const list = document.querySelector('${SCROLLPORT}'); return {
    height:list.clientHeight, content:list.scrollHeight, width:document.querySelector('.onboarding-project-row').getBoundingClientRect().width,
    title:document.querySelector('.onboarding-brand-lockup').getBoundingClientRect().top,
    rowOffset:document.querySelector('.onboarding-project-group').getBoundingClientRect().top - list.getBoundingClientRect().top, listInset:parseFloat(getComputedStyle(list).paddingTop),
    surfaceBottom:document.querySelector('.onboarding-home-primary').getBoundingClientRect().bottom, page:innerHeight }; })()`);
  assert.equal(short.height, short.content, "A short list does not manufacture overflow");
  assert.equal(short.title, 40 + TITLE_INSET, "The title keeps its place however few projects there are");
  assert.equal(short.rowOffset, short.listInset, "A few projects sit at the top of their area");
  assert.equal(Math.round(short.surfaceBottom), short.page - PAGE_END_INSET, "Their area still runs to the page's end");
  assert.equal(short.width, longRow, "Stable gutter keeps short and long row geometry identical");
}
