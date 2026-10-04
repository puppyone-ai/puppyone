#!/usr/bin/env electron
import { app, BrowserWindow, ipcMain, nativeImage } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createDesktopPlatformHost } from "../../../../electron/main/platform/create-platform-host.mjs";
import { registerPlatformIpcHandlers } from "../../../../electron/main/ipc/platform-ipc.mjs";
import { registerWindowLayoutIpcHandlers } from "../../../../electron/main/ipc/window-layout-ipc.mjs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const nativeCorners = process.argv.includes('--native-corners');
if (nativeCorners && process.platform !== 'darwin') throw new Error('Native corner capture requires macOS');
const artifacts = path.join(repo, `artifacts/tests/cloud/${nativeCorners ? 'native-window-corners' : 'native-workbench'}`);
await mkdir(artifacts, { recursive: true });
app.setPath("userData", await mkdtemp(path.join(os.tmpdir(), "puppyone-native-cloud-")));
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-gpu");
// Keep Chromium fixture rendering on a consistent color profile.
app.commandLine.appendSwitch("force-color-profile", "srgb");
const errors = [];
let window;
const assert = (value, message) => { if (!value) throw new Error(message); };
const evaluate = async (code) => { try { return await window.webContents.executeJavaScript(code, true); } catch (error) { throw new Error(`Renderer step failed: ${code}: ${error.message}; ${errors.join("; ")}`); } };
const presentation = (location) => evaluate(`(() => {
  const surface = document.querySelector('[data-workspace-location="${location}"]');
  const sample = (selector) => {
    const node = surface.querySelector(selector); if (!node) throw new Error("Missing native surface " + selector);
    const rect = node.getBoundingClientRect(), css = getComputedStyle(node);
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      color: css.color, background: css.backgroundColor, font: css.fontSize, padding: css.padding };
  };
  return { explorer: sample(".explorer-column"), editor: sample(".browser-column"),
    footer: sample(".desktop-sidebar-footer-bar"), row: sample(".tree-row-content"), code: sample(".cm-editor") };
})()`);
const state = () => evaluate("window.__nativeCloudWorkbenchSmoke.state()");
const waitFor = async (expression) => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) { if (await evaluate(expression)) return; await new Promise((resolve) => setTimeout(resolve, 50)); }
  throw new Error(`Renderer did not become ready: ${expression}`);
};
const headerPresentations = [];
const nativeCornerCaptures = [];
async function headerPresentation(location) {
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  // Existing control hover/color transitions can straddle a theme change; measure
  // settled contrast, while the Header background itself switches synchronously.
  await evaluate("Promise.all(document.querySelector('.desktop-titlebar-workspace-button').getAnimations().map(animation => animation.finished.catch(() => {})))");
  const sample = await evaluate(`(() => {
    const header = document.querySelector('.desktop-titlebar');
    const context = header.querySelector('.desktop-titlebar-centered-context');
    const button = context.querySelector('.desktop-titlebar-workspace-button');
    const mark = button.querySelector('.desktop-titlebar-workspace-mark'), svg = mark.querySelector('svg');
    const outline = svg.querySelector('[data-cloud-outline]');
    const h = header.getBoundingClientRect(), c = context.getBoundingClientRect();
    const css = getComputedStyle(header);
    const shell = header.closest('.desktop-shell'), s = shell.getBoundingClientRect();
    const frame = getComputedStyle(shell, '::after');
    const probe = document.createElement('span');
    header.append(probe);
    probe.style.color = 'var(--po-header)';
    const expected = getComputedStyle(probe).color;
    probe.style.color = 'var(--po-brand-blue)';
    const accent = getComputedStyle(probe).color;
    probe.remove();
    const canvas = document.createElement('canvas').getContext('2d');
    const rgb = (...colors) => {
      canvas.clearRect(0,0,1,1);
      for (const color of colors) { canvas.fillStyle = color; canvas.fillRect(0,0,1,1); }
      return [...canvas.getImageData(0,0,1,1).data].slice(0,3);
    };
    return { location:header.dataset.workspaceKind ?? 'local', identity:header.dataset.fixtureIdentity,
      x:h.x, y:h.y, width:h.width, height:h.height, viewport:innerWidth, viewportHeight:innerHeight,
      center:h.x+h.width/2, projectCenter:c.x+c.width/2,
      background:rgb(css.backgroundColor), expected:rgb(expected), accent:rgb(accent),
      backgroundImage:css.backgroundImage,
      icon:{ location:mark.dataset.projectLocation, name:svg.dataset.cloudIcon ?? null,
        color:rgb(getComputedStyle(mark).color),
        paint:rgb(outline ? getComputedStyle(outline).fill : getComputedStyle(svg).stroke),
        accessibleLabel:button.getAttribute('aria-label') },
      labelColor:rgb(getComputedStyle(button.querySelector('.desktop-titlebar-workspace-name')).color),
      buttonColor:rgb(getComputedStyle(button).color),
      controlPalette:['text', 'text-muted', 'hover', 'active', 'focus', 'divider'].map(key => css.getPropertyValue('--desktop-titlebar-' + key)),
      frame:{ location:shell.dataset.workspaceKind ?? 'local', identity:shell.dataset.fixtureIdentity,
        x:s.x, y:s.y, width:s.width, height:s.height, content:frame.content,
        color:rgb(frame.borderTopColor), borderWidth:frame.borderTopWidth, pointerEvents:frame.pointerEvents,
        radius:parseFloat(frame.borderTopLeftRadius),
        interceptsPointer:document.elementFromPoint(1,innerHeight/2) === shell },
      contrastSamples:[button, ...header.querySelectorAll('.desktop-titlebar-editor-tab')].map(node => {
        const control = getComputedStyle(node);
        return { label:node.className, paper:rgb(css.backgroundColor, control.backgroundColor),
          ink:rgb(css.backgroundColor, control.backgroundColor, control.color) };
      }) };
  })()`);
  assert(sample.location === location, `Header tint must follow the committed ${location} provider`);
  assert(JSON.stringify(sample.background) === JSON.stringify(sample.expected), `Header must keep its original palette on both providers: ${JSON.stringify(sample)}`);
  assert(sample.backgroundImage === 'none', 'The previous gradient must be removed');
  const expectedIcon = location === 'cloud' ? sample.accent : sample.buttonColor;
  assert(sample.icon.location === location && JSON.stringify(sample.icon.color) === JSON.stringify(expectedIcon)
    && JSON.stringify(sample.icon.paint) === JSON.stringify(expectedIcon), 'Cloud outline fill must match the brand-blue frame; Local inherits normal ink');
  assert(JSON.stringify(sample.accent) === '[69,153,223]', 'Brand blue is the approved #4599DF in both themes, not adaptive accent/info');
  assert(sample.icon.name === (location === 'cloud' ? 'ant-design' : null), 'Use the approved Cloud outline only for the committed Cloud provider');
  assert(JSON.stringify(sample.labelColor) === JSON.stringify(sample.buttonColor), 'Blue icon must not recolor the project name');
  assert(sample.frame.location === location && sample.frame.identity === 'retained-shell', 'Window frame must follow the same committed provider without remounting');
  assert(sample.frame.x === 0 && sample.frame.y === 0 && sample.frame.width === sample.viewport
    && sample.frame.height === sample.viewportHeight, 'Cloud frame must enclose the whole window, not just the editor');
  if (location === 'cloud') {
    assert(sample.frame.borderWidth === '2px' && JSON.stringify(sample.frame.color) === JSON.stringify(sample.accent), 'Frame and Cloud mark must share the approved product blue');
    assert(sample.frame.pointerEvents === 'none' && !sample.frame.interceptsPointer, 'Frame must not intercept pointer or resize interactions');
  } else assert(sample.frame.content === 'none', 'Local must have no Cloud frame');
  assert(sample.identity === "retained-header" && sample.x === 0 && sample.width === sample.viewport,
    "Tint must cover the original full-width Header, including both blank sides");
  assert(Math.abs(sample.center - sample.projectCenter) < 0.01, "Tint must not move the centered project context");
  const luminance = (rgb) => rgb.map(v => v/255).map(v => v <= 0.04045 ? v/12.92 : ((v+0.055)/1.055)**2.4)
    .reduce((sum, value, i) => sum + value * [0.2126,0.7152,0.0722][i], 0);
  // Include active editor tabs as well as the centered project label.
  sample.contrast = Math.min(...sample.contrastSamples.map(({ ink, paper }) => {
    const a = luminance(ink), b = luminance(paper);
    return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
  }));
  assert(sample.contrast >= 4.5, `Header project text needs 4.5:1 contrast: ${sample.contrast}`);
  const iconInk = luminance(sample.icon.color), iconPaper = luminance(sample.contrastSamples[0].paper);
  sample.iconContrast = (Math.max(iconInk,iconPaper)+0.05)/(Math.min(iconInk,iconPaper)+0.05);
  // Exact approved brand blue is below 3:1 on light surfaces. Record, do not
  // relabel that as an accessibility pass or silently darken the selected logo.
  // The brand mark is supplementary; the named project control and location
  // menu retain their textual identification and existing contrast checks.
  sample.brandBelow3 = location === 'cloud' && sample.iconContrast < 3;
  if (location === 'cloud') assert(sample.icon.accessibleLabel.includes('Cloud'), 'Location needs a textual accessible name, not just the brand color');
  else assert(sample.iconContrast >= 3, `Local location icon needs 3:1 contrast: ${sample.iconContrast}`);
  return sample;
}
async function windowFramePixels(sample) {
  const width = sample.viewport, height = sample.viewportHeight;
  const image = await window.webContents.capturePage();
  const bitmap = image.toBitmap();
  const scale = Math.sqrt(bitmap.length / (width * height * 4));
  assert(Number.isInteger(width*scale) && Number.isInteger(height*scale), 'Capture must cover the entire viewport');
  // Read native-resolution pixels: resizing a 2px border introduces filter
  // ringing/color conversion, which is not part of the rendered frame.
  const pixel = (x, y) => {
    const offset = (Math.floor((y+0.5)*scale)*width*scale+Math.floor((x+0.5)*scale))*4;
    return [bitmap[offset+2],bitmap[offset+1],bitmap[offset]];
  };
  const distance = (a,b) => Math.max(...a.map((value,i) => Math.abs(value-b[i])));
  // CSS-to-token equality is checked above; compare actual paints in one image.
  const paintedHeader = pixel(12,10);
  const header = [12,width-20].flatMap(x => [3,10,20,30,37].map(y => ({x,y,rgb:pixel(x,y)})));
  for (const point of header) assert(distance(point.rgb,paintedHeader) <= 1, `Entire Header must have one solid color: ${JSON.stringify(point)}`);
  const paintedFrame = pixel(1,Math.floor(height/2));
  const edges = [[Math.floor(width/2),0],[Math.floor(width/2),1],[0,Math.floor(height/2)],[1,Math.floor(height/2)],
    [width-1,Math.floor(height/2)],[width-2,Math.floor(height/2)],
    [Math.floor(width/2),height-1],[Math.floor(width/2),height-2]].map(([x,y]) => ({x,y,rgb:pixel(x,y)}));
  for (const point of edges) assert(sample.location === 'cloud' ? distance(point.rgb,paintedFrame) <= 1
    : distance(point.rgb,sample.accent) > 5, `Frame must appear/disappear on all four edges with the provider: ${JSON.stringify(point)}`);
  const interior = [[4,Math.floor(height/2)],[width-5,Math.floor(height/2)],[Math.floor(width/2),height-5]]
    .map(([x,y]) => ({x,y,rgb:pixel(x,y)}));
  let corners = [];
  if (sample.location === 'cloud') {
    assert(distance(paintedFrame,paintedHeader) > 5, 'Cloud must not tint the Header');
    for (const point of interior) assert(distance(point.rgb,paintedFrame) > 5, 'Frame must remain thin and not recolor the workspace');
    if (sample.frame.radius > 0) corners = verifyCornerArcs(pixel, width, height, sample.frame.radius, paintedFrame);
  }
  return {paintedHeader,paintedFrame,header,edges,interior,corners};
}

