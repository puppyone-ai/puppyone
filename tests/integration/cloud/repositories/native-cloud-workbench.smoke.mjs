#!/usr/bin/env electron
import { app, BrowserWindow, ipcMain, nativeImage, protocol, utilityProcess } from "electron";
import { cloudFormatFixtures, acceptCloudFormats, acceptRevokedCloudMedia } from "../../../support/cloud/formatAcceptance.mjs";
import { createDatabasePreviewService } from "../../../../electron/main/database-preview/service.mjs";
import { createCloudNativePreviewService, registerCloudNativePreviewIpc } from "../../../../electron/main/cloud-native-preview-service.mjs";
import { createCloudPreviewResourceService, registerCloudPreviewResourceIpc } from "../../../../electron/main/cloud-preview-resource-service.mjs";
import { installEmbeddedContentSessionSecurity } from "../../../../electron/main/embedded-pdf-security.mjs";
import { installWindowNavigationSecurity } from "../../../../electron/main/security.mjs";
import { createPreviewDocumentService, registerPreviewDocumentIpc, PREVIEW_DOCUMENT_SCHEME, PREVIEW_DOCUMENT_PRIVILEGES } from "../../../../electron/main/preview-document-service.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createDesktopPlatformHost } from "../../../../electron/main/platform/create-platform-host.mjs";
import { registerPlatformIpcHandlers } from "../../../../electron/main/ipc/platform-ipc.mjs";
import { registerWindowLayoutIpcHandlers } from "../../../../electron/main/ipc/window-layout-ipc.mjs";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import XLSX from "xlsx";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const rendererPath = process.env.PUPPYONE_NATIVE_WORKBENCH_RENDERER ?? path.join(repo, "dist/index.html");
const nativeCorners = process.argv.includes('--native-corners');
const filesOnly = process.argv.includes('--files-only');
if (nativeCorners && process.platform !== 'darwin') throw new Error('Native corner capture requires macOS');
const artifacts = process.env.PUPPYONE_CLOUD_FORMAT_ARTIFACT_DIR
  ?? path.join(repo, `artifacts/tests/cloud/${nativeCorners ? 'native-window-corners' : 'native-workbench'}`);
