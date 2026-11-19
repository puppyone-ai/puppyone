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
// The Cloud Header's tools: the Agent pane, and the empty invite seat only while
// no Agent is here (or while that is still being checked). Legacy Share has no entry.
const cloudTools = `(() => {
  const tools = [...document.querySelectorAll('[data-cloud-workspace-tool]')].map(tool => tool.dataset.cloudWorkspaceTool);
  return tools.includes('agent') && tools.every(tool => tool === 'agent' || tool === 'invite-agent');
})()`;
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
  // Measure settled contrast after control transitions.
  await evaluate("Promise.all([...document.querySelectorAll('.desktop-titlebar-workspace-button')].flatMap(button => button.getAnimations()).map(animation => animation.finished.catch(() => {})))");
  const sample = await evaluate(`(() => {
    // Under Reduce Motion the app gives every property a 0.01ms transition, so
    // a style read right after a provider switch returns the old color. Settle
    // in-flight transitions so the sample is the committed presentation.
    document.getAnimations().filter(animation => animation instanceof CSSTransition).forEach(animation => animation.finish());
    const header = document.querySelector('.desktop-titlebar');
    const context = header.querySelector('.desktop-titlebar-context');
    // The project trigger is the Header's one project control; no Local /
    // Cloud switch sits beside it (ADR-001), so its ink carries the checks.
    const button = context.querySelector('.desktop-titlebar-workspace-button');
    const mark = button.querySelector('.desktop-titlebar-workspace-mark');
    const svg = mark.matches('svg') ? mark : mark.querySelector('svg');
    const outline = svg.querySelector('[data-cloud-outline]');
    // The place control beside it is where a Cloud project is told apart.
    const place = context.querySelector('.desktop-titlebar-place-button');
    const placeMark = place?.querySelector('.desktop-titlebar-workspace-mark');
    const placeOutline = placeMark?.querySelector('[data-cloud-outline]');
    const h = header.getBoundingClientRect();
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
      x:h.x, y:h.y, projectLeft:context.getBoundingClientRect().x, projectButtonLeft:button.getBoundingClientRect().x, width:h.width, height:h.height, viewport:innerWidth, viewportHeight:innerHeight,
      background:rgb(css.backgroundColor), expected:rgb(expected), accent:rgb(accent),
      themeText:rgb(themeText),
      place:place ? { location:place.dataset.projectPlace ?? null, cloudOutline:Boolean(placeOutline),
        color:rgb(getComputedStyle(placeMark).color), paint:rgb(getComputedStyle(placeOutline ?? placeMark).stroke),
        labelColor:rgb(getComputedStyle(place).color), text:place.textContent,
        addressFits:(() => { const a = place.querySelector('.desktop-titlebar-place-address'); return Boolean(a) && a.scrollWidth <= a.clientWidth; })(),
        right:place.getBoundingClientRect().right } : null,
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
  assert(sample.location === location, `Header place must follow the committed ${location} provider`);
  assert(JSON.stringify(sample.background) === JSON.stringify(sample.expected), `Both places must keep the theme's Header color: ${JSON.stringify(sample)}`);
  // The mark says which kind of place; the words say where it is.
  // The place leads the Header: the organization until its Space is known, or this computer.
  assert(sample.place?.location === location
    && (location === 'cloud' ? sample.place.text === 'Fixture team' : ['This Mac', 'This computer'].includes(sample.place.text))
    && sample.place.addressFits && sample.place.right <= sample.viewport && sample.place.right <= sample.projectButtonLeft,
    `The Header must state the ${location} project's place before the project, whole and on screen: ${JSON.stringify(sample.place)}`);
  if (location === 'cloud') {
    assert(sample.place?.location === 'cloud' && sample.place.cloudOutline, `The Cloud project must show its Cloud place mark: ${JSON.stringify(sample.place)}`);
    assert(JSON.stringify(sample.place.color) === JSON.stringify(sample.accent)
      && JSON.stringify(sample.place.paint) === JSON.stringify(sample.accent),
      `The Cloud mark's outline must be product blue: ${JSON.stringify(sample.place)}`);
    assert(sample.controlInks.some(ink => JSON.stringify(ink) === JSON.stringify(sample.place.labelColor)),
      `The place label keeps the Header's ink; only the cloud is blue: ${JSON.stringify(sample.place)}`);
  }
  // The control uses the Header's own ink: full text while hovered or open,
  // muted at rest. A CI runner's pointer can leave Chromium's hover state a
  // frame behind, so either Header ink is accepted; a foreign color is not.
  assert(sample.controlInks.some(ink => JSON.stringify(ink) === JSON.stringify(sample.buttonColor)),
    `Project control ink must be the current theme's Header ink: ${JSON.stringify({ button:sample.buttonColor, inks:sample.controlInks, interactive:sample.interactive })}`);
  assert(!sample.locationControl, 'The Header must not switch one project between this computer and the Cloud');
  assert(sample.backgroundImage === 'none', 'The previous gradient must be removed');
  const expectedIcon = sample.buttonColor;
  assert(JSON.stringify(sample.icon.color) === JSON.stringify(sample.labelColor), 'The project mark must match the project name, open or closed');
  assert(sample.icon.product === 'folder' && JSON.stringify(sample.icon.color) === JSON.stringify(expectedIcon)
    && JSON.stringify(sample.icon.paint) === JSON.stringify(expectedIcon), `The project folder mark must share readable Header ink: ${JSON.stringify(sample.icon)}`);
  assert(JSON.stringify(sample.accent) === '[69,153,223]', 'Brand blue is the approved #4599DF in both themes, not adaptive accent/info');
  assert(JSON.stringify(sample.labelColor) === JSON.stringify(sample.buttonColor), 'The Cloud mark must not recolor the project name');
  assert(sample.frame.location === location && sample.frame.identity === 'retained-shell', 'Window frame must follow the same committed provider without remounting');
  assert(sample.frame.x === 0 && sample.frame.y === 0 && sample.frame.width === sample.viewport
    && sample.frame.height === sample.viewportHeight, 'Cloud frame must enclose the whole window, not just the editor');
  assert(sample.frame.content === 'none', 'Neither location may paint a frame around the workspace');
  assert(sample.identity === "retained-header" && sample.x === 0 && sample.width === sample.viewport,
    "The retained Header must span the full window width, including both blank sides");
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
// This format harness retains both file surfaces but omits Home. Use the same
// project-selection callbacks at that boundary; the Header's folder menu is
// scoped to the current place and must not offer a cross-place switch.
async function selectLocation(location) {
  await closeProjectMenu();
  await evaluate(`window.__nativeCloudWorkbenchSmoke.selectLocation('${location}')`);
  await waitFor(`window.__nativeCloudWorkbenchSmoke.state().location === '${location}'`);
  if (filesOnly) return;
  await openProjectMenu();
  const row = `.desktop-project-menu .desktop-project-switcher-row[data-project-location="${location}"]`;
  await waitFor(`Boolean(document.querySelector('${row}'))`);
  assert(await evaluate(`document.querySelector('${row} button')?.getAttribute('aria-current') === 'page'
    && !document.querySelector('.desktop-project-menu .desktop-project-switcher-row[data-project-location="${location === 'local' ? 'cloud' : 'local'}"]')`),
    'The folder menu must select this project and list only its current place');
  await closeProjectMenu();
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
    const context = document.querySelector('.desktop-titlebar-context');
    header.dataset.fixtureIdentity = 'retained-header';
    header.closest('.desktop-shell').dataset.fixtureIdentity = 'retained-shell';
    return { projectName:context.querySelector('.desktop-titlebar-workspace-name')?.textContent };
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
  await evaluate("[...document.querySelectorAll('.desktop-local-folder-cloud-notice button')].find(button => button.textContent === 'Open Cloud project').click()");
  await waitFor("window.__nativeCloudWorkbenchSmoke.state().location === 'cloud'");
  assert(await evaluate("document.querySelector('.desktop-titlebar').dataset.workspaceKind === 'cloud' && !document.querySelector('.desktop-cloud-header-reveal, .desktop-cloud-entry-light')"),
    'Opening the Cloud project must state the Cloud in the Header without repainting it');
  assert(await evaluate(`document.querySelector('.desktop-titlebar')?.dataset.workspaceKind === 'cloud'
    && !document.querySelector('.desktop-titlebar-terminal:not([data-cloud-workspace-tool]), .desktop-titlebar-changes')
    && ${cloudTools}`),
    'Opening the Cloud project must give the Header that project and its Cloud tools, without the folder actions');
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await writeFile(path.join(artifacts, 'cloud-header-switch.png'), (await window.webContents.capturePage()).toPNG());
  await evaluate("window.__nativeCloudWorkbenchSmoke.finishCloudRead()");
  assert(await evaluate("!document.querySelector('.desktop-project-preparation, .desktop-cloud-entry-light, .desktop-cloud-entry-sweep') && !document.querySelector('[data-workspace-location=cloud]').hidden"),
    'Cloud content must appear immediately, without a preparation cover');
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
    const context = document.querySelector('.desktop-titlebar-context');
    return { identity:header.dataset.fixtureIdentity, count:document.querySelectorAll('.desktop-titlebar').length,
      projectName:context.querySelector('.desktop-titlebar-workspace-name')?.textContent };
  })()`);
  assert(cloudHeader.identity === "retained-header" && cloudHeader.count === 1,
    "Moving between the folder and its Cloud project must retain one Header DOM host");
  assert(cloudHeader.projectName === localHeader.projectName,
    "Project name must remain stable between the folder and its Cloud project");
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
  assert(await evaluate("!document.querySelector('[data-cloud-workspace-tool=automation], [data-cloud-workspace-tool=connect], [data-cloud-workspace-tool=share]')"),
    'Cloud Header exposes the Agents and the Agent pane, not retired entries or Share');
  await waitFor("Boolean(document.querySelector('.desktop-titlebar-cloud-agents .desktop-project-reach-mark[data-reach-activity=working]'))");
  assert(await evaluate(`(() => {
    const people = document.querySelector('.desktop-titlebar-cloud-agents').getBoundingClientRect();
    const pane = document.querySelector('[data-cloud-workspace-tool=agent]').getBoundingClientRect();
    return people.height > 0 && people.right <= pane.left && people.top >= 0 && people.bottom <= document.querySelector('.desktop-titlebar').getBoundingClientRect().bottom;
  })()`), 'An active Agent stands in the Header ahead of the Agent pane, inside the Header');
  // Once an Agent is here, the list it opens invites the next: the Header has no empty seat.
  await waitFor("!document.querySelector('[data-cloud-workspace-tool=invite-agent]')");
  const beforeAgents = (await workspaceRequests()).length;
  // Resting the pointer on an Agent shows its card under it: when it last worked, who it is, how it got in.
  const agentMark = "document.querySelector('.desktop-titlebar-cloud-agents [data-cloud-workspace-agent]')";
  await evaluate(`${agentMark}.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); true`);
  await waitFor("Boolean(document.querySelector('[data-cloud-agent-card]')?.textContent.includes('Claude Code'))");
  assert(await evaluate(`(() => {
    const card = document.querySelector('[data-cloud-agent-card]').getBoundingClientRect();
    const header = document.querySelector('.desktop-titlebar').getBoundingClientRect();
    const when = document.querySelector('.desktop-cloud-agent-card-when').textContent;
    return card.top >= header.bottom && card.right <= innerWidth && card.left >= 0 && card.width > 200
      && when === 'Working now' && getComputedStyle(document.querySelector('[data-cloud-agent-card]')).pointerEvents === 'none';
  })()`), 'The card must hang under the Header, inside the window, and say the Agent is working');
  await new Promise(resolve => setTimeout(resolve, 650));
  assert(await evaluate("!document.querySelector('[role=tooltip]') && document.querySelector('.desktop-titlebar-cloud-agents').dataset.tooltipDisabled === 'true'"),
    'An Agent must show only its own name card, never a generic editor or whole-roster tooltip');
  await captureSettledDialog('cloud-agent-card', '[data-cloud-agent-card]');
  // Pressing it opens the Agents dialog straight away, with no menu in between.
  await evaluate(`${agentMark}.click()`);
  await waitFor("Boolean(document.querySelector('.desktop-cloud-agents-dialog .desktop-cloud-agent-tile[data-cloud-agent-row]'))");
  assert(await evaluate("!document.querySelector('[data-cloud-agent-card], .desktop-cloud-agents-panel') && document.querySelector('.desktop-cloud-agents-roster > :last-child')?.classList.contains('desktop-cloud-agent-invite-seat')"),
    'The Agents dialog must replace the card and end its row with the seat that invites, with no menu in between');
  assert((await workspaceRequests()).length === beforeAgents, 'Meeting the Agents must not issue workspace requests');
  await captureSettledDialog('cloud-agents', '.desktop-cloud-agents-dialog');
  // Pressing the seat shows only the first step: the prompt to copy and Copy, with nothing made yet.
  await evaluate("navigator.clipboard.writeText = async () => {}; true");
  await evaluate("document.querySelector('.desktop-cloud-agents-dialog [data-cloud-agent-invite-seat]').click()");
  await waitFor("document.querySelectorAll('.desktop-cloud-agent-invite-steps li').length === 1");
  assert(await evaluate("document.activeElement === document.querySelector('.desktop-cloud-agent-invite-steps .desktop-cloud-agent-share-copy') && document.querySelector('.desktop-cloud-agent-invite-prompt').textContent.endsWith('/agent/••••••') && !document.querySelector('.desktop-cloud-agent-paste-art')"),
    'The seat must show the prompt to copy, with Copy focused and no invite made yet');
  await captureSettledDialog('cloud-agents-invite-copy', '.desktop-cloud-agents-dialog');
  // Copy makes the invite; then the one thing left, beside a drawing of it that takes no pointer.
  await evaluate("document.querySelector('.desktop-cloud-agent-invite-steps .desktop-cloud-agent-share-copy').click()");
  await waitFor("document.querySelectorAll('.desktop-cloud-agent-invite-steps li').length === 2 && Boolean(document.querySelector('.desktop-cloud-agent-paste-art'))");
  // The marks are pictures that load as the step appears.
  await waitFor("[...document.querySelectorAll('.desktop-cloud-agent-invite-steps img')].every(image => image.complete)");
  // Test both accessibility modes explicitly, rather than inheriting the runner's macOS preference.
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  const invited = JSON.parse(await evaluate(`JSON.stringify((() => {
    const seat = document.querySelector('.desktop-cloud-agents-dialog [data-cloud-agent-invite-seat]').getBoundingClientRect();
    const steps = document.querySelector('.desktop-cloud-agent-invite-steps').getBoundingClientRect();
    const arrow = parseFloat(getComputedStyle(document.querySelector('.desktop-cloud-agent-invite-steps')).getPropertyValue('--invite-arrow-x'));
    const art = document.querySelector('.desktop-cloud-agent-paste-art');
    const square = art.getBoundingClientRect();
    // A mark with light and dark pictures draws both and shows the one for the theme.
    const shown = [...document.querySelectorAll('.desktop-cloud-agent-invite-logo')]
      .map(logo => [...logo.querySelectorAll('img')].filter(image => getComputedStyle(image).display !== 'none'));
    return { below: steps.top - seat.bottom, aim: steps.left + arrow - (seat.left + seat.width / 2), logos: shown.length,
      drawn: shown.every(images => images.length === 1 && images[0].complete && images[0].naturalWidth > 0),
      square: [square.width, square.height], inert: getComputedStyle(art).pointerEvents,
      looping: art.getAnimations({ subtree: true }).some(animation => animation.effect.getComputedTiming().iterations === Infinity),
      masked: document.querySelector('.desktop-cloud-agent-invite-prompt').textContent.endsWith('••••••')
        && !document.querySelector('.desktop-cloud-agent-invite-prompt').textContent.endsWith('/agent/••••••') };
  })())`));
  assert(invited.below >= 0 && Math.abs(invited.aim) < 2 && invited.logos === 8 && invited.drawn
    && invited.square[0] === invited.square[1] && invited.inert === 'none' && invited.looping && invited.masked,
    `After Copy, the steps must point at the seat, show the masked prompt, every agent mark and a square looping drawing that takes no pointer: ${JSON.stringify(invited)}`);
  // Shown at the drawing's resting beat: the prompt pasted and the agent answering with a tick.
  await evaluate("(() => { for (const animation of document.querySelector('.desktop-cloud-agent-paste-art').getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = 3600; } return true; })()");
  await captureSettledDialog('cloud-agents-invited', '.desktop-cloud-agents-dialog');
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  assert(await evaluate(`(() => {
    const art = document.querySelector('.desktop-cloud-agent-paste-art');
    const opacity = selector => Number(getComputedStyle(art.querySelector(selector)).opacity);
    return matchMedia('(prefers-reduced-motion: reduce)').matches && art.getAnimations({ subtree: true }).length === 0
      && opacity('.desktop-cloud-agent-paste-out') === 1 && opacity('.desktop-cloud-agent-paste-in') === 1
      && opacity('.desktop-cloud-agent-paste-tick') === 1 && opacity('.desktop-cloud-agent-paste-dots') === 0
      && opacity('.desktop-cloud-agent-paste-sheet') === 0 && opacity('.desktop-cloud-agent-paste-key') === 0;
  })()`), 'Reduced motion must show the static completed paste, with no loop, flying sheet or typing dots');
  await captureSettledDialog('cloud-agent-invite-reduced', '.desktop-cloud-agents-dialog');
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
  window.webContents.debugger.detach();
  // An application replaces the invite dialog with the Agent's own persistent decision card below the Header.
  await evaluate("window.__nativeCloudWorkbenchSmoke.setAgentLinks({ pending: [{ id: 'smoke-request', name: 'Research helper', avatar: 'codex', admission: 'sign_in', requested_at: new Date().toISOString(), expires_at: '2099-01-01T00:00:00Z' }, { id: 'smoke-request-two', name: 'Gemini CLI', avatar: 'gemini', admission: 'sign_in', requested_at: new Date().toISOString(), expires_at: '2099-01-01T00:00:00Z' }] })");
  await waitFor("Boolean(document.querySelector('[data-cloud-agent-request-card=smoke-request]')) && !document.querySelector('.desktop-cloud-agents-dialog')");
  assert(await evaluate(`(() => {
    const card = document.querySelector('[data-cloud-agent-request-card]');
    const box = card.getBoundingClientRect();
    const header = document.querySelector('.desktop-titlebar').getBoundingClientRect();
    return box.top >= header.bottom && box.right <= innerWidth && box.left >= 0
      && getComputedStyle(card).pointerEvents === 'auto' && card.querySelectorAll('button').length === 2
      && card.querySelector('[data-reach-brand=codex]') && !card.contains(document.activeElement);
  })()`), 'A request card must appear on its own, use the chosen avatar, take clicks but not steal focus');
  await evaluate("document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true");
  assert(await evaluate("Boolean(document.querySelector('[data-cloud-agent-request-card=smoke-request]')) && !document.querySelector('[data-cloud-agent-request-card] button[aria-label=Close]')"),
    'Outside clicks and Escape must not dismiss an unanswered request');
  for (const theme of ['light', 'dark']) for (const locale of ['en', 'zh-Hans', 'de', 'es', 'fr', 'ja', 'ko', 'pt-BR']) {
    await evaluate(`window.__nativeCloudWorkbenchSmoke.setLoginAppearance('${theme}', '${locale}')`);
    await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await waitFor("[...document.querySelectorAll('[data-cloud-agent-request-card] img')].every(image => image.complete)");
    assert(await evaluate(`(() => {
      const card = document.querySelector('[data-cloud-agent-request-card]');
      const box = card.getBoundingClientRect();
      return box.bottom <= innerHeight && card.scrollWidth <= card.clientWidth
        && [...card.querySelectorAll('button')].every(button => {
          const r = button.getBoundingClientRect(); return r.left >= box.left && r.right <= box.right;
        });
    })()`), `The request card and both decisions must fit in ${theme} ${locale}`);
    await captureSettledDialog(`cloud-agent-request-${theme}-${locale}`, '[data-cloud-agent-request-card]');
  }
  await evaluate("window.__nativeCloudWorkbenchSmoke.setLoginAppearance('dark', 'en')");
  await evaluate("document.querySelector('[data-cloud-agent-request-card] [data-agent-decision=approve]').click()");
  await waitFor("Boolean(document.querySelector('[data-cloud-agent-request-card=smoke-request-two]'))");
  assert(await evaluate("!document.querySelector('.desktop-cloud-agent-request-count') && !document.querySelector('[data-cloud-agent-request-card] button:disabled')"),
    'Answering one request must advance to the next with fresh, enabled choices');
  await evaluate("document.querySelector('[data-cloud-agent-request-card] [data-agent-decision=reject]').click()");
  await waitFor("!document.querySelector('[data-cloud-agent-request-card]')");
  // The normal roster remains available once the request has actually been answered.
  await evaluate("document.querySelector('[data-cloud-workspace-agent=smoke-agent]').click()");
  await waitFor("Boolean(document.querySelector('.desktop-cloud-agents-dialog [data-cloud-agent-row=smoke-request]'))");
  // An invite is spent once it lets an Agent in, and one never used expires: there are no links to look after.
  assert(await evaluate("!document.querySelector('.desktop-cloud-agents-links-toggle, .desktop-cloud-agents-dialog-foot') && !document.querySelector('.desktop-cloud-agents-dialog').textContent.includes('Remove all')"),
    'The Agents dialog must not ask anyone to manage invite links');
  await captureSettledDialog('cloud-agents-joined', '.desktop-cloud-agents-dialog');
  await evaluate("document.querySelector('.desktop-cloud-agents-dialog button[aria-label=Close]').click()");
  await waitFor("!document.querySelector('.desktop-cloud-agents-dialog')");
  // A full roster is a grid: every seat wraps below, including Invite, with no sideways scrolling.
  const gridAgents = ['Claude Code', 'Codex', 'Cursor', 'Gemini CLI', 'Research assistant with a long name',
    '薄肌孙教练', 'OpenCode', 'Hermes', 'Devin', 'GitHub Copilot', 'Analyst'].map((name, index) => ({
    id: index === 0 ? 'smoke-agent' : `grid-${index}`, name, admission: 'sign_in',
    grant_id: index === 0 ? 'smoke-grant' : `grid-grant-${index}`,
    connected_at: '2026-10-30T00:00:00Z', expires_at: '2099-01-01T00:00:00Z',
  }));
  await evaluate(`window.__nativeCloudWorkbenchSmoke.setAgentLinks({ connections: ${JSON.stringify(gridAgents)}, pending: [] })`);
  await waitFor("document.querySelector('.desktop-titlebar-cloud-agent-count')?.textContent === '+7'");
  await evaluate("document.querySelector('[data-cloud-workspace-agent=smoke-agent]').click()");
  await waitFor("document.querySelectorAll('.desktop-cloud-agents-roster > li').length === 12");
  // Translated confirmation actions also wrap inside their own seat, rather than widening its column.
  await evaluate("document.querySelector('[data-cloud-agent-remove=smoke-agent]').click()");
  await evaluate("document.querySelector('.desktop-cloud-agents-dialog [data-cloud-agent-invite-seat]').click()");
  await waitFor("Boolean(document.querySelector('.desktop-cloud-agent-invite-steps'))");
  for (const width of [1100, 480]) {
    window.setContentSize(width, 760);
    await waitFor(`innerWidth === ${width}`);
    for (const theme of ['light', 'dark']) for (const locale of ['en', 'zh-Hans', 'de', 'es', 'fr', 'ja', 'ko', 'pt-BR']) {
      await evaluate(`window.__nativeCloudWorkbenchSmoke.setLoginAppearance('${theme}', '${locale}')`);
      await evaluate("(async () => { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); await document.fonts.ready; })()");
      if (locale === 'en' || locale === 'zh-Hans') await captureSettledDialog(`cloud-agents-grid-${width}-${theme}-${locale}`, '.desktop-cloud-agents-dialog');
      const grid = JSON.parse(await evaluate(`JSON.stringify((() => {
        const roster = document.querySelector('.desktop-cloud-agents-roster');
        const box = roster.getBoundingClientRect();
        const tiles = [...roster.children].map(tile => tile.getBoundingClientRect());
        const seat = roster.querySelector('[data-cloud-agent-invite-seat]').getBoundingClientRect();
        const steps = document.querySelector('.desktop-cloud-agent-invite-steps');
        const arrow = parseFloat(getComputedStyle(steps).getPropertyValue('--invite-arrow-x'));
        const body = document.querySelector('.desktop-cloud-agents-dialog-body');
        const actions = [...roster.querySelectorAll('.desktop-cloud-agent-tile-actions button')];
        return { display: getComputedStyle(roster).display, rows: new Set(tiles.map(tile => Math.round(tile.top))).size,
          overflow: roster.scrollWidth > roster.clientWidth || body.scrollWidth > body.clientWidth,
          inside: tiles.every(tile => tile.left >= box.left - 1 && tile.right <= box.right + 1),
          actionsInside: actions.every(button => { const r = button.getBoundingClientRect();
            const tile = button.closest('.desktop-cloud-agent-tile').getBoundingClientRect();
            return r.left >= tile.left && r.right <= tile.right; }),
          aim: steps.getBoundingClientRect().left + arrow - (seat.left + seat.width / 2),
          inviteLast: roster.lastElementChild.classList.contains('desktop-cloud-agent-invite-seat') };
      })())`));
      assert(grid.display === 'grid' && grid.rows >= 3 && !grid.overflow && grid.inside && grid.actionsInside
        && Math.abs(grid.aim) < 2 && grid.inviteLast,
      `Agents and their actions must wrap in ${width}px ${theme} ${locale}, with the invite still aimed at its seat: ${JSON.stringify(grid)}`);
    }
  }
  window.setContentSize(1100, 760);
  await waitFor('innerWidth === 1100');
  await evaluate("window.__nativeCloudWorkbenchSmoke.setLoginAppearance('dark', 'en')");
  await evaluate("document.querySelector('.desktop-cloud-agents-dialog button[aria-label=Close]').click()");
  await waitFor("!document.querySelector('.desktop-cloud-agents-dialog')");
  // With nobody here yet, the empty seat opens the same dialog, and inviting the first agent is all of it.
  await evaluate("window.__nativeCloudWorkbenchSmoke.setAgentLinks({ connections: [], pending: [] })");
  await waitFor("Boolean(document.querySelector('[data-cloud-workspace-tool=invite-agent]:not(:disabled)'))");
  await evaluate("document.querySelector('[data-cloud-workspace-tool=invite-agent]').click()");
  await waitFor("Boolean(document.querySelector('.desktop-cloud-agents-dialog .desktop-cloud-agents-first'))");
  assert(await evaluate("document.activeElement === document.querySelector('.desktop-cloud-agent-invite-steps .desktop-cloud-agent-share-copy') && document.querySelectorAll('.desktop-cloud-agent-invite-steps li').length === 1"),
    'With nobody here yet, Copy must be the first thing in reach');
  await captureSettledDialog('cloud-agents-empty', '.desktop-cloud-agents-dialog');
  await evaluate("document.querySelector('.desktop-cloud-agents-dialog button[aria-label=Close]').click()");
  await waitFor("!document.querySelector('.desktop-cloud-agents-dialog')");
  // The fixture's own Agent comes back, as the steps after this expect.
  await evaluate("window.__nativeCloudWorkbenchSmoke.setAgentLinks({ connections: [{ id: 'smoke-agent', name: 'Claude Code', admission: 'sign_in', grant_id: 'smoke-grant', connected_at: '2026-10-30T00:00:00Z', expires_at: '2099-01-01T00:00:00Z' }], pending: [] })");
  await waitFor("Boolean(document.querySelector('.desktop-titlebar-cloud-agents [data-cloud-workspace-agent]'))");
  // History's renderer/controller contract is independent of a Header menu
  // entry. This harness does not include the contextual navigation owner.
  await evaluate("window.__nativeCloudWorkbenchSmoke.openHistory()");
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
      assert(await evaluate(location === 'cloud' ? cloudTools : "document.querySelectorAll('[data-cloud-workspace-tool]').length === 0"),
        'Cloud CTAs must follow the active environment in both themes and widths');
      if (location === 'cloud') assert(await evaluate(`(() => {
        const project = document.querySelector('.desktop-titlebar-context').getBoundingClientRect();
        return [...document.querySelectorAll('[data-cloud-workspace-tool]')].every(button => {
          const r = button.getBoundingClientRect();
          return r.x >= project.right && r.right <= innerWidth && r.y >= 0 && r.bottom <= 40;
        });
      })()`), 'Cloud CTAs must fit beside the project without overlapping it');
      sample.pixels = await windowFramePixels(sample);
      if (nativeCorners && location === 'cloud') {
        await captureNativeCorners(`${theme}-${width}`,sample);
        // Exercise the production event consumer without changing the user's macOS Space.
        window.webContents.send('window-layout:chrome-state-changed', {fullScreen:true});
        await waitFor("document.querySelector('.desktop-titlebar').dataset.windowFullScreen === 'true'");
        window.webContents.send('window-layout:chrome-state-changed', {fullScreen:false});
        await waitFor("document.querySelector('.desktop-titlebar').dataset.windowFullScreen !== 'true'");
      }
      if (before) for (const key of ["x", "y", "width", "height", "projectLeft"]) {
        assert(Math.abs(sample[key] - before[key]) < 0.01, `Header ${key} moved on ${theme} ${width}px switch`);
      }
      if (before) assert(JSON.stringify(sample.controlPalette) === JSON.stringify(before.controlPalette),
        `Header text and interaction colors must stay in the ${theme} theme when switching locations`);
      if (before) assert(JSON.stringify(sample.background) === JSON.stringify(before.background),
        `The Header must keep one theme color across places in ${theme}: ${JSON.stringify(sample.background)}`);
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
    for (const location of ['local', 'cloud']) {
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
      assert(leading.projectGap >= leading.expectedGap - 0.1,
        `Expand and project controls must keep their gap in ${location}, ${theme}, ${width}px: ${JSON.stringify(leading)}`);
      if (location === 'cloud') {
        await writeFile(path.join(artifacts, `header-leading-${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG());
      }
      await evaluate("document.querySelector('.desktop-titlebar-sidebar-expand').click()");
      await waitFor("!document.querySelector('.desktop-titlebar-sidebar-expand')");
    }
  }
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features:[{name:'prefers-reduced-motion',value:'reduce'}],
  });
  await selectLocation("cloud");
  assert(await evaluate("document.querySelector('.desktop-titlebar').dataset.workspaceKind === 'cloud' && !document.querySelector('.desktop-cloud-header-reveal, .desktop-cloud-entry-light, .desktop-cloud-entry-sweep')"),
    "Reduced motion must state the Cloud immediately without decorative motion");
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
      const content = dialog.querySelector('.desktop-cloud-publish-dialog-content');
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
      && ![...notice.querySelectorAll('button')].some(button => /Open Cloud project|Reconnect/.test(button.textContent))
      && [...notice.querySelectorAll('button')].some(button => button.textContent === 'Disconnect');
  })()`), 'Another environment must be explained, offering only to end the link');
  assert(await evaluate("document.querySelector('.desktop-titlebar-place-button').dataset.cloudLink === 'problem'"),
    'The Header must mark a link that cannot be used from here');
  await evaluate("window.__nativeCloudWorkbenchSmoke.requestCloud()");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  assert(await evaluate("!document.querySelector('.desktop-cloud-dialog, [role=dialog]') && Boolean(document.querySelector('.desktop-local-folder-cloud-notice.is-other-environment'))")
    && (await state()).location === 'local', 'Asking for a Cloud project in another environment must explain, never block the folder');
  for (const theme of ['light', 'dark']) {
    await evaluate(`window.__nativeCloudWorkbenchSmoke.setLoginAppearance('${theme}', 'en')`);
    await evaluate("Promise.all(document.querySelector('.desktop-local-folder-cloud-notice').getAnimations({subtree:true}).map(animation => animation.finished.catch(() => {})))");
    await writeFile(path.join(artifacts, `other-environment-${theme}.png`), (await window.webContents.capturePage()).toPNG());
  }
  // A folder whose Cloud project disappeared ends its link from the notice.
  await evaluate("window.__nativeCloudWorkbenchSmoke.setRepositoryWrongHost(false)");
  await evaluate("window.__nativeCloudWorkbenchSmoke.setRepositoryMissing(true)");
  await waitFor("Boolean(document.querySelector('.desktop-local-folder-cloud-notice.is-missing'))");
  assert((await state()).detachRequests.length === 0, 'A missing Cloud project must not automatically detach the Git connection');
  for (const theme of ['light', 'dark']) {
    await evaluate(`window.__nativeCloudWorkbenchSmoke.setLoginAppearance('${theme}', 'en')`);
    await evaluate("Promise.all(document.querySelector('.desktop-local-folder-cloud-notice').getAnimations({subtree:true}).map(animation => animation.finished.catch(() => {})))");
    await writeFile(path.join(artifacts, `missing-project-${theme}.png`), (await window.webContents.capturePage()).toPNG());
  }
  await clickNoticeAction('Disconnect');
  await captureSettledDialog('disconnect-confirmation', '.desktop-cloud-disconnect-dialog');
  assert(await evaluate("document.querySelector('.desktop-cloud-disconnect-dialog').textContent.includes('The Cloud project isn’t deleted') && document.querySelector('.desktop-cloud-disconnect-dialog').textContent.includes('2 commits haven’t been sent')"),
    'The confirmation must say the Cloud project stays and which commits will not be sent');
  assert((await state()).detachRequests.length === 0, 'Confirmation must precede ending the link');
  await evaluate("[...document.querySelectorAll('.desktop-cloud-disconnect-dialog button')].find(button => button.textContent === 'Cancel').click()");
  await waitFor("!document.querySelector('.desktop-cloud-disconnect-dialog')");
  assert((await state()).detachRequests.length === 0, 'Cancelling must keep the link');
  assert(await evaluate("document.querySelector('.desktop-titlebar-place-button').dataset.cloudLink === 'problem'"),
    'The Header must mark the unavailable link while the notice owns Disconnect');
  await clickNoticeAction('Disconnect');
  await waitFor("Boolean(document.querySelector('.desktop-cloud-disconnect-dialog'))");
  await evaluate("document.querySelector('.desktop-cloud-disconnect-dialog .desktop-dialog-button.destructive').click()");
  await waitFor("!document.querySelector('.desktop-cloud-disconnect-dialog') && !document.querySelector('.desktop-local-folder-cloud-notice')");
  assert((await state()).detachRequests.length === 1 && (await state()).detachRequests[0].join(',') === 'puppyone',
    'Ending the link must detach exactly the reviewed Cloud connection');
  assert((await state()).publishRequests.length === 1, 'Ending the link must never put the folder in the Cloud by itself');
  assert(await evaluate("!document.querySelector('.desktop-titlebar-place-button').dataset.cloudLink && !document.querySelector('.desktop-titlebar-place-link')"),
    'An unlinked folder carries no Cloud mark');
  // Afterwards the folder is an ordinary local project that can be put in the Cloud again.
  await evaluate("window.__nativeCloudWorkbenchSmoke.requestCloud()");
  await waitFor("Boolean(document.querySelector('.desktop-cloud-dialog [data-cloud-publish-action]'))");
  assert((await state()).publishRequests.length === 1,
    'Putting the folder in the Cloud again must start with explicit organization-scoped publication, never uploading automatically');
  await captureSettledDialog('after-disconnect-ready-to-publish', '.desktop-cloud-dialog');
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await waitFor("!document.querySelector('.desktop-cloud-dialog')");
  assert((await state()).location === 'local', 'The folder stays open throughout');
  await evaluate("window.__nativeCloudWorkbenchSmoke.finishLocalSaves()");
  snapshot = await state();
  assert(!errors.length, `Renderer errors: ${errors.join("; ")}`);
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify({ passed: true, electronVersion:process.versions.electron, pdfRuntimeDiagnostics, localHost, localPresentation, cloudPresentation, headerPresentations,  nativeCornerCaptures, authGeometry, loginPresentations, publishPresentations, snapshot, errors }, null, 2));
  console.log("Native Cloud workbench smoke passed: a local folder and its Cloud project as two projects in one retained shell, identical native layout/styles, Cloud tree/data/edit/save, folder notices, Cloud dialog sign-in across themes and eight locales, first publish, other-environment and missing-project folders and ending their Cloud links from the notice, isolated drafts and retained hosts.");
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