function verifyCornerArcs(pixel, width, height, radius, blue) {
  const checks = [];
  for (const [name,right,bottom] of [['top-left',false,false],['top-right',true,false],['bottom-left',false,true],['bottom-right',true,true]]) {
    for (let degrees=5; degrees<90; degrees+=5) {
      const angle = degrees*Math.PI/180;
      const x = radius-(radius-1)*Math.cos(angle), y = radius-(radius-1)*Math.sin(angle);
      let distance = Infinity;
      // Subpixel search stays within the 2px stroke, avoiding raster AA at its edges.
      for (const dx of [-0.5,0,0.5]) for (const dy of [-0.5,0,0.5]) {
        const rgb = pixel(right ? width-1-x-dx : x+dx, bottom ? height-1-y-dy : y+dy);
        distance = Math.min(distance, Math.max(...rgb.map((v,i) => Math.abs(v-blue[i]))));
      }
      assert(distance < 25, `${name} blue arc has a gap at ${degrees} degrees (distance ${distance})`);
      checks.push({name,degrees,distance});
    }
  }
  return checks;
}

async function captureNativeCorners(scene, sample) {
  // This captures our isolated fixture window via WindowServer, including the
  // real macOS rounded mask. capturePage alone cannot detect compositor clipping.
  const file = path.join(artifacts, `native-${scene}.png`);
  const id = window.getMediaSourceId().split(':')[1];
  await promisify(execFile)('/usr/sbin/screencapture', ['-x','-o','-l',id,file]);
  const image = nativeImage.createFromPath(file), bitmap = image.toBitmap();
  const [width,height] = window.getSize();
  const scale = Math.sqrt(bitmap.length/(width*height*4));
  const pixel = (x,y) => { const offset=(Math.floor((y+0.5)*scale)*width*scale+Math.floor((x+0.5)*scale))*4; return [bitmap[offset+2],bitmap[offset+1],bitmap[offset]]; };
  const blue = pixel(1,Math.floor(height/2));
  const corners = verifyCornerArcs(pixel,width,height,sample.frame.radius,blue);
  nativeCornerCaptures.push({scene,width,height,scale,blue,corners});
}
async function selectLocation(location) {
  await evaluate("document.querySelector('.desktop-titlebar-workspace-button').click()");
  await waitFor(`Boolean(document.querySelector('button[data-project-location="${location}"]'))`);
  await evaluate(`document.querySelector('button[data-project-location="${location}"]').click()`);
  await waitFor(`window.__nativeCloudWorkbenchSmoke.state().location === '${location}'`);
}
app.whenReady().then(async () => {
  const platformHost = createDesktopPlatformHost();
  if (nativeCorners) {
    registerPlatformIpcHandlers({ ipcMain, platformHost });
    registerWindowLayoutIpcHandlers({ ipcMain, BrowserWindow });
  }
  window = new BrowserWindow({ show: false, width: 1100, height: 760, frame: nativeCorners,
    ...(nativeCorners ? platformHost.windowChrome.browserWindowOptions : {}),
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
      ...(nativeCorners ? { preload:path.join(repo,'tests/fixtures/cloud/repositories/window-chrome-preload.cjs') } : {}) } });
  window.webContents.on("console-message", (event) => { if (event.level === "error" || event.level === 3) errors.push(event.message); });
  await window.loadURL(`${pathToFileURL(path.join(repo, "dist/index.html")).href}#native-cloud-workbench-smoke`);
  await waitFor("Boolean(window.__nativeCloudWorkbenchSmoke && document.querySelector('[data-workspace-location=local] .cm-content')?.textContent.includes('LOCAL_FILE_BODY'))");
  if (nativeCorners) window.showInactive();
  await evaluate("window.__nativeCloudWorkbenchSmoke.edit('local', 'LOCAL_UNSAVED_DRAFT')");
  await waitFor("window.__nativeCloudWorkbenchSmoke.state().localWrites.some(item => item.content === 'LOCAL_UNSAVED_DRAFT')");
  const localPresentation = await presentation("local");
  await writeFile(path.join(artifacts, "local.png"), (await window.webContents.capturePage()).toPNG());
  const localHost = await evaluate("document.querySelector('[data-workspace-location=local] .cm-editor').dataset.fixtureIdentity = 'retained-local-host'");
  const localHeader = await evaluate(`(() => {
    const header = document.querySelector('.desktop-titlebar');
    const context = document.querySelector('.desktop-titlebar-centered-context');
    header.dataset.fixtureIdentity = 'retained-header';
    header.closest('.desktop-shell').dataset.fixtureIdentity = 'retained-shell';
    const h = header.getBoundingClientRect(), c = context.getBoundingClientRect();
    return { headerCenter:h.x + h.width / 2, contextCenter:c.x + c.width / 2,
      projectName:context.querySelector('.desktop-titlebar-workspace-name')?.textContent };
  })()`);
  await selectLocation("cloud");
  await waitFor("Boolean(document.querySelector('[data-cloud-native=true]')?.textContent.includes('cloud-only'))");
  assert(await evaluate("document.querySelector('[data-workspace-location=local]').hidden && !document.querySelector('[data-workspace-location=cloud]').hidden && !document.querySelector('[role=dialog]')"), "Cloud switch must replace the main surface without a dialog");
  const cloudHeader = await evaluate(`(() => {
    const header = document.querySelector('.desktop-titlebar');
    const context = document.querySelector('.desktop-titlebar-centered-context');
    const h = header.getBoundingClientRect(), c = context.getBoundingClientRect();
    return { identity:header.dataset.fixtureIdentity, count:document.querySelectorAll('.desktop-titlebar').length,
      headerCenter:h.x + h.width / 2, contextCenter:c.x + c.width / 2,
      projectName:context.querySelector('.desktop-titlebar-workspace-name')?.textContent };
  })()`);
  assert(cloudHeader.identity === "retained-header" && cloudHeader.count === 1,
    "Local/Cloud switching must retain one Header DOM host");
  assert(Math.abs(localHeader.headerCenter - localHeader.contextCenter) < 0.01
    && Math.abs(cloudHeader.headerCenter - cloudHeader.contextCenter) < 0.01
    && cloudHeader.projectName === localHeader.projectName,
    "Project name must remain centered and stable across Local/Cloud switching");
  assert(await evaluate("!document.querySelector('[data-cloud-native=true]').textContent.includes('local-only') && document.querySelector('[data-cloud-native=true]').textContent.includes('cloud-only')"), "Cloud tree must contain Cloud files only");
  await evaluate("[...document.querySelectorAll('[data-cloud-native=true] .tree-row')].find(row => row.textContent.includes('readme')).click()");
  await waitFor("Boolean(document.querySelector('[data-workspace-location=cloud] .cm-content')?.textContent.includes('CLOUD_FILE_BODY'))");
  const cloudPresentation = await presentation("cloud");
  for (const region of ["explorer", "editor", "footer", "row", "code"]) {
    const before = localPresentation[region], after = cloudPresentation[region];
    for (const property of region === "row" ? ["color", "font", "padding"] : ["x", "y", "width", "height", "background", "font", "padding"]) {
      assert(typeof before[property] === "number" ? Math.abs(before[property] - after[property]) < 1 : before[property] === after[property],
        `Native ${region} ${property} changed on Cloud switch: ${before[property]} -> ${after[property]}`);
    }
  }
  assert(await evaluate("!document.querySelector('[data-workspace-location=cloud] .desktop-explorer-toolbar, [data-workspace-location=cloud] .desktop-cloud-service-sidebar, [data-workspace-location=cloud] .desktop-cloud-inline-navigation')"), "Cloud must use the native file UI without a separate toolbar or service menu");
  await evaluate("window.__nativeCloudWorkbenchSmoke.edit('cloud', 'CLOUD_EDIT_ONLY')");
  await waitFor("window.__nativeCloudWorkbenchSmoke.state().cloudWrites.some(item => item.content === 'CLOUD_EDIT_ONLY' && item.path === 'readme.txt')");
  let snapshot = await state();
  assert(snapshot.localWrites.every((item) => !item.content.includes("CLOUD_EDIT")), "Cloud edits must never write to the local provider");
  assert(snapshot.cloudWrites.every((item) => !item.content.includes("LOCAL_UNSAVED")), "Local drafts must never write to Cloud");
  await waitFor("document.querySelector('[data-workspace-location=cloud] .cm-content').textContent.includes('CLOUD_EDIT_ONLY')");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await writeFile(path.join(artifacts, "cloud.png"), (await window.webContents.capturePage()).toPNG());
  await selectLocation("local");
  assert(await evaluate("document.querySelector('[data-workspace-location=local] .cm-editor')?.dataset.fixtureIdentity === 'retained-local-host' && document.querySelector('[data-workspace-location=local] .cm-content').textContent.includes('LOCAL_UNSAVED_DRAFT')"), "Returning to This Mac must retain the same editor and local unsaved draft");
  await selectLocation("cloud");
  assert(await evaluate("document.querySelector('[data-workspace-location=cloud] .cm-content').textContent.includes('CLOUD_EDIT_ONLY') && document.querySelector('.desktop-titlebar-editor-tabs').textContent.includes('readme')"), "Returning to Cloud must retain its own tabs and content");
  await evaluate("[...document.querySelectorAll('[data-cloud-native=true] .tree-row')].find(row => row.textContent.includes('records')).click()");
  await waitFor("document.querySelector('[data-cloud-native=true]').textContent.includes('sample')");
  await evaluate("[...document.querySelectorAll('[data-cloud-native=true] .tree-row')].find(row => row.textContent.includes('sample')).click()");
  await waitFor("[...document.querySelectorAll('[data-cloud-native=true] .csv-table-editor__table input, [data-cloud-native=true] .csv-table-editor__table textarea')].some(input => input.value === '42')");
  assert(await evaluate("[...document.querySelectorAll('[data-cloud-native=true] .csv-table-editor__table input, [data-cloud-native=true] .csv-table-editor__table textarea')].some(input => input.value === '42')"), "Cloud data files must use the native data viewer");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await writeFile(path.join(artifacts, "cloud-data.png"), (await window.webContents.capturePage()).toPNG());
  for (const width of [1100, 640]) for (const theme of ["light", "dark"]) {
    window.setContentSize(width, 760);
    await waitFor(`innerWidth === ${width}`);
    await evaluate(`window.__nativeCloudWorkbenchSmoke.setLoginAppearance('${theme}', 'en')`);
    let before;
    for (const [index, location] of ["local", "cloud", "local"].entries()) {
      if ((await state()).location !== location) await selectLocation(location);
      const sample = await headerPresentation(location);
      sample.pixels = await windowFramePixels(sample);
      if (before) assert(JSON.stringify(sample.controlPalette) === JSON.stringify(before.controlPalette), 'Cloud must not change Header control colors');
      if (nativeCorners && location === 'cloud') {
        assert(sample.frame.radius === 16, 'Windowed macOS frame must draw actual rounded arcs');
        await captureNativeCorners(`${theme}-${width}`,sample);
        // Exercise the production event consumer without changing the user's macOS Space.
        window.webContents.send('window-layout:chrome-state-changed', {fullScreen:true});
        await waitFor("getComputedStyle(document.querySelector('.desktop-shell'),'::after').borderTopLeftRadius === '0px'");
        window.webContents.send('window-layout:chrome-state-changed', {fullScreen:false});
        await waitFor("getComputedStyle(document.querySelector('.desktop-shell'),'::after').borderTopLeftRadius === '16px'");
      }
      if (before) for (const key of ["x", "y", "width", "height", "projectCenter"]) {
        assert(Math.abs(sample[key] - before[key]) < 0.01, `Header ${key} moved on ${theme} ${width}px switch`);
      }
      before ??= sample;
      headerPresentations.push({ theme, width, index, ...sample });
      if (index < 2) await writeFile(path.join(artifacts, `header-${theme}-${width}-${location}.png`), (await window.webContents.capturePage()).toPNG());
      if (location === "cloud") {
        await evaluate("document.querySelector('.desktop-titlebar-workspace-button').click()");
        await waitFor("Boolean(document.querySelector('button[data-project-location=cloud]'))");
        headerPresentations.push({ theme, width, expanded:true, ...await headerPresentation(location) });
        await evaluate("document.querySelector('button[data-project-location=cloud]').click()");
        await waitFor("!document.querySelector('.desktop-project-menu')");
      }
    }
  }
  window.setContentSize(1100, 760);
  await waitFor("innerWidth === 1100");
  await evaluate("window.__nativeCloudWorkbenchSmoke.setLoginAppearance('dark', 'en')");
  await selectLocation("cloud");
  await evaluate("window.__nativeCloudWorkbenchSmoke.setCloudSessionAvailable(false)");
  await waitFor("window.__nativeCloudWorkbenchSmoke.state().location === 'local'");
  await headerPresentation("local");
  assert(await evaluate("document.querySelector('[data-workspace-location=local] .cm-editor')?.dataset.fixtureIdentity === 'retained-local-host'"), "Session loss must restore the retained local editor");
  await evaluate("document.querySelector('.desktop-titlebar-workspace-button').click()");
  await waitFor("Boolean(document.querySelector('button[data-project-location=cloud]'))");
  await evaluate("document.querySelector('button[data-project-location=cloud]').click()");
  await waitFor("Boolean(document.querySelector('.desktop-cloud-workspace-switch-dialog [data-cloud-sign-in-action]'))");
  assert(await evaluate("window.__nativeCloudWorkbenchSmoke.state().location === 'local' && !document.querySelector('[data-workspace-location=local]').hidden && document.querySelector('[data-workspace-location=cloud]').hidden"), "Sign-in must precede Cloud selection");
  assert(await evaluate("!document.querySelector('.desktop-cloud-workspace-switch-dialog aside, .desktop-cloud-workspace-switch-dialog nav')"), "The sign-in dialog must not introduce service navigation");
  await headerPresentation("local");
  const authGeometry = await presentation("local");
  for (const region of ["explorer", "editor", "footer"]) for (const property of ["x", "y", "width", "height"]) {
    assert(Math.abs(authGeometry[region][property] - localPresentation[region][property]) < 1, "Authentication changed the retained local layout");
  }
  await waitFor("getComputedStyle(document.querySelector('.desktop-cloud-workspace-switch-dialog')).opacity === '1' && document.querySelector('.desktop-cloud-workspace-switch-dialog').getBoundingClientRect().height > 200");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await writeFile(path.join(artifacts, "login-before-switch.png"), (await window.webContents.capturePage()).toPNG());
  const loginPresentations = [];
  const verifyLogin = async (scene) => {
    await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const sample = await evaluate(`(() => {
      const dialog = document.querySelector('[role=dialog]');
      const cta = dialog.querySelector('.desktop-cloud-sign-in-cta');
      const button = cta.querySelector('[data-cloud-sign-in-action]');
      const box = (node) => { const r = node.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; };
      return { dialog:box(dialog), cta:box(cta), button:box(button),
        centered:[cta, ...cta.querySelectorAll('.desktop-cloud-sign-in-mark, h2, [data-cloud-sign-in-action]')].map(node => box(node).x + box(node).width / 2),
        overflow:button.scrollWidth > button.clientWidth || cta.scrollWidth > cta.clientWidth,
        text:cta.textContent, background:getComputedStyle(dialog).backgroundColor,
        color:getComputedStyle(button).color, locale:document.documentElement.lang,
        busy:cta.getAttribute('aria-busy'), disabled:button.disabled,
        alert:cta.querySelector('[role=alert]')?.textContent ?? null,
        oldPageLayout:Boolean(dialog.querySelector('.desktop-cloud-main-view, .desktop-cloud-auth-page-shell')) };
    })()`);
    const middle = sample.dialog.x + sample.dialog.width / 2;
    assert(sample.centered.every(x => Math.abs(x-middle) < 1), `Sign-in content is off-center: ${scene}`);
    assert(Math.abs(sample.dialog.x*2 + sample.dialog.width - window.getContentSize()[0]) < 2, `Dialog is off-center: ${scene}`);
    assert(Math.abs(sample.dialog.y*2 + sample.dialog.height - window.getContentSize()[1]) < 2, `Dialog is not vertically centered: ${scene}`);
    assert(!sample.overflow && !sample.oldPageLayout, `Sign-in content is clipped or uses full-page layout: ${scene}`);
    assert(sample.dialog.width <= 442 && sample.dialog.height < window.getContentSize()[1]-32, `Sign-in is oversized: ${scene}`);
    loginPresentations.push({ scene, ...sample });
    return sample;
  };
  const initialLogin = await verifyLogin("dark-en");
  const preview = { x: Math.floor(initialLogin.dialog.x - 24), y: Math.floor(initialLogin.dialog.y - 24),
    width: Math.ceil(initialLogin.dialog.width + 48), height: Math.ceil(initialLogin.dialog.height + 48) };
  await writeFile(path.join(artifacts, "login-preview.png"), (await window.webContents.capturePage(preview)).toPNG());
  await evaluate("document.querySelector('[data-cloud-sign-in-action]').click()");
  await waitFor("document.querySelector('.desktop-cloud-sign-in-cta')?.getAttribute('aria-busy') === 'true'");
  let login = await verifyLogin("waiting-en");
  assert(login.disabled && login.text.includes("Finish signing in in your browser"), "Pending login needs clear browser guidance");
  await writeFile(path.join(artifacts, "login-waiting.png"), (await window.webContents.capturePage()).toPNG());
  await evaluate("window.__nativeCloudWorkbenchSmoke.failLogin()");
  await waitFor("Boolean(document.querySelector('.desktop-cloud-sign-in-cta [role=alert]'))");
  login = await verifyLogin("error-en");
  assert(!login.disabled && login.alert.includes("Try again"), "Failed login must offer another attempt");
  await writeFile(path.join(artifacts, "login-error.png"), (await window.webContents.capturePage()).toPNG());
  await evaluate("document.querySelector('[data-cloud-sign-in-action]').click(); window.__nativeCloudWorkbenchSmoke.resetLogin()");
  for (const theme of ["light", "dark"]) {
    await evaluate(`window.__nativeCloudWorkbenchSmoke.setLoginAppearance('${theme}', 'en')`);
    await verifyLogin(`${theme}-en`);
    if (theme === "light") await writeFile(path.join(artifacts, "login-light.png"), (await window.webContents.capturePage()).toPNG());
  }
  await evaluate("window.__nativeCloudWorkbenchSmoke.setLoginAppearance('dark', 'zh-Hans')");
  await verifyLogin("dark-zh-Hans");
  await writeFile(path.join(artifacts, "login-zh.png"), (await window.webContents.capturePage()).toPNG());
  window.setContentSize(480, 640);
  for (const locale of ["en", "zh-Hans", "de", "fr", "ja", "ko", "pt-BR", "es"]) {
    await evaluate(`window.__nativeCloudWorkbenchSmoke.setLoginAppearance('dark', '${locale}')`);
    await verifyLogin(`narrow-${locale}`);
  }
  await writeFile(path.join(artifacts, "login-narrow.png"), (await window.webContents.capturePage()).toPNG());
  window.setContentSize(1100, 760);
  await evaluate("window.__nativeCloudWorkbenchSmoke.setLoginAppearance('dark', 'en')");
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await waitFor("!document.querySelector('[role=dialog]')");
  await evaluate("window.__nativeCloudWorkbenchSmoke.setCloudSessionAvailable(true)");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  assert((await state()).location === "local", "Late authentication after cancellation must not select Cloud");
  await headerPresentation("local");
  await evaluate("window.__nativeCloudWorkbenchSmoke.setCloudSessionAvailable(false)");
  await evaluate("document.querySelector('.desktop-titlebar-workspace-button').click()");
  await waitFor("Boolean(document.querySelector('button[data-project-location=cloud]'))");
  await evaluate("document.querySelector('button[data-project-location=cloud]').click()");
  await waitFor("Boolean(document.querySelector('.desktop-cloud-workspace-switch-dialog'))");
  await evaluate("window.__nativeCloudWorkbenchSmoke.setCloudSessionAvailable(true)");
  await waitFor("window.__nativeCloudWorkbenchSmoke.state().location === 'cloud' && !document.querySelector('[role=dialog]')");
  await waitFor("document.querySelector('[data-cloud-native=true]').textContent.includes('cloud-only')");
  await selectLocation("local");
  assert(await evaluate("document.querySelector('[data-workspace-location=local] .cm-editor')?.dataset.fixtureIdentity === 'retained-local-host' && document.querySelector('[data-workspace-location=local] .cm-content').textContent.includes('LOCAL_UNSAVED_DRAFT')"), "Authentication must preserve local drafts");
  await evaluate("window.__nativeCloudWorkbenchSmoke.finishLocalSaves()");
  snapshot = await state();
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify({ passed: true, localHost, localPresentation, cloudPresentation, headerPresentations, nativeCornerCaptures, authGeometry, loginPresentations, snapshot, errors }, null, 2));
  assert(!errors.length, `Renderer errors: ${errors.join("; ")}`);
  console.log("Native Cloud workbench smoke passed: identical native layout/styles, Cloud tree/data/edit/save, centered sign-in across themes and eight locales, browser waiting/error states, login before switching, cancellation, isolated drafts and retained hosts.");
  window.destroy(); app.exit(0);
}).catch(async (error) => {
  console.error(error);
  if (window) {
    await writeFile(path.join(artifacts, "failure.png"), (await window.webContents.capturePage()).toPNG());
    console.error(await window.webContents.executeJavaScript("JSON.stringify({ state: window.__nativeCloudWorkbenchSmoke?.state(), cloud: document.querySelector('[data-workspace-location=cloud]')?.textContent, errors: [...document.querySelectorAll('[role=alert]')].map(item=>item.textContent) })"));
    window.destroy();
  }
  app.exit(1);
});