await mkdir(artifacts, { recursive: true });
await rm(path.join(artifacts, "report.json"), { force: true });
await rm(path.join(artifacts, "cloud-format-acceptance.json"), { force: true });
app.setPath("userData", await mkdtemp(path.join(os.tmpdir(), "puppyone-native-cloud-")));
app.commandLine.appendSwitch("disable-renderer-backgrounding");
protocol.registerSchemesAsPrivileged([{ scheme: PREVIEW_DOCUMENT_SCHEME, privileges: PREVIEW_DOCUMENT_PRIVILEGES }]);
// Keep Chromium fixture rendering on a consistent color profile.
app.commandLine.appendSwitch("force-color-profile", "srgb");
const errors = [];
const pdfRuntimeDiagnostics = [];
const handledResourceErrors = [];
let expectedResourceFailure = false;
let window;
const assert = (value, message) => { if (!value) throw new Error(message); };
// PUPPYONE_SMOKE_TRACE=1 prints each renderer step, so a hang names its step.
const trace = process.env.PUPPYONE_SMOKE_TRACE === '1';
const evaluate = async (code) => { if (trace) console.error('[step]', String(code).replace(/\s+/g, ' ').slice(0, 200)); try { return await window.webContents.executeJavaScript(code, true); } catch (error) { throw new Error(`Renderer step failed: ${code}: ${error.message}; ${errors.join("; ")}`); } };
const presentation = (location) => evaluate(`(async () => {
  const surface = document.querySelector('[data-workspace-location="${location}"]');
  // Compare settled styles: a slower runner may still be mid-transition.
  await Promise.all(surface.getAnimations({ subtree: true })
    .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime))
    .map(animation => animation.finished.catch(() => {})));
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
// The Header and Share keep the Agent list current by themselves, whatever else is happening.
const workspaceRequests = async () => (await state()).requests.filter(path => !/\/(agent-links|access\/sessions)$/.test(path));
const waitFor = async (expression) => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) { if (await evaluate(expression)) return; await new Promise((resolve) => setTimeout(resolve, 50)); }
  throw new Error(`Renderer did not become ready: ${expression}`);
};
// Edit only once the target's committed editor is mounted; a slower runner may
// still be swapping the document surface when the previous step returns.
async function editDocument(target, text) {
  await waitFor(`Boolean(document.querySelector('[data-workspace-location="${target}"] .document-surface-slot.is-committed:not(.is-obscured) .cm-editor'))`);
  await evaluate(`window.__nativeCloudWorkbenchSmoke.edit(${JSON.stringify(target)}, ${JSON.stringify(text)})`);
}
const headerPresentations = [];
const nativeCornerCaptures = [];
async function captureCloudReady(scene) {
  assert(await evaluate("!document.querySelector('.desktop-cloud-entry-light, .desktop-cloud-entry-sweep, [data-arrival-ready]')"),
    'Ready Cloud content must have no page cover or separate arrival animation');
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await writeFile(path.join(artifacts, `cloud-ready-${scene}.png`), (await window.webContents.capturePage()).toPNG());
}

async function captureSettledDialog(scene, selector) {
  await waitFor(`Boolean(document.querySelector('${selector}'))`);
  await evaluate(`(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const dialog = document.querySelector('${selector}');
    await Promise.all(dialog.getAnimations({ subtree:true })
      .filter(animation => Number.isFinite(animation.effect.getComputedTiming().endTime))
      .map(animation => animation.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  })()`);
  await writeFile(path.join(artifacts, `${scene}.png`), (await window.webContents.capturePage()).toPNG());
}

async function headerPresentation(location) {
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  // Measure settled contrast after control transitions and the Header reveal.
  await evaluate("Promise.all([...document.querySelectorAll('.desktop-titlebar-workspace-button')].flatMap(button => button.getAnimations()).map(animation => animation.finished.catch(() => {})))");
  await evaluate("Promise.all((document.querySelector('.desktop-cloud-header-reveal')?.getAnimations({subtree:true}) ?? []).map(animation => animation.finished.catch(() => {})))");
  const sample = await evaluate(`(() => {
    // Under Reduce Motion the app gives every property a 0.01ms transition, so
    // a style read right after a provider switch returns the old color. Settle
    // in-flight transitions so the sample is the committed presentation.
    document.getAnimations().filter(animation => animation instanceof CSSTransition).forEach(animation => animation.finish());
    const header = document.querySelector('.desktop-titlebar');
    const context = header.querySelector('.desktop-titlebar-centered-context');
    // The project trigger is the Header's one project control; no Local /
    // Cloud switch sits beside it (ADR-001), so its ink carries the checks.
    const button = context.querySelector('.desktop-titlebar-workspace-button');
    const mark = button.querySelector('.desktop-titlebar-workspace-mark');
    const svg = mark.matches('svg') ? mark : mark.querySelector('svg');
    const outline = svg.querySelector('[data-cloud-outline]');
    const h = header.getBoundingClientRect(), c = context.getBoundingClientRect();
    const css = getComputedStyle(header);
    const shell = header.closest('.desktop-shell'), s = shell.getBoundingClientRect();
    const frame = getComputedStyle(shell, '::after');
    // Resolve each token on a fresh element: a reused probe would transition
    // between tokens and report the first color for all of them.
    const token = (value) => {
      const probe = document.createElement('span');
      probe.style.setProperty('transition', 'none', 'important');
      probe.style.color = value;
      header.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const expected = token('var(--po-header)');
    const accent = token('var(--po-brand-blue)');
    const cloudBackground = token('var(--po-cloud-header-bg)');
    const themeText = token('var(--po-text)');
    const activeInk = token('var(--desktop-titlebar-text)');
    const restingInk = token('var(--desktop-titlebar-text-muted)');
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
      cloudBackground:rgb(cloudBackground), themeText:rgb(themeText),
      backgroundImage:css.backgroundImage,
      locationControl:Boolean(header.querySelector('.desktop-titlebar-location-button, .desktop-project-location-controls')),
      icon:{ product:svg.dataset.productIcon ?? null,
        glyph:[...svg.classList].find(name => name.startsWith('lucide-')) ?? null,
        color:rgb(getComputedStyle(mark).color),
        paint:rgb(getComputedStyle(outline ?? svg).stroke),
        accessibleLabel:button.getAttribute('aria-label') },
      labelColor:rgb(getComputedStyle(button.querySelector('.desktop-titlebar-workspace-name')).color),
      buttonColor:rgb(getComputedStyle(button).color),
      controlInks:[rgb(activeInk), rgb(restingInk)],
      interactive:button.matches(':hover') || button.getAttribute('aria-expanded') === 'true',
      controlPalette:['text', 'text-muted', 'hover', 'active', 'focus', 'divider'].map(key => css.getPropertyValue('--desktop-titlebar-' + key)),
      frame:{ location:shell.dataset.workspaceKind ?? 'local', identity:shell.dataset.fixtureIdentity,
        x:s.x, y:s.y, width:s.width, height:s.height, content:frame.content,
        color:rgb(frame.borderTopColor), borderWidth:frame.borderTopWidth, pointerEvents:frame.pointerEvents,
        radius:parseFloat(frame.borderTopLeftRadius),
        interceptsPointer:document.elementFromPoint(1,innerHeight/2) === shell },
      contrastSamples:[button].map(node => {
        const control = getComputedStyle(node);
        return { label:node.className, paper:rgb(css.backgroundColor, control.backgroundColor),
          ink:rgb(css.backgroundColor, control.backgroundColor, control.color) };
      }) };
  })()`);
  assert(sample.location === location, `Header tint must follow the committed ${location} provider`);
  assert(JSON.stringify(sample.background) === JSON.stringify(location === 'cloud' ? sample.cloudBackground : sample.expected), `Cloud must tint only the Header and follow its appearance mode: ${JSON.stringify(sample)}`);
  // The control uses the Header's own ink: full text while hovered or open,
  // muted at rest. A CI runner's pointer can leave Chromium's hover state a
  // frame behind, so either Header ink is accepted; a foreign color is not.
  assert(sample.controlInks.some(ink => JSON.stringify(ink) === JSON.stringify(sample.buttonColor)),
    `Project control ink must be the current theme's Header ink: ${JSON.stringify({ button:sample.buttonColor, inks:sample.controlInks, interactive:sample.interactive })}`);
  assert(!sample.locationControl, 'The Header must not switch one project between this computer and the Cloud');
  assert(sample.backgroundImage === 'none', 'The previous gradient must be removed');
  const expectedIcon = sample.buttonColor;
  assert(JSON.stringify(sample.icon.color) === JSON.stringify(sample.labelColor), 'The project mark must match the project name, open or closed');
  assert(sample.icon.product === 'home' && JSON.stringify(sample.icon.color) === JSON.stringify(expectedIcon)
    && JSON.stringify(sample.icon.paint) === JSON.stringify(expectedIcon), 'The project mark must share readable Header ink');
  assert(JSON.stringify(sample.accent) === '[69,153,223]', 'Brand blue is the approved #4599DF in both themes, not adaptive accent/info');
  assert(JSON.stringify(sample.labelColor) === JSON.stringify(sample.buttonColor), 'The Cloud tint must not recolor the project name');
  assert(sample.frame.location === location && sample.frame.identity === 'retained-shell', 'Window frame must follow the same committed provider without remounting');
  assert(sample.frame.x === 0 && sample.frame.y === 0 && sample.frame.width === sample.viewport
    && sample.frame.height === sample.viewportHeight, 'Cloud frame must enclose the whole window, not just the editor');
  assert(sample.frame.content === 'none', 'Neither location may paint a frame around the workspace');
  assert(sample.identity === "retained-header" && sample.x === 0 && sample.width === sample.viewport,
    "Tint must cover the original full-width Header, including both blank sides");
  assert(Math.abs(sample.center - sample.projectCenter) < 0.01, "Tint must not move the centered project context");
  const luminance = (rgb) => rgb.map(v => v/255).map(v => v <= 0.04045 ? v/12.92 : ((v+0.055)/1.055)**2.4)
    .reduce((sum, value, i) => sum + value * [0.2126,0.7152,0.0722][i], 0);
  // Verify the project label in the regular Header; Header tabs are experimental.
  sample.contrast = Math.min(...sample.contrastSamples.map(({ ink, paper }) => {
    const a = luminance(ink), b = luminance(paper);
    return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
  }));
  assert(sample.contrast >= 4.5, `Header project text needs 4.5:1 contrast: ${sample.contrast}; ${JSON.stringify(sample.contrastSamples)}`);
  const iconInk = luminance(sample.icon.color), iconPaper = luminance(sample.contrastSamples[0].paper);
  sample.iconContrast = (Math.max(iconInk,iconPaper)+0.05)/(Math.min(iconInk,iconPaper)+0.05);
  assert(sample.iconContrast >= 3, `Project mark needs 3:1 contrast: ${sample.iconContrast}`);
  // The project is named in words, not by the Header's color alone.
  assert(sample.icon.accessibleLabel.includes('Native workspace'),
    `The project needs a textual accessible name: ${sample.icon.accessibleLabel}`);
  return sample;
}
async function windowFramePixels(sample) {
  const width = sample.viewport, height = sample.viewportHeight;
  // headerPresentation settles transitions in script; capture a frame painted after that.
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const image = await window.webContents.capturePage();
  const bitmap = image.toBitmap();
  const scale = Math.sqrt(bitmap.length / (width * height * 4));
  assert(Number.isInteger(width*scale) && Number.isInteger(height*scale), 'Capture must cover the entire viewport');
  // Read native-resolution pixels to distinguish Header tint from body edges.
  const pixel = (x, y) => {
    const offset = (Math.floor((y+0.5)*scale)*width*scale+Math.floor((x+0.5)*scale))*4;
    return [bitmap[offset+2],bitmap[offset+1],bitmap[offset]];
  };
  const distance = (a,b) => Math.max(...a.map((value,i) => Math.abs(value-b[i])));
  // CSS-to-token equality is checked above; compare actual paints in one image.
  const paintedHeader = pixel(12,10);
  // The trailing track now contains CTA text; sample the reserved outer padding.
  const header = [12,width-3].flatMap(x => [3,10,20,30,37].map(y => ({x,y,rgb:pixel(x,y)})));
  for (const point of header) assert(distance(point.rgb,paintedHeader) <= 1, `Entire Header must have one solid color: ${JSON.stringify(point)}`);
  const paintedFrame = pixel(1,Math.floor(height/2));
  const edges = [[0,Math.floor(height/2)],[1,Math.floor(height/2)],
    [width-1,Math.floor(height/2)],[width-2,Math.floor(height/2)],
    [Math.floor(width/2),height-1],[Math.floor(width/2),height-2]].map(([x,y]) => ({x,y,rgb:pixel(x,y)}));
  for (const point of edges) assert(distance(point.rgb,sample.accent) > 5,
    `Blue must not extend to the workspace side or bottom edges: ${JSON.stringify(point)}`);
  const interior = [[4,Math.floor(height/2)],[width-5,Math.floor(height/2)],[Math.floor(width/2),height-5]]
    .map(([x,y]) => ({x,y,rgb:pixel(x,y)}));
  if (sample.location === 'cloud') assert(distance(paintedFrame,paintedHeader) > 5, 'Cloud Header must remain distinct from the normal workspace');
  return {paintedHeader,paintedFrame,header,edges,interior};
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
  const side = pixel(1,Math.floor(height/2));
  assert(Math.max(...side.map((value,index) => Math.abs(value-sample.accent[index]))) > 5, 'Native window must not have a blue perimeter');
  nativeCornerCaptures.push({scene,width,height,scale,side});
}
async function openProjectMenu() {
  if (!await evaluate("Boolean(document.querySelector('.desktop-project-menu'))")) {
    // Let the Header finish the previous step (sidebar, centering) first, so the
    // frames below measure opening alone, not an anchor that is still settling.
    await evaluate(`new Promise(resolve => {
      let previous = null, stable = 0, frames = 0;
      const check = () => {
        const r = document.querySelector('.desktop-titlebar-workspace-button')?.getBoundingClientRect();
        const now = r ? [r.x, r.y, r.width, r.height].join() : null;
        stable = now && now === previous ? stable + 1 : 0;
        previous = now;
        if (stable >= 2 || ++frames > 60) resolve(); else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    })`);
    const frames = await evaluate(`new Promise((resolve, reject) => {
      const samples = [];
      document.querySelector('.desktop-titlebar-workspace-button').click();
      const sample = () => {
        try {
          const menu = document.querySelector('.desktop-project-menu');
          if (menu && getComputedStyle(menu).visibility !== 'hidden') {
            const m = menu.getBoundingClientRect();
            samples.push({ x: m.x, y: m.y, width: m.width, height: m.height });
          }
          if (samples.length < 24) requestAnimationFrame(sample); else resolve(samples);
        } catch (error) { reject(error); }
      };
      requestAnimationFrame(sample);
    })`);
    assert(frames.every(frame => ['x','y','width','height'].every(key => Math.abs(frame[key]-frames[0][key]) < 1)),
      `Opening must not expand or collapse the project menu: ${JSON.stringify(frames)}`);
  }
  await waitFor("Boolean(document.querySelector('.desktop-project-menu'))");
  assert(await evaluate("getComputedStyle(document.querySelector('.desktop-project-menu')).outlineStyle === 'none' && !document.querySelector('.desktop-project-repository-link, .desktop-project-location-controls')"),
    'The project menu must have no outer focus outline, GitHub shortcut or Local / Cloud switch');
}
async function closeProjectMenu() {
  if (!await evaluate("Boolean(document.querySelector('.desktop-project-menu'))")) return;
  await evaluate("document.querySelector('.desktop-titlebar-workspace-button').click()");
  await waitFor("!document.querySelector('.desktop-project-menu')");
}
// A local folder and its Cloud project are two projects (puppy-issues ADR-001):
// moving between them is choosing the other project's row in the project menu.
async function selectLocation(location) {
  if (filesOnly) {
    await evaluate(`window.__nativeCloudWorkbenchSmoke.selectLocation('${location}')`);
    await waitFor(`window.__nativeCloudWorkbenchSmoke.state().location === '${location}'`);
    return;
  }
  await openProjectMenu();
  const row = `.desktop-project-menu .desktop-project-switcher-row[data-project-location="${location}"]`;
  await waitFor(`Boolean(document.querySelector('${row}'))`);
  await evaluate(`document.querySelector('${row}').querySelector('button').click()`);
  await waitFor(`window.__nativeCloudWorkbenchSmoke.state().location === '${location}'`);
  await waitFor("!document.querySelector('.desktop-project-menu')");
}
async function clickNoticeAction(label) {
  await waitFor(`[...document.querySelectorAll('.desktop-local-folder-cloud-notice button')].some(button => button.textContent === ${JSON.stringify(label)})`);
  await evaluate(`[...document.querySelectorAll('.desktop-local-folder-cloud-notice button')].find(button => button.textContent === ${JSON.stringify(label)}).click()`);
}
app.whenReady().then(async () => {
  const previewDocuments = createPreviewDocumentService();
  registerPreviewDocumentIpc(ipcMain, previewDocuments);
  const platformHost = createDesktopPlatformHost();
  const formats = await cloudFormatFixtures(repo);
  const database = createDatabasePreviewService({ spawnHost: () => utilityProcess.fork(path.join(repo, 'electron/utility/database-preview/main.mjs'), [], {
    serviceName: 'Cloud Format Acceptance', stdio: 'ignore', execArgv: ['--max-old-space-size=128'] }) });
  const nativeAuth = { readSession: async () => ({ user_id: 'fixture-user', session_generation: 'fixture-session', api_base_url: 'https://cloud-fixture.puppyone.ai/api/v1' }),
      requestSessionApi: async (_base, requestPath, init) => {
        const value = await evaluate(`window.puppyoneDesktop.requestCloudSessionApi(${JSON.stringify({ path: requestPath, method: init.method, body: init.body })})`);
        if (value?.transport && !value.ok) throw Object.assign(new Error('Fixture API failure'), {status:value.error.status});
        return value;
      } };
  const nativePreviews = createCloudNativePreviewService({ database, convertOffice: platformHost.documents.convertOfficeDocumentToDocx,
    auth:nativeAuth, fetchResource: async (url) => {
      const resource = formats.resources.get(new URL(url).searchParams.get('path'));
      return resource ? new Response(resource.bytes) : new Response(null, {status:404});
    } });
  registerCloudNativePreviewIpc(ipcMain, nativePreviews);
  const cloudResources=createCloudPreviewResourceService({auth:nativeAuth});
  registerCloudPreviewResourceIpc(ipcMain,cloudResources);
  if (nativeCorners) {
    registerPlatformIpcHandlers({ ipcMain, platformHost });
    registerWindowLayoutIpcHandlers({ ipcMain, BrowserWindow });
  }
  window = new BrowserWindow({ show: false, width: 1100, height: 760, frame: nativeCorners,
    ...(nativeCorners ? platformHost.windowChrome.browserWindowOptions : {}),
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, plugins:true,
      preload:path.join(repo, `tests/fixtures/cloud/repositories/${nativeCorners ? 'window-chrome' : 'preview-document'}-preload.cjs`) } });
  window.webContents.session.protocol.handle(PREVIEW_DOCUMENT_SCHEME, (request) => previewDocuments.handle(request));
  installEmbeddedContentSessionSecurity(window.webContents.session,{applicationUrl:pathToFileURL(rendererPath).href,isAuthorizedCloudResource:cloudResources.allowed});
  installWindowNavigationSecurity({webContents:window.webContents,applicationUrl:pathToFileURL(rendererPath).href,
    isAuthorizedCloudResource:cloudResources.allowed,externalNavigation:{openDetached:(url)=>{errors.push(`Unexpected external navigation: ${url}`);}}});
  // All preview bytes pass through the live workspace file API fixture.
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Cloud report", "Value"], ["Verified", 42]]), "Cloud");
  const spreadsheet = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  window.webContents.on("console-message", (event) => {
    if (event.level !== 'error' && event.level !== 3) return;
    // Reproduced by the existing Local PDF smoke on Electron 41.10.6.
    // Keep these exact extension diagnostics visible; app errors still fail,
    // and acceptance separately requires PDFium page dimensions and paint.
    if (process.versions.electron === '41.10.6'
      && event.frame?.url === 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html'
      && event.sourceId === 'node:electron/js2c/sandbox_bundle' && event.lineNumber === 2
      && ['Electron sandboxed_renderer.bundle.js script failed to run',
        'TypeError: object null is not iterable (cannot read property Symbol(Symbol.iterator))'].includes(event.message)) {
      pdfRuntimeDiagnostics.push({message:event.message,frame:event.frame.url,source:event.sourceId,line:event.lineNumber});
      return;
    }
    if (expectedResourceFailure && /Failed to load resource:.*ERR_FILE_NOT_FOUND/.test(event.message)) handledResourceErrors.push(event.message);
    else errors.push(event.message);
  });
  await window.loadURL(`${pathToFileURL(rendererPath).href}#native-cloud-workbench-smoke`);
  await waitFor("Boolean(window.__nativeCloudWorkbenchSmoke && document.querySelector('[data-workspace-location=local] .cm-content')?.textContent.includes('LOCAL_FILE_BODY'))");
  // Visible compositing is required for captures of the paused Header reveal;
  // hidden-window capturePage can return the previous provider's frame.
  window.showInactive();
  // macOS fits a window to the display as it appears, 1024x684 on a CI runner. A
  // later resize can widen it past the display but never make it taller, so only
  // the width can be stated: the local baseline must use every later comparison's.
  window.setContentSize(1100, 760);
  await waitFor("innerWidth === 1100");
  await evaluate(`window.__nativeCloudWorkbenchSmoke.addCloudFixtures(${JSON.stringify([
    {path:'report.xlsx',mimeType:'application/octet-stream',content_base64:spreadsheet.toString('base64')},
    {path:'assets/diagram.svg',mimeType:'image/svg+xml',content:'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120"><rect width="300" height="120" fill="#102a43"/></svg>'},
  ])})`);
  await editDocument('local', 'LOCAL_UNSAVED_DRAFT');
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
  assert(await evaluate("Boolean(document.querySelector('.desktop-titlebar-terminal')) && Boolean(document.querySelector('.desktop-titlebar-changes'))"),
    'Local must expose its Chat and Git Header actions before switching');
  // The folder states its own Cloud project and opens it as another project.
  await waitFor("Boolean(document.querySelector('[data-workspace-location=local] .desktop-local-folder-cloud-notice.is-linked'))");
  assert(await evaluate("document.querySelector('.desktop-local-folder-cloud-notice').textContent.includes('Native workspace') && [...document.querySelectorAll('.desktop-local-folder-cloud-notice button')].some(button => button.textContent === 'Open Cloud project')"),
    'A linked folder must name its Cloud project and offer to open it as its own project');
  await writeFile(path.join(artifacts, 'local-folder-notice.png'), (await window.webContents.capturePage()).toPNG());
  if (filesOnly) { await selectLocation('cloud'); } else {
  await evaluate("window.__nativeCloudWorkbenchSmoke.holdCloudRead()");
  // Freeze the 260ms Header reveal on the first frame it exists, inside the
  // click's own step, so slower runners sample it instead of racing its end.
  // CI runners may run without CSS animation (reduced motion); then the reveal
  // geometry is not sampled, but the Header must still change to Cloud.
  const revealAnimated = await evaluate(`new Promise(resolve => {
    [...document.querySelectorAll('.desktop-local-folder-cloud-notice button')].find(button => button.textContent === 'Open Cloud project').click();
    let frames = 0;
    const freeze = () => {
      const animation = document.querySelector('.desktop-titlebar .desktop-cloud-header-reveal')?.getAnimations({subtree:true})[0];
      if (animation) { animation.pause(); resolve(true); return; }
      if (++frames > 120) { resolve(false); return; }
      requestAnimationFrame(freeze);
    };
    freeze();
  })`);
  await waitFor("window.__nativeCloudWorkbenchSmoke.state().location === 'cloud'");
  assert(await evaluate(`(() => {
    const header = document.querySelector('.desktop-titlebar');
    const reveal = header.querySelector('.desktop-cloud-header-reveal');
    if (reveal) reveal.dataset.fixtureIdentity = 'requested-header-reveal';
    if (!${revealAnimated}) return header.dataset.workspaceKind === 'cloud' && !document.querySelector('.desktop-cloud-entry-light');
    const animation = reveal.getAnimations({subtree:true})[0];
    animation.pause(); animation.currentTime = 35;
    const firstCircle = getComputedStyle(reveal, '::after').clipPath;
    animation.currentTime = 70;
    const laterCircle = getComputedStyle(reveal, '::after').clipPath;
    const radius = circle => Number(circle.match(/[-\\d.]+(?=%)/)?.[0]);
    return header.dataset.workspaceKind === 'cloud' && !document.querySelector('.desktop-cloud-entry-light')
      && firstCircle.startsWith('circle(') && laterCircle.startsWith('circle(')
      && firstCircle.endsWith('at 60% 85%)') && laterCircle.endsWith('at 60% 85%)')
      && radius(firstCircle) > 0 && radius(laterCircle) > radius(firstCircle)
      && animation.effect.getTiming().duration === 260
      && animation.animationName === 'desktop-cloud-header-expand';
  })()`), 'Header blue must expand from its lower-right center over 260ms while the Cloud project opens');
  assert(await evaluate("document.querySelector('.desktop-titlebar')?.dataset.workspaceKind === 'cloud' && !document.querySelector('.desktop-titlebar-terminal:not([data-cloud-workspace-tool]), .desktop-titlebar-changes') && document.querySelectorAll('[data-cloud-workspace-tool]').length === 2"),
    'Opening the Cloud project must give the Header that project and its Cloud tools, without the folder actions');
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await writeFile(path.join(artifacts, 'cloud-header-switch.png'), (await window.webContents.capturePage()).toPNG());
  await evaluate("window.__nativeCloudWorkbenchSmoke.finishCloudRead()");
  if (revealAnimated) assert(await evaluate("document.querySelector('.desktop-cloud-header-reveal').dataset.fixtureIdentity === 'requested-header-reveal' && document.querySelector('.desktop-cloud-header-reveal').getAnimations({subtree:true}).every(animation => animation.playState === 'paused')"),
    'Cloud content arriving must retain the same ongoing Header reveal');
  assert(await evaluate("!document.querySelector('.desktop-cloud-preparation, .desktop-cloud-entry-light, .desktop-cloud-entry-sweep') && !document.querySelector('[data-workspace-location=cloud]').hidden"),
    'Cloud content must appear immediately even while the Header animation is paused');
  await evaluate("document.querySelector('.desktop-cloud-header-reveal')?.getAnimations({subtree:true})[0]?.finish()");
  }
  await waitFor("Boolean(document.querySelector('[data-cloud-native=true]')?.textContent.includes('cloud-only'))");
  const initialCloudRequests = (await state()).requests;
  assert(initialCloudRequests.filter(path => path.includes('/workbench/files?') && new URL(path, 'https://fixture').searchParams.get('path') === '').length <= 2,
    'Cloud entry must reuse directory state once the live watch is active');
  assert(!initialCloudRequests.some(path => path.includes('/workbench/file?')),
    'Opening a Cloud project must not download unopened file bodies for a Markdown index');
  assert(await evaluate("document.querySelector('[data-workspace-location=local]').hidden && !document.querySelector('[data-workspace-location=cloud]').hidden && !document.querySelector('.desktop-cloud-dialog, [role=dialog]')"), "Opening the Cloud project must replace the main surface without a dialog");
  const cloudHeader = await evaluate(`(() => {
    const header = document.querySelector('.desktop-titlebar');
    const context = document.querySelector('.desktop-titlebar-centered-context');
    const h = header.getBoundingClientRect(), c = context.getBoundingClientRect();
    return { identity:header.dataset.fixtureIdentity, count:document.querySelectorAll('.desktop-titlebar').length,
      headerCenter:h.x + h.width / 2, contextCenter:c.x + c.width / 2,
      projectName:context.querySelector('.desktop-titlebar-workspace-name')?.textContent };
  })()`);
  assert(cloudHeader.identity === "retained-header" && cloudHeader.count === 1,
    "Moving between the folder and its Cloud project must retain one Header DOM host");
  assert(Math.abs(localHeader.headerCenter - localHeader.contextCenter) < 0.01
    && Math.abs(cloudHeader.headerCenter - cloudHeader.contextCenter) < 0.01
    && cloudHeader.projectName === localHeader.projectName,
    "Project name must remain centered and stable between the folder and its Cloud project");
  assert(await evaluate("!document.querySelector('[data-cloud-native=true]').textContent.includes('local-only') && document.querySelector('[data-cloud-native=true]').textContent.includes('cloud-only')"), "Cloud tree must contain Cloud files only");
  await evaluate("[...document.querySelectorAll('[data-cloud-native=true] .tree-row')].find(row => row.textContent.includes('readme')).click()");
  await waitFor("Boolean(document.querySelector('[data-workspace-location=cloud] .cm-content')?.textContent.includes('CLOUD_FILE_BODY'))");
  const openedFileRequests = (await state()).requests.slice(initialCloudRequests.length)
    .filter(path => path.includes('/workbench/file?'));
  assert(openedFileRequests.length === 1 && new URL(openedFileRequests[0], 'https://fixture').searchParams.get('path') === 'readme.txt',
    `Opening known text must make one live file read: ${JSON.stringify(openedFileRequests)}`);
  const cloudPresentation = await presentation("cloud");
  for (const region of ["explorer", "editor", "footer", "row", "code"]) {
    const before = localPresentation[region], after = cloudPresentation[region];
    for (const property of region === "row" ? ["color", "font", "padding"] : ["x", "y", "width", "height", "background", "font", "padding"]) {
      assert(typeof before[property] === "number" ? Math.abs(before[property] - after[property]) < 1 : before[property] === after[property],
        `Native ${region} ${property} changed on Cloud switch: ${before[property]} -> ${after[property]}`);
    }
  }
  assert(await evaluate("!document.querySelector('[data-workspace-location=cloud] .desktop-explorer-toolbar, [data-workspace-location=cloud] .desktop-cloud-service-sidebar, [data-workspace-location=cloud] .desktop-cloud-inline-navigation')"), "Cloud must use the native file UI without a separate toolbar or service menu");
  await editDocument('cloud', 'CLOUD_EDIT_ONLY');
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
  assert(await evaluate("document.querySelector('[data-workspace-location=cloud] .cm-content').textContent.includes('CLOUD_EDIT_ONLY')"), "Returning to Cloud must retain its own document content");
  await evaluate("window.__nativeCloudWorkbenchSmoke.holdCloudRead(); [...document.querySelectorAll('[data-cloud-native=true] .tree-row')].find(row => row.textContent.includes('cloud-only')).click()");
  await waitFor("Boolean(document.querySelector('[data-cloud-native=true] .document-surface-preparation-pending [data-puppy-loader]'))");
  assert(await evaluate("document.querySelector('[data-cloud-native=true] .tree-row[aria-selected=true]').textContent.includes('cloud-only') && Boolean(document.querySelector('[data-cloud-native=true] .document-surface-slot.is-obscured[aria-hidden=true]'))"),
    'Cloud file selection must update immediately and replace the previous content with normal loading before the read finishes');
  await writeFile(path.join(artifacts, 'cloud-file-loading.png'), (await window.webContents.capturePage()).toPNG());
  await evaluate("[...document.querySelectorAll('[data-cloud-native=true] .tree-row')].find(row => row.textContent.includes('readme')).click(); window.__nativeCloudWorkbenchSmoke.finishCloudRead()");
  await waitFor("window.__nativeCloudWorkbenchSmoke.state().requests.some(path => path.includes('/workbench/file?') && path.endsWith('path=cloud-only.md'))");
  await waitFor("!document.querySelector('[data-cloud-native=true] .document-surface-preparation-pending') && document.querySelector('[data-cloud-native=true] .cm-content').textContent.includes('CLOUD_EDIT_ONLY')");
  assert(await evaluate("document.querySelector('[data-cloud-native=true] .tree-row[aria-selected=true]').textContent.includes('readme')"),
    'A late Cloud file read must not replace a newer file selection or its retained draft');
  const folderReads = () => evaluate("window.__nativeCloudWorkbenchSmoke.state().requests.filter(path => path.includes('/workbench/files?') && path.endsWith('path=records')).length");
  const readsBeforeExpansion = await folderReads();
  const clickRecords = () => evaluate("[...document.querySelectorAll('[data-cloud-native=true] .tree-row')].find(row => row.textContent.includes('records')).click()");
  await evaluate("window.__nativeCloudWorkbenchSmoke.holdCloudRead()");
  await clickRecords();
  await waitFor("Boolean(document.querySelector('[data-cloud-native=true] .explorer-tree-branch-skeleton'))");
  assert(await evaluate("[...document.querySelectorAll('[data-cloud-native=true] .tree-row')].find(row => row.textContent.includes('records')).getAttribute('aria-expanded') === 'true'"),
    'Cloud folders must expand immediately with an indented loading row during a slow read');
  await evaluate("Promise.all(document.querySelector('[data-cloud-native=true] .explorer-tree-shell').getAnimations({subtree:true}).filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await writeFile(path.join(artifacts, 'cloud-folder-loading.png'), (await window.webContents.capturePage()).toPNG());
  await clickRecords();
  await clickRecords();
  assert(await folderReads() === readsBeforeExpansion + 1, 'Repeated Cloud expansion must share the pending directory read');
  await clickRecords();
  await evaluate("window.__nativeCloudWorkbenchSmoke.finishCloudRead(); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  assert(await evaluate("[...document.querySelectorAll('[data-cloud-native=true] .tree-row')].find(row => row.textContent.includes('records')).getAttribute('aria-expanded') === 'false'"),
    'A completed Cloud directory read must preserve the user\'s collapse intent');
  await clickRecords();
  await waitFor("document.querySelector('[data-cloud-native=true]').textContent.includes('sample')");
  assert(await folderReads() === readsBeforeExpansion + 1, 'A loaded Cloud folder must reopen from its retained tree cache');
  await evaluate("[...document.querySelectorAll('[data-cloud-native=true] .tree-row')].find(row => row.textContent.includes('sample')).click()");
  await waitFor("[...document.querySelectorAll('[data-cloud-native=true] .csv-table-editor__table input, [data-cloud-native=true] .csv-table-editor__table textarea')].some(input => input.value === '42')");
  assert(await evaluate("[...document.querySelectorAll('[data-cloud-native=true] .csv-table-editor__table input, [data-cloud-native=true] .csv-table-editor__table textarea')].some(input => input.value === '42')"), "Cloud data files must use the native data viewer");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await writeFile(path.join(artifacts, "cloud-data.png"), (await window.webContents.capturePage()).toPNG());
  await evaluate(`(() => {
    const input = [...document.querySelectorAll('[data-cloud-native=true] .csv-table-editor__table input, [data-cloud-native=true] .csv-table-editor__table textarea')].find(input => input.value === '42');
    input.focus(); input.select();
  })()`);
  await window.webContents.insertText("43");
  await waitFor("window.__nativeCloudWorkbenchSmoke.state().cloudWrites.some(write => write.path === 'records/sample.csv' && write.content.includes('43'))");
  const openCloudFile = async (name) => {
    await evaluate(`[...document.querySelectorAll('[data-cloud-native=true] .tree-row')].find(row => row.querySelector('.tree-label-primary')?.textContent === ${JSON.stringify(name)}).click()`);
  };
  await openCloudFile("notes");
  await waitFor("Boolean(document.querySelector('[data-cloud-native=true] img[alt=\"Cloud diagram\"]')?.naturalWidth)");
  await writeFile(path.join(artifacts, "cloud-markdown-assets.png"), (await window.webContents.capturePage()).toPNG());
  await editDocument('cloud', '# Cloud note updated\n\n![Cloud diagram](/assets/diagram.svg)');
  await waitFor("window.__nativeCloudWorkbenchSmoke.state().cloudWrites.some(write => write.path === 'notes.md' && write.content.includes('Cloud note updated'))");
  await openCloudFile("settings");
  await waitFor("document.querySelector('[data-cloud-native=true] .document-surface-slot.is-committed:not(.is-obscured) .cm-content')?.textContent.includes('cloud')");
  await editDocument('cloud', '{"cloud":true,"saved":true}');
  await waitFor("window.__nativeCloudWorkbenchSmoke.state().cloudWrites.some(write => write.path === 'settings.json' && write.content.includes('saved'))");
  await openCloudFile("page");
  await waitFor("Boolean(document.querySelector('[data-cloud-native=true] .document-surface-slot.is-committed:not(.is-obscured) .html-document-editor iframe[aria-busy=false]'))");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await writeFile(path.join(artifacts, "cloud-html.png"), (await window.webContents.capturePage()).toPNG());
  await evaluate("document.querySelector('[data-cloud-native=true] .desktop-editor-pane-handle').click()");
  await waitFor("Boolean(document.querySelector('.desktop-editor-pane-menu button[aria-label=\"Source code\"]'))");
  await evaluate("document.querySelector('.desktop-editor-pane-menu button[aria-label=\"Source code\"]').click()");
  // View modes are a toggle that keeps the menu open. Dismiss it as a person
  // would, or it stays open over later steps once its pane is hidden.
  await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))");
  await waitFor("!document.querySelector('.desktop-editor-pane-menu')");
  await waitFor("Boolean(document.querySelector('[data-cloud-native=true] .document-surface-slot.is-committed:not(.is-obscured) .html-document-editor .cm-editor'))");
  await editDocument('cloud', '<!doctype html><h1>Cloud HTML saved</h1>');
  await waitFor("window.__nativeCloudWorkbenchSmoke.state().cloudWrites.some(write => write.path === 'page.html' && write.content.includes('Cloud HTML saved'))");
  await openCloudFile("report");
  await waitFor("Boolean(document.querySelector('[data-cloud-native=true] .document-surface-slot.is-committed[data-surface-ready=true] .office-spreadsheet-preview'))");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await writeFile(path.join(artifacts, "cloud-office.png"), (await window.webContents.capturePage()).toPNG());
  await evaluate("window.__nativeCloudWorkbenchSmoke.openCloudFile('readme.txt')");
  await waitFor("document.querySelector('[data-cloud-native=true] .cm-content')?.textContent.includes('CLOUD_EDIT_ONLY')");
  await evaluate("window.__nativeCloudWorkbenchSmoke.agentWrite('readme.txt', 'AGENT_UNCOMMITTED_BODY')");
  await waitFor("document.querySelector('[data-cloud-native=true] .cm-content')?.textContent.includes('AGENT_UNCOMMITTED_BODY')");
  await evaluate("window.__nativeCloudWorkbenchSmoke.agentWrite('readme.txt', 'CLOUD_EDIT_ONLY')");
  await waitFor("document.querySelector('[data-cloud-native=true] .cm-content')?.textContent.includes('CLOUD_EDIT_ONLY')");
  const formatAcceptance = await acceptCloudFormats({window, evaluate, waitFor, fixtures:formats, artifacts, assert});
  expectedResourceFailure=true;
  formatAcceptance.retry = await acceptRevokedCloudMedia({evaluate,waitFor,assert});
  expectedResourceFailure=false;
  await writeFile(path.join(artifacts,'cloud-format-acceptance.json'),JSON.stringify({...formatAcceptance,handledResourceErrors},null,2));
  await nativePreviews.closeAll();
  await evaluate("window.__nativeCloudWorkbenchSmoke.openCloudFile('readme.txt')");
  await waitFor("document.querySelector('[data-cloud-native=true] .cm-content')?.textContent.includes('CLOUD_EDIT_ONLY')");
  if (filesOnly) {
    assert(!errors.length, `Renderer errors: ${errors.join('; ')}`);
    await evaluate("window.__nativeCloudWorkbenchSmoke.finishLocalSaves()");
    await writeFile(path.join(artifacts, 'file-operations-report.json'), JSON.stringify({
      passed: true, scope: 'Cloud file operations and format previews',
      rootReadsAtEntry: initialCloudRequests.filter(path => path.includes('/workbench/files?') && new URL(path, 'https://fixture').searchParams.get('path') === '').length,
      openedFileRequests, snapshot: await state(), errors,
    }, null, 2));
    console.log('Cloud file operations Electron acceptance passed: shared directory reads, one-request text open, edits, drafts, and format previews.');
    window.destroy(); app.exit(0); return;
  }
  assert(await evaluate("[...document.querySelectorAll('[data-cloud-workspace-tool]')].every(button => !button.disabled) && !window.__nativeCloudWorkbenchSmoke.state().requests.some(path => path.includes('/mcp-endpoints') || path.includes('/synchronize'))"),
    'Cloud tool pages must load only when the user opens a ready CTA');
  assert(await evaluate("!document.querySelector('[data-cloud-workspace-tool=automation], [data-cloud-workspace-tool=connect]')"),
    'Cloud Header exposes Share and Agent');
  await waitFor("Boolean(document.querySelector('.desktop-titlebar-reach-people .desktop-project-reach-mark[data-reach-activity=working]'))");
  assert(await evaluate(`(() => {
    const people = document.querySelector('.desktop-titlebar-reach-people').getBoundingClientRect();
    const share = document.querySelector('[data-cloud-workspace-tool=share]').getBoundingClientRect();
    return people.height > 0 && people.right <= share.left && people.top >= 0 && people.bottom <= document.querySelector('.desktop-titlebar').getBoundingClientRect().bottom;
  })()`), 'An active Agent stands in the Header ahead of Share, inside the Header');
  const beforeSharing = (await workspaceRequests()).length;
  await evaluate("document.querySelector('[data-cloud-workspace-tool=share]').click()");
  await waitFor("Boolean(document.querySelector('.desktop-cloud-share-people'))");
  // The link covers what the user is looking at (2b347d52): the canonical
  // project URL, narrowed to the open file when one is open.
  assert(await evaluate("/\\/11111111-1111-4111-8111-111111111111\\/(?:readme\\.txt)?$/.test(document.querySelector('.desktop-cloud-share-people').dataset.shareUrl)"),
    'Workspace sharing must expose its canonical human URL for what is being viewed');
  assert((await workspaceRequests()).length === beforeSharing, 'Sharing a URL must not issue Cloud API requests');
  await captureSettledDialog('cloud-share', '.desktop-cloud-workspace-share');
  await evaluate("document.querySelector('[data-cloud-workspace-tool=share]').click()");
  await evaluate("document.querySelector('.desktop-titlebar-place-button').click()");
  await waitFor("Boolean(document.querySelector('[data-project-place-row=history]'))");
  await evaluate("document.querySelector('[data-project-place-row=history]').click()");
  await waitFor("document.querySelector('.desktop-cloud-workspace-history')?.textContent.includes('Update research notes')");
  const beforeDetail = (await workspaceRequests()).length;
  await evaluate("document.querySelector('.desktop-cloud-workspace-history .desktop-history-row').click()");
  await waitFor("Boolean(document.querySelector('.desktop-cloud-workspace-history .desktop-commit-detail'))");
  assert((await workspaceRequests()).length === beforeDetail, 'Commit details must reuse the history response');
  await writeFile(path.join(artifacts, 'cloud-history.png'), (await window.webContents.capturePage()).toPNG());
  await evaluate("document.querySelector('.desktop-cloud-workspace-history button[aria-label=Close]').click()");
  for (const width of [1100, 720]) for (const theme of ["light", "dark"]) {
    window.setContentSize(width, 760);
    await waitFor(`innerWidth === ${width}`);
    await evaluate(`window.__nativeCloudWorkbenchSmoke.setLoginAppearance('${theme}', 'en')`);
    let before;
    for (const [index, location] of ["local", "cloud", "local"].entries()) {
      if ((await state()).location !== location) await selectLocation(location);
      if (location === "cloud") await captureCloudReady(`${theme}-${width}`);
      const sample = await headerPresentation(location);
      assert(await evaluate(`document.querySelectorAll('[data-cloud-workspace-tool]').length === ${location === 'cloud' ? 2 : 0}`),
        'Cloud CTAs must follow the active environment in both themes and widths');
      if (location === 'cloud') assert(await evaluate(`(() => {
        const project = document.querySelector('.desktop-titlebar-centered-context').getBoundingClientRect();
        return [...document.querySelectorAll('[data-cloud-workspace-tool]')].every(button => {
          const r = button.getBoundingClientRect();
          return r.x >= project.right && r.right <= innerWidth && r.y >= 0 && r.bottom <= 40;
        });
      })()`), 'Cloud CTAs must fit beside the centered project without overlapping it');
      sample.pixels = await windowFramePixels(sample);
      if (nativeCorners && location === 'cloud') {
        await captureNativeCorners(`${theme}-${width}`,sample);
        // Exercise the production event consumer without changing the user's macOS Space.
        window.webContents.send('window-layout:chrome-state-changed', {fullScreen:true});
        await waitFor("document.querySelector('.desktop-titlebar').dataset.windowFullScreen === 'true'");
        window.webContents.send('window-layout:chrome-state-changed', {fullScreen:false});
        await waitFor("document.querySelector('.desktop-titlebar').dataset.windowFullScreen !== 'true'");
      }
      if (before) for (const key of ["x", "y", "width", "height", "projectCenter"]) {
        assert(Math.abs(sample[key] - before[key]) < 0.01, `Header ${key} moved on ${theme} ${width}px switch`);
      }
      if (before) assert(JSON.stringify(sample.controlPalette) === JSON.stringify(before.controlPalette),
        `Header text and interaction colors must stay in the ${theme} theme when switching locations`);
      if (location === 'cloud') {
        const expectedCloudBackground = theme === 'dark' ? [16, 42, 67]
          : sample.expected.map((channel, i) => Math.round(channel * 0.85 + sample.accent[i] * 0.15));
        assert(sample.background.every((channel, i) => Math.abs(channel - expectedCloudBackground[i]) <= 1),
          `Cloud Header must use deep blue in dark mode and theme grey tinted with product blue in light mode: ${JSON.stringify(sample.background)}`);
      }
      before ??= sample;
      headerPresentations.push({ theme, width, index, ...sample });
      if (index < 2) await writeFile(path.join(artifacts, `header-${theme}-${width}-${location}.png`), (await window.webContents.capturePage()).toPNG());
      if (location === "cloud") {
        await openProjectMenu();
        assert(await evaluate("document.querySelector('.desktop-project-menu [aria-current=page]')?.closest('.desktop-project-switcher-row')?.dataset.projectLocation === 'cloud'"),
          'The project menu must mark the open Cloud project, not the folder, as current');
        headerPresentations.push({ theme, width, expanded:true, ...await headerPresentation(location) });
        await closeProjectMenu();
      }
    }
  }
  for (const width of [1100, 720]) for (const theme of ['light', 'dark']) {
    window.setContentSize(width, 760);
    await waitFor(`innerWidth === ${width}`);
    await evaluate(`window.__nativeCloudWorkbenchSmoke.setLoginAppearance('${theme}', 'en')`);
    for (const centered of [true, false]) for (const location of ['local', 'cloud']) {
      await evaluate(`window.__nativeCloudWorkbenchSmoke.setCenteredProject(${centered})`);
      if ((await state()).location !== location) await selectLocation(location);
      await evaluate("window.__nativeCloudWorkbenchSmoke.setSidebarCollapsed(true)");
      await waitFor("Boolean(document.querySelector('.desktop-titlebar-sidebar-expand'))");
      const leading = await evaluate(`(() => {
        const header = document.querySelector('.desktop-titlebar');
        const home = header.querySelector('.desktop-titlebar-home').getBoundingClientRect();
        const expand = header.querySelector('.desktop-titlebar-sidebar-expand').getBoundingClientRect();
        const project = header.querySelector('.desktop-titlebar-workspace-button').getBoundingClientRect();
        return { gap: expand.x - home.right, projectGap: project.x - expand.right, home: home.width, expand: expand.width,
          expectedGap: parseFloat(getComputedStyle(header).getPropertyValue('--desktop-titlebar-button-gap')),
          expectedSize: parseFloat(getComputedStyle(header).getPropertyValue('--desktop-chrome-control-size')),
          expectedExpandSize: parseFloat(getComputedStyle(header).getPropertyValue('--desktop-titlebar-tool-action-width')) };
      })()`);
      assert(leading.gap >= leading.expectedGap - 0.1,
        `Left Header controls must retain the Element spacing in ${location}, ${theme}, ${width}px: ${JSON.stringify(leading)}`);
      assert(Math.abs(leading.home - leading.expectedSize) < 0.1 && Math.abs(leading.expand - leading.expectedExpandSize) < 0.1,
        `Left Header controls must not shrink on ${location} entry: ${JSON.stringify(leading)}`);
      if (!centered) assert(leading.projectGap >= leading.expectedGap - 0.1,
        `Expand and project controls must keep their gap in ${location}, ${theme}, ${width}px: ${JSON.stringify(leading)}`);
      if (location === 'cloud') {
        await evaluate("Promise.all((document.querySelector('.desktop-cloud-header-reveal')?.getAnimations({subtree:true}) ?? []).map(animation => animation.finished.catch(() => {})))");
        await writeFile(path.join(artifacts, `header-leading-${theme}-${width}-${centered ? 'centered' : 'left'}.png`), (await window.webContents.capturePage()).toPNG());
      }
      await evaluate("document.querySelector('.desktop-titlebar-sidebar-expand').click()");
      await waitFor("!document.querySelector('.desktop-titlebar-sidebar-expand')");
    }
  }
  await evaluate("window.__nativeCloudWorkbenchSmoke.setCenteredProject(true)");
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features:[{name:'prefers-reduced-motion',value:'reduce'}],
  });
  await selectLocation("cloud");
  assert(await evaluate("!document.querySelector('.desktop-cloud-entry-light, .desktop-cloud-entry-sweep') && getComputedStyle(document.querySelector('.desktop-cloud-header-reveal')).display === 'none' && getComputedStyle(document.querySelector('.desktop-cloud-header-reveal'), '::after').animationName === 'none'"),
    "Reduced motion must apply the Cloud Header immediately without decorative motion");
  await selectLocation("local");
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {features:[]});
  window.webContents.debugger.detach();
  window.setContentSize(1100, 760);
  await waitFor("innerWidth === 1100");
  await evaluate("window.__nativeCloudWorkbenchSmoke.setLoginAppearance('dark', 'en')");
  await selectLocation("cloud");
  await evaluate("window.__nativeCloudWorkbenchSmoke.setCloudSessionAvailable(false)");
  await waitFor("window.__nativeCloudWorkbenchSmoke.state().location === 'local'");
  await headerPresentation("local");
  assert(await evaluate("document.querySelector('[data-workspace-location=local] .cm-editor')?.dataset.fixtureIdentity === 'retained-local-host'"), "Session loss must restore the retained local editor");
  // Signed out, the folder still opens and says how to reach its Cloud project.
  await waitFor("Boolean(document.querySelector('.desktop-local-folder-cloud-notice.is-sign-in'))");
  await clickNoticeAction('Sign in');
  await waitFor("Boolean(document.querySelector('.desktop-cloud-dialog .desktop-cloud-auth-submit'))");
  assert(await evaluate("window.__nativeCloudWorkbenchSmoke.state().location === 'local' && !document.querySelector('[data-workspace-location=local]').hidden && document.querySelector('[data-workspace-location=cloud]').hidden"),
    "Signing in must never replace the local folder");
  assert(await evaluate("document.querySelector('.desktop-titlebar')?.dataset.workspaceKind !== 'cloud' && Boolean(document.querySelector('.desktop-titlebar-terminal')) && Boolean(document.querySelector('.desktop-titlebar-changes'))"),
    'Signing in must retain the local Header identity and actions');
  await headerPresentation("local");
  // Cached Cloud entry no longer supplies an accidental network delay after
  // the preceding sidebar collapse/expand matrix. Measure the settled pane.
  await evaluate("Promise.all([...document.querySelectorAll('[data-workspace-location=local] .po-collapsible-pane-frame')].flatMap(node => node.getAnimations()).map(animation => animation.finished.catch(() => {})))");
  const authGeometry = await presentation("local");
  for (const region of ["explorer", "editor", "footer"]) for (const property of ["x", "y", "width", "height"]) {
    assert(Math.abs(authGeometry[region][property] - localPresentation[region][property]) < 1,
      `Authentication changed retained local ${region} ${property}: ${localPresentation[region][property]} -> ${authGeometry[region][property]}`);
  }
  await waitFor("getComputedStyle(document.querySelector('.desktop-cloud-dialog')).opacity === '1' && document.querySelector('.desktop-cloud-dialog').getBoundingClientRect().height > 200");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await writeFile(path.join(artifacts, "login-cloud-dialog.png"), (await window.webContents.capturePage()).toPNG());
  const loginPresentations = [];
  const verifyLogin = async (scene) => {
    await evaluate(`Promise.all(document.querySelector('.desktop-cloud-dialog').getAnimations({ subtree:true })
      .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime))
      .map(animation => animation.finished.catch(() => {})))`);
    await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const sample = await evaluate(`(() => {
      const dialog = document.querySelector('.desktop-cloud-dialog');
      const content = dialog.querySelector('.desktop-cloud-dialog-content');
      const button = dialog.querySelector('.desktop-cloud-auth-submit');
      const box = (node) => { const r = node.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; };
      const b = box(button), c = box(content);
      return { dialog:box(dialog), content:c, button:b,
        inside:b.x >= c.x - 1 && b.x + b.width <= c.x + c.width + 1,
        overflow:button.scrollWidth > button.clientWidth,
        text:dialog.textContent, background:getComputedStyle(dialog).backgroundColor,
        color:getComputedStyle(button).color, locale:document.documentElement.lang,
        disabled:button.disabled,
        alert:dialog.querySelector('.desktop-cloud-auth-feedback')?.textContent ?? null };
    })()`);
    assert(Math.abs(sample.dialog.x*2 + sample.dialog.width - window.getContentSize()[0]) < 2, `Dialog is off-center: ${scene}`);
    assert(sample.inside && !sample.overflow, `Sign-in action is clipped or outside the dialog content: ${scene}: ${JSON.stringify(sample)}`);
    loginPresentations.push({ scene, ...sample });
    return sample;
  };
  const initialLogin = await verifyLogin("dark-en");
  const preview = { x: Math.floor(initialLogin.dialog.x - 24), y: Math.floor(initialLogin.dialog.y - 24),
    width: Math.ceil(initialLogin.dialog.width + 48), height: Math.ceil(initialLogin.dialog.height + 48) };
  await writeFile(path.join(artifacts, "login-preview.png"), (await window.webContents.capturePage(preview)).toPNG());
  await evaluate("document.querySelector('.desktop-cloud-auth-submit').click()");
  await waitFor("document.querySelector('.desktop-cloud-auth-submit')?.disabled === true");
  let login = await verifyLogin("waiting-en");
  assert(login.disabled && login.text.includes("Signing in"), "Pending login must be disabled and say it is signing in");
  await writeFile(path.join(artifacts, "login-waiting.png"), (await window.webContents.capturePage()).toPNG());
  await evaluate("window.__nativeCloudWorkbenchSmoke.failLogin()");
  await waitFor("Boolean(document.querySelector('.desktop-cloud-dialog .desktop-cloud-auth-feedback'))");
  login = await verifyLogin("error-en");
  assert(!login.disabled && login.alert.includes("Try again"), "Failed login must offer another attempt");
  await writeFile(path.join(artifacts, "login-error.png"), (await window.webContents.capturePage()).toPNG());
  await evaluate("window.__nativeCloudWorkbenchSmoke.resetLogin()");
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
  await waitFor("!document.querySelector('.desktop-cloud-dialog')");
  await evaluate("window.__nativeCloudWorkbenchSmoke.setCloudSessionAvailable(true)");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  assert((await state()).location === "local", "Signing in must never open the Cloud project by itself");
  await waitFor("Boolean(document.querySelector('.desktop-local-folder-cloud-notice.is-linked'))");
  await headerPresentation("local");
  // Signing in from the notice closes the dialog and keeps the folder in front;
  // its Cloud project opens only when asked for.
  await evaluate("window.__nativeCloudWorkbenchSmoke.setCloudSessionAvailable(false)");
  await clickNoticeAction('Sign in');
  await waitFor("Boolean(document.querySelector('.desktop-cloud-dialog'))");
  await evaluate("window.__nativeCloudWorkbenchSmoke.setCloudSessionAvailable(true)");
  await waitFor("!document.querySelector('.desktop-cloud-dialog') && window.__nativeCloudWorkbenchSmoke.state().location === 'local'");
  await clickNoticeAction('Open Cloud project');
  await waitFor("window.__nativeCloudWorkbenchSmoke.state().location === 'cloud'");
  await waitFor("document.querySelector('[data-cloud-native=true]').textContent.includes('cloud-only')");
  await selectLocation("local");
  assert(await evaluate("document.querySelector('[data-workspace-location=local] .cm-editor')?.dataset.fixtureIdentity === 'retained-local-host' && document.querySelector('[data-workspace-location=local] .cm-content').textContent.includes('LOCAL_UNSAVED_DRAFT')"), "Authentication must preserve local drafts");
  // A folder without a Cloud project: its Cloud entry starts putting it in the Cloud.
  await evaluate("window.__nativeCloudWorkbenchSmoke.setRepositoryLocalOnly(true); window.__nativeCloudWorkbenchSmoke.setCloudSessionAvailable(false)");
  await waitFor("!document.querySelector('.desktop-local-folder-cloud-notice')");
  await evaluate("window.__nativeCloudWorkbenchSmoke.requestCloud()");
  await waitFor("Boolean(document.querySelector('.desktop-cloud-dialog .desktop-cloud-auth-submit'))");
  await evaluate("window.__nativeCloudWorkbenchSmoke.setCloudSessionAvailable(true)");
  await waitFor("Boolean(document.querySelector('.desktop-cloud-dialog [data-cloud-publish-action]:not(:disabled)'))");
  const activationTitle = await evaluate("document.querySelector('.desktop-cloud-dialog .desktop-cloud-project-activation-title').textContent");
  assert(/^Put .+ in the cloud$/.test(activationTitle), `Signing in to an unhosted folder must continue to its first publish: ${activationTitle}`);
  const publishPresentations = [];
  // The Cloud dialog's publish surface at every window width the app allows
  // (DESKTOP_WINDOW_MIN_WIDTH is 720).
  for (const [width, height] of [[1100,760], [720,640]]) {
    window.setContentSize(width, height);
    await waitFor(`innerWidth === ${width}`);
    for (const theme of ['light', 'dark']) {
      await evaluate(`window.__nativeCloudWorkbenchSmoke.setLoginAppearance('${theme}', 'en')`);
      await evaluate(`Promise.all([
        ...document.querySelector('[data-cloud-publish-action]').getAnimations(),
        ...document.querySelector('.desktop-cloud-dialog').getAnimations()
      ].map(animation => animation.finished.catch(() => {})))`);
      const presentation = await evaluate(`(() => {
        const dialog = document.querySelector('.desktop-cloud-dialog');
        const card = dialog.querySelector('.desktop-cloud-project-activation');
        const button = card.querySelector('[data-cloud-publish-action]');
        const rect = dialog.getBoundingClientRect();
        return { width:rect.width, height:rect.height, x:rect.x, y:rect.y,
          overflow:card.scrollWidth > card.clientWidth || button.scrollWidth > button.clientWidth,
          action:button.textContent, color:getComputedStyle(button).color, background:getComputedStyle(button).backgroundColor };
      })()`);
      assert(presentation.x >= 0 && presentation.y >= 0 && presentation.x + presentation.width <= width && !presentation.overflow,
        `Publish dialog must fit without clipping (${theme}/${width}): ${JSON.stringify(presentation)}`);
      assert(presentation.action === 'Upload to Cloud', 'Authenticated activation must offer actual publication');
      publishPresentations.push({theme, viewport:width, ...presentation});
      if (width === 1100 || width === 720) await writeFile(path.join(artifacts, `publish-${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG());
    }
  }
  window.setContentSize(1100,760);
  await evaluate("document.querySelector('[data-cloud-publish-action]').click()");
  await waitFor("Boolean(document.querySelector('.desktop-cloud-publish-confirmation'))");
  assert((await state()).publishRequests.length === 0, 'The existing upload confirmation must precede publication');
  assert(await evaluate("document.querySelector('.desktop-cloud-publish-confirmation').textContent.includes('this folder stays a separate project on this computer')"),
    'The publish confirmation must say the Cloud project is a separate project');
  await captureSettledDialog('publish-confirmation', '.desktop-cloud-publish-confirmation');
  await evaluate("document.querySelector('.desktop-cloud-publish-confirmation .desktop-dialog-button.primary').click()");
  await waitFor("window.__nativeCloudWorkbenchSmoke.state().publishRequests.length === 1");
  assert((await state()).publishRequests[0] === 'fixture-org', 'Publication must use the selected organization');
  assert((await state()).location === 'local' && await evaluate("Boolean(document.querySelector('.desktop-cloud-dialog .desktop-cloud-publish-running'))"),
    'Uploading must retain the local folder and show existing publication progress');
  await evaluate("window.__nativeCloudWorkbenchSmoke.finishPublish()");
  await waitFor("!document.querySelector('.desktop-cloud-dialog') && Boolean(document.querySelector('.desktop-local-folder-cloud-notice.is-linked'))");
  assert((await state()).location === 'local', 'A finished publish must leave the folder open and link it to its new Cloud project');
  // A folder whose Cloud project is in another environment opens normally and says so.
  await evaluate("window.__nativeCloudWorkbenchSmoke.setRepositoryWrongHost(true)");
  await waitFor("Boolean(document.querySelector('.desktop-local-folder-cloud-notice.is-other-environment'))");
  assert(await evaluate(`(() => {
    const notice = document.querySelector('.desktop-local-folder-cloud-notice');
    return notice.textContent.includes('another Puppyone environment') && notice.textContent.includes('http://api.puppyone.ai')
      && ![...notice.querySelectorAll('button')].some(button => /Open Cloud project|Reconnect/.test(button.textContent));
  })()`), 'Another environment must be explained without an action that cannot succeed');
  await evaluate("window.__nativeCloudWorkbenchSmoke.requestCloud()");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  assert(await evaluate("!document.querySelector('.desktop-cloud-dialog, [role=dialog]') && Boolean(document.querySelector('.desktop-local-folder-cloud-notice.is-other-environment'))")
    && (await state()).location === 'local', 'Asking for a Cloud project in another environment must explain, never block the folder');
  for (const theme of ['light', 'dark']) {
    await evaluate(`window.__nativeCloudWorkbenchSmoke.setLoginAppearance('${theme}', 'en')`);
    await evaluate("Promise.all(document.querySelector('.desktop-local-folder-cloud-notice').getAnimations({subtree:true}).map(animation => animation.finished.catch(() => {})))");
    await writeFile(path.join(artifacts, `other-environment-${theme}.png`), (await window.webContents.capturePage()).toPNG());
  }
  // A folder whose Cloud project disappeared can be put in the Cloud again.
  await evaluate("window.__nativeCloudWorkbenchSmoke.setRepositoryWrongHost(false)");
  await evaluate("window.__nativeCloudWorkbenchSmoke.setRepositoryMissing(true)");
  await waitFor("Boolean(document.querySelector('.desktop-local-folder-cloud-notice.is-missing'))");
  assert((await state()).detachRequests.length === 0, 'A missing Cloud project must not automatically detach the Git connection');
  for (const theme of ['light', 'dark']) {
    await evaluate(`window.__nativeCloudWorkbenchSmoke.setLoginAppearance('${theme}', 'en')`);
    await evaluate("Promise.all(document.querySelector('.desktop-local-folder-cloud-notice').getAnimations({subtree:true}).map(animation => animation.finished.catch(() => {})))");
    await writeFile(path.join(artifacts, `missing-project-${theme}.png`), (await window.webContents.capturePage()).toPNG());
  }
  await clickNoticeAction('Put in the Cloud again');
  await waitFor("Boolean(document.querySelector('.desktop-cloud-publish-confirmation'))");
  await captureSettledDialog('missing-project-confirmation', '.desktop-cloud-publish-confirmation');
  assert((await state()).detachRequests.length === 0, 'Replacement confirmation must precede detaching');
  await evaluate("[...document.querySelectorAll('.desktop-cloud-publish-confirmation button')].find(button => button.textContent === 'Cancel').click()");
  await waitFor("!document.querySelector('.desktop-cloud-publish-confirmation')");
  assert((await state()).detachRequests.length === 0, 'Cancelling replacement must keep the old connection');
  await clickNoticeAction('Put in the Cloud again');
  await waitFor("Boolean(document.querySelector('.desktop-cloud-publish-confirmation'))");
  await evaluate("document.querySelector('.desktop-cloud-publish-confirmation button.primary').click()");
  await waitFor("Boolean(document.querySelector('.desktop-cloud-dialog [data-cloud-publish-action]'))");
  assert((await state()).detachRequests.length === 1 && (await state()).detachRequests[0].join(',') === 'puppyone',
    'Reviewed replacement must detach exactly the old canonical Cloud remote');
  assert((await state()).publishRequests.length === 1,
    'Replacing the connection must return to explicit organization-scoped publication without uploading automatically');
  await captureSettledDialog('missing-project-ready-to-publish', '.desktop-cloud-dialog');
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await waitFor("!document.querySelector('.desktop-cloud-dialog')");
  assert((await state()).location === 'local', 'The folder stays open throughout');
  await evaluate("window.__nativeCloudWorkbenchSmoke.finishLocalSaves()");
  snapshot = await state();
  assert(!errors.length, `Renderer errors: ${errors.join("; ")}`);
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify({ passed: true, electronVersion:process.versions.electron, pdfRuntimeDiagnostics, localHost, localPresentation, cloudPresentation, headerPresentations,  nativeCornerCaptures, authGeometry, loginPresentations, publishPresentations, snapshot, errors }, null, 2));
  console.log("Native Cloud workbench smoke passed: a local folder and its Cloud project as two projects in one retained shell, identical native layout/styles, Cloud tree/data/edit/save, folder notices, Cloud dialog sign-in across themes and eight locales, first publish, other-environment and missing-project folders, isolated drafts and retained hosts.");
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
