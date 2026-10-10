#!/usr/bin/env electron
import { app, BrowserWindow, ipcMain, nativeImage, protocol, utilityProcess } from "electron";
import { cloudFormatFixtures, acceptCloudFormats, acceptExpiredCloudMedia } from "../../../support/cloud/formatAcceptance.mjs";
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
let resourceToken = 'fixture-token';
let deniedResourceRequests = 0;
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
  await evaluate("Promise.all([...document.querySelectorAll('.desktop-titlebar-workspace-button, .desktop-titlebar-location-button')].flatMap(button => button.getAnimations()).map(animation => animation.finished.catch(() => {})))");
  await evaluate("Promise.all((document.querySelector('.desktop-cloud-header-reveal')?.getAnimations({subtree:true}) ?? []).map(animation => animation.finished.catch(() => {})))");
  const sample = await evaluate(`(() => {
    const header = document.querySelector('.desktop-titlebar');
    const context = header.querySelector('.desktop-titlebar-centered-context');
    const button = context.querySelector('.desktop-titlebar-location-button');
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
    probe.style.color = 'var(--po-cloud-header-bg)';
    const cloudBackground = getComputedStyle(probe).color;
    probe.style.color = 'var(--po-text)';
    const themeText = getComputedStyle(probe).color;
    probe.style.color = button.matches(':hover') || button.getAttribute('aria-expanded') === 'true'
      ? 'var(--desktop-titlebar-text)' : 'var(--desktop-titlebar-text-muted)';
    const expectedButtonColor = getComputedStyle(probe).color;
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
      cloudBackground:rgb(cloudBackground), themeText:rgb(themeText),
      backgroundImage:css.backgroundImage,
      icon:{ location:mark.dataset.projectLocation, name:svg.dataset.cloudIcon ?? null,
        color:rgb(getComputedStyle(mark).color),
        paint:rgb(outline ? getComputedStyle(outline).fill : getComputedStyle(svg).stroke),
        accessibleLabel:button.getAttribute('aria-label') },
      labelColor:rgb(getComputedStyle(button.lastElementChild).color),
      buttonColor:rgb(getComputedStyle(button).color),
      expectedButtonColor:rgb(expectedButtonColor),
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
  assert(JSON.stringify(sample.buttonColor) === JSON.stringify(sample.expectedButtonColor), 'Location control ink must follow the current theme and interaction state');
  assert(sample.backgroundImage === 'none', 'The previous gradient must be removed');
  const expectedIcon = sample.buttonColor;
  assert(JSON.stringify(sample.icon.color) === JSON.stringify(sample.labelColor), 'Cloud and device marks must match their location label, open or closed');
  assert(sample.icon.location === location && JSON.stringify(sample.icon.color) === JSON.stringify(expectedIcon)
    && JSON.stringify(sample.icon.paint) === JSON.stringify(expectedIcon), 'Location icons must share readable Header ink');
  assert(JSON.stringify(sample.accent) === '[69,153,223]', 'Brand blue is the approved #4599DF in both themes, not adaptive accent/info');
  assert(sample.icon.name === (location === 'cloud' ? 'ant-design' : null), 'Use the approved Cloud outline only for the committed Cloud provider');
  assert(JSON.stringify(sample.labelColor) === JSON.stringify(sample.buttonColor), 'Blue icon must not recolor the location label');
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
  assert(sample.iconContrast >= 3, `Location icon needs 3:1 contrast: ${sample.iconContrast}`);
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
  const opening = !await evaluate("Boolean(document.querySelector('.desktop-project-location-menu'))");
  if (opening) {
    const frames = await evaluate(`new Promise(resolve => {
      const samples = [];
      document.querySelector('.desktop-titlebar-location-button').click();
      const sample = () => {
        const menu = document.querySelector('.desktop-project-location-menu');
        if (menu && getComputedStyle(menu).visibility !== 'hidden') {
          const track = menu.querySelector('.desktop-project-location-tabs');
          const plate = track.querySelector('.desktop-project-location-indicator');
          const selected = track.querySelector('button[aria-pressed=true]');
          const a = plate.getBoundingClientRect(), b = selected.getBoundingClientRect(), m = menu.getBoundingClientRect();
          samples.push({x:m.x,y:m.y,width:m.width,height:m.height,offset:Math.abs(a.x-b.x),plateWidth:Math.abs(a.width-b.width),animations:plate.getAnimations().length});
        }
        if (samples.length < 24) requestAnimationFrame(sample); else resolve(samples);
      };
      requestAnimationFrame(sample);
    })`);
    assert(frames.every(frame => frame.offset < 1 && frame.plateWidth < 1 && frame.animations === 0),
      `Opening must keep the slider aligned on every visible frame: ${JSON.stringify(frames)}`);
    assert(frames.every(frame => ['x','y','width','height'].every(key => Math.abs(frame[key]-frames[0][key]) < 1)),
      `Opening must not expand or collapse the project bar: ${JSON.stringify(frames)}`);
  }
  await waitFor("Boolean(document.querySelector('.desktop-project-location-menu'))");
  assert(await evaluate("getComputedStyle(document.querySelector('.desktop-project-location-menu')).outlineStyle === 'none' && !document.querySelector('.desktop-project-repository-link')"),
    'The project popover must have no outer focus outline or GitHub shortcut');
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  if (opening) {
    const plate = await evaluate(`(() => {
      const track = document.querySelector('.desktop-project-location-tabs');
      const plate = track.querySelector('.desktop-project-location-indicator');
      const selected = track.querySelector('button[aria-pressed=true]');
      const a = plate.getBoundingClientRect(), b = selected.getBoundingClientRect();
      return {animations:plate.getAnimations().length, offset:Math.abs(a.x-b.x), width:Math.abs(a.width-b.width)};
    })()`);
    assert(plate.animations === 0 && plate.offset < 1 && plate.width < 1,
      `Opening the project bar must place the slider at its current selection without sliding: ${JSON.stringify(plate)}`);
  }
}
async function selectLocation(location) {
  await openProjectMenu();
  await waitFor(`Boolean(document.querySelector('button[data-project-location="${location}"]'))`);
  await evaluate(`document.querySelector('button[data-project-location="${location}"]').click()`);
  await waitFor(`window.__nativeCloudWorkbenchSmoke.state().location === '${location}'`);
  assert(await evaluate("Boolean(document.querySelector('[data-titlebar-context-menu]'))"), "Project switch bar must remain open after switching");
}
async function checkProjectBarRelayout(setup) {
  const frames = await evaluate(`new Promise(resolve => {
    const menu = document.querySelector('.desktop-project-location-menu');
    ${setup}
    const frames = [];
    const sample = () => {
      const plate = menu.querySelector('.desktop-project-location-indicator');
      const button = menu.querySelector('button[aria-pressed=true]');
      const a = plate.getBoundingClientRect(), b = button.getBoundingClientRect();
      frames.push({offset:Math.abs(a.x-b.x),width:Math.abs(a.width-b.width),animations:plate.getAnimations().length});
      if (frames.length < 24) requestAnimationFrame(sample); else resolve(frames);
    };
    requestAnimationFrame(sample);
  })`);
  assert(frames.every(frame => frame.offset < 1 && frame.width < 1 && frame.animations === 0),
    `Font/layout changes must not stretch or slide the selection plate: ${JSON.stringify(frames)}`);
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
  // Isolated test transport: production viewers consume real HTTPS resources,
  // without reaching a network, account or user repository.
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Cloud report", "Value"], ["Verified", 42]]), "Cloud");
  const spreadsheet = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  await window.webContents.session.protocol.handle("https", (request) => {
    const url = new URL(request.url);
    if (url.host !== "cloud-fixture.puppyone.ai" || url.pathname !== "/api/v1/content/11111111-1111-4111-8111-111111111111/inline"
      ) return new Response(null, { status: 404 });
    if (url.searchParams.get('token') !== resourceToken) {
      if (expectedResourceFailure && url.searchParams.get('path') === 'acceptance/navy.mp4') deniedResourceRequests++;
      return new Response(null,{status:403});
    }
    const path = url.searchParams.get("path");
    const resource = formats.resources.get(path);
    if (resource) {
      const headers = { 'Content-Type':resource.mimeType, 'Access-Control-Allow-Origin':'*', 'Accept-Ranges':'bytes', 'Cache-Control':'no-store' };
      if (path.endsWith('.pdf') && request.method==='HEAD') return new Response(null,{status:405,headers});
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('Range') ?? '');
      if (range) {
        const start=Number(range[1]), end=Math.min(Number(range[2] || resource.bytes.length-1),resource.bytes.length-1);
        if (start > end) return new Response(null,{status:416});
        const body=resource.bytes.subarray(start,end+1);
        return new Response(body,{status:206,headers:{...headers,'Content-Length':String(body.length),'Content-Range':`bytes ${start}-${end}/${resource.bytes.length}`}});
      }
      return new Response(request.method==='HEAD'?null:resource.bytes,{headers:{...headers,'Content-Length':String(resource.bytes.length)}});
    }
    const body = path === "assets/diagram.svg"
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120"><rect width="300" height="120" rx="12" fill="#102a43"/><text x="24" y="68" fill="#e3f0fb" font-family="sans-serif" font-size="24">Cloud asset</text></svg>'
      : path === "report.xlsx" ? spreadsheet : null;
    return body ? new Response(body, { headers: { "Access-Control-Allow-Origin": "*",
      "Content-Type": path.endsWith(".svg") ? "image/svg+xml" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } })
      : new Response(null, { status: 404 });
  });
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
    if (expectedResourceFailure && /Failed to load resource:.*403/.test(event.message)) handledResourceErrors.push(event.message);
    else errors.push(event.message);
  });
  await window.loadURL(`${pathToFileURL(rendererPath).href}#native-cloud-workbench-smoke`);
  await waitFor("Boolean(window.__nativeCloudWorkbenchSmoke && document.querySelector('[data-workspace-location=local] .cm-content')?.textContent.includes('LOCAL_FILE_BODY'))");
  // Visible compositing is required for captures of the paused Header reveal;
  // hidden-window capturePage can return the previous provider's frame.
  window.showInactive();
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
  assert(await evaluate("Boolean(document.querySelector('.desktop-titlebar-terminal')) && Boolean(document.querySelector('.desktop-titlebar-changes'))"),
    'Local must expose its Chat and Git Header actions before switching');
  await evaluate("window.__nativeCloudWorkbenchSmoke.holdCloudRead()");
  await openProjectMenu();
  await checkProjectBarRelayout("menu.style.setProperty('--po-type-ui-control', '19px');");
  await checkProjectBarRelayout("menu.style.removeProperty('--po-type-ui-control');");
  const pendingMenu = await evaluate(`(() => {
    const menu = document.querySelector('.desktop-project-location-menu');
    menu.dataset.fixtureIdentity = 'retained-switch-bar';
    const r = menu.getBoundingClientRect();
    return {x:r.x,y:r.y,width:r.width,height:r.height};
  })()`);
  await evaluate("document.querySelector('button[data-project-location=cloud]').click()");
  await waitFor("document.querySelector('.desktop-project-location-tabs').getAttribute('aria-busy') === 'true'");
  await waitFor("document.querySelector('.desktop-project-location-indicator').getAnimations().some(animation => animation.transitionProperty === 'transform')");
  assert(await evaluate("window.__nativeCloudWorkbenchSmoke.state().location === 'local' && document.querySelector('button[data-project-location=cloud]').getAttribute('aria-pressed') === 'true' && Boolean(document.querySelector('.desktop-cloud-preparation'))"),
    "Selection must move immediately while provider preparation continues in the background");
  assert(await evaluate(`(() => {
    const header = document.querySelector('.desktop-titlebar');
    const reveal = header.querySelector('.desktop-cloud-header-reveal');
    reveal.dataset.fixtureIdentity = 'requested-header-reveal';
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
  })()`), 'Header blue must expand from its lower-right center over 260ms while Cloud prepares');
  assert(await evaluate("Boolean(document.querySelector('.desktop-titlebar-workspace-mark[data-project-location=cloud]')) && !document.querySelector('.desktop-titlebar-terminal:not([data-cloud-workspace-tool]), .desktop-titlebar-changes')"),
    'Cloud intent must change the Header mark and remove local actions before provider commit');
  assert(await evaluate("document.querySelectorAll('[data-cloud-workspace-tool]').length === 3 && [...document.querySelectorAll('[data-cloud-workspace-tool]')].every(button => button.disabled)"),
    'All three Cloud tools must appear immediately and await the authorized provider commit');
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await writeFile(path.join(artifacts, 'cloud-header-switch.png'), (await window.webContents.capturePage()).toPNG());
  await evaluate("Promise.all(document.querySelector('.desktop-project-location-indicator').getAnimations().map(animation => animation.finished.catch(() => {})))");
  await new Promise(resolve => setTimeout(resolve, 100));
  await writeFile(path.join(artifacts, 'cloud-switch-loading.png'), (await window.webContents.capturePage()).toPNG());
  for (const theme of ['light', 'dark']) {
    await evaluate(`window.__nativeCloudWorkbenchSmoke.setLoginAppearance('${theme}', 'en')`);
    for (const width of [640, 1100]) {
      window.setSize(width, 760);
      await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
      const loadingLayout = await evaluate(`(() => {
        const rail = document.querySelector('.desktop-cloud-preparation-rail');
        const tree = document.querySelector('[data-workspace-location=local] .explorer-tree-shell');
        const css = getComputedStyle(tree), bounds = rail.getBoundingClientRect();
        const number = name => parseFloat(css.getPropertyValue(name));
        const rows = [...rail.querySelectorAll('.explorer-tree-skeleton-row')].map(row => {
          const r = row.getBoundingClientRect();
          const icon = row.querySelector('.explorer-tree-skeleton-icon').getBoundingClientRect();
          const label = row.querySelector('.explorer-tree-skeleton-label').getBoundingClientRect();
          return { x:icon.x-bounds.x, y:r.y-bounds.y, height:r.height, gap:label.x-icon.right };
        });
        return { rows, height:number('--tree-row-height'), indent:number('--tree-row-indent'),
          inset:number('--tree-row-left-gap')+number('--tree-row-content-left'),
          top:number('--tree-no-root-top-gap'), gap:number('--tree-row-icon-label-gap') };
      })()`);
      assert(loadingLayout.rows.length === 6 && loadingLayout.rows.every((row, index) =>
        Math.abs(row.height-loadingLayout.height) < 1 && Math.abs(row.gap-loadingLayout.gap) < 1
        && Math.abs(row.y-(loadingLayout.top+index*(loadingLayout.height+2))) < 1
        && Math.abs(row.x-(loadingLayout.inset+([0,1,1,0,1,1][index])*loadingLayout.indent)) < 1),
      `Pending Cloud skeleton must preserve file-tree geometry (${theme}/${width}): ${JSON.stringify(loadingLayout)}`);
      await writeFile(path.join(artifacts, `cloud-loading-${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG());
    }
  }
  await evaluate("window.__nativeCloudWorkbenchSmoke.finishCloudRead()");
  await waitFor("window.__nativeCloudWorkbenchSmoke.state().location === 'cloud'");
  assert(await evaluate("document.querySelector('.desktop-cloud-header-reveal').dataset.fixtureIdentity === 'requested-header-reveal' && document.querySelector('.desktop-cloud-header-reveal').getAnimations({subtree:true}).every(animation => animation.playState === 'paused')"),
    'Provider commit must retain the same ongoing Header reveal');
  assert(await evaluate("!document.querySelector('.desktop-cloud-preparation, .desktop-cloud-entry-light, .desktop-cloud-entry-sweep') && !document.querySelector('[data-workspace-location=cloud]').hidden"),
    'Ready Cloud content must appear immediately even while the Header animation is paused');
  await evaluate("document.querySelector('.desktop-cloud-header-reveal').getAnimations({subtree:true})[0].finish()");
  const readyMenu = await evaluate(`(() => {
    const menu = document.querySelector('.desktop-project-location-menu');
    const r = menu.getBoundingClientRect();
    return {identity:menu.dataset.fixtureIdentity,x:r.x,y:r.y,width:r.width,height:r.height};
  })()`);
  assert(readyMenu.identity === 'retained-switch-bar' && ['x','y','width','height'].every(key => Math.abs(readyMenu[key]-pendingMenu[key])<1),
    'The same switch bar must keep its position and dimensions after Cloud loads');
  await waitFor("Boolean(document.querySelector('[data-cloud-native=true]')?.textContent.includes('cloud-only'))");
  const initialCloudRequests = (await state()).requests;
  assert(initialCloudRequests.filter(path => path === '/content/11111111-1111-4111-8111-111111111111/ls?path=').length === 1,
    'Preflight and the mounted explorer must share one root directory read');
  assert(!initialCloudRequests.some(path => path.includes('/cat?')),
    'Opening a Cloud project must not download unopened file bodies for a Markdown index');
  assert(await evaluate("document.querySelector('[data-workspace-location=local]').hidden && !document.querySelector('[data-workspace-location=cloud]').hidden && !document.querySelector('.desktop-cloud-workspace-switch-dialog')"), "Cloud switch must replace the main surface without a dialog");
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
  const openedFileRequests = (await state()).requests.slice(initialCloudRequests.length)
    .filter(path => path.startsWith('/content/'));
  assert(JSON.stringify(openedFileRequests) === JSON.stringify(['/content/11111111-1111-4111-8111-111111111111/cat?path=readme.txt']),
    `Opening known text from the explorer must make one cat request: ${JSON.stringify(openedFileRequests)}`);
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
  assert(await evaluate("document.querySelector('[data-workspace-location=cloud] .cm-content').textContent.includes('CLOUD_EDIT_ONLY')"), "Returning to Cloud must retain its own document content");
  await evaluate("window.__nativeCloudWorkbenchSmoke.holdCloudRead(); [...document.querySelectorAll('[data-cloud-native=true] .tree-row')].find(row => row.textContent.includes('cloud-only')).click()");
  await waitFor("Boolean(document.querySelector('[data-cloud-native=true] .document-surface-preparation-pending [data-puppy-loader]'))");
  assert(await evaluate("document.querySelector('[data-cloud-native=true] .tree-row[aria-selected=true]').textContent.includes('cloud-only') && Boolean(document.querySelector('[data-cloud-native=true] .document-surface-slot.is-obscured[aria-hidden=true]'))"),
    'Cloud file selection must update immediately and replace the previous content with normal loading before the read finishes');
  await writeFile(path.join(artifacts, 'cloud-file-loading.png'), (await window.webContents.capturePage()).toPNG());
  await evaluate("[...document.querySelectorAll('[data-cloud-native=true] .tree-row')].find(row => row.textContent.includes('readme')).click(); window.__nativeCloudWorkbenchSmoke.finishCloudRead()");
  await waitFor("window.__nativeCloudWorkbenchSmoke.state().requests.some(path => path.includes('/cat?path=cloud-only.md'))");
  await waitFor("!document.querySelector('[data-cloud-native=true] .document-surface-preparation-pending') && document.querySelector('[data-cloud-native=true] .cm-content').textContent.includes('CLOUD_EDIT_ONLY')");
  assert(await evaluate("document.querySelector('[data-cloud-native=true] .tree-row[aria-selected=true]').textContent.includes('readme')"),
    'A late Cloud file read must not replace a newer file selection or its retained draft');
  const folderReads = () => evaluate("window.__nativeCloudWorkbenchSmoke.state().requests.filter(path => path.includes('/ls?path=records')).length");
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
  await evaluate("window.__nativeCloudWorkbenchSmoke.edit('cloud', '# Cloud note updated\\n\\n![Cloud diagram](/assets/diagram.svg)')");
  await waitFor("window.__nativeCloudWorkbenchSmoke.state().cloudWrites.some(write => write.path === 'notes.md' && write.content.includes('Cloud note updated'))");
  await openCloudFile("settings");
  await waitFor("document.querySelector('[data-cloud-native=true] .document-surface-slot.is-committed:not(.is-obscured) .cm-content')?.textContent.includes('cloud')");
  await evaluate(`window.__nativeCloudWorkbenchSmoke.edit('cloud', '{"cloud":true,"saved":true}')`);
  await waitFor("window.__nativeCloudWorkbenchSmoke.state().cloudWrites.some(write => write.path === 'settings.json' && write.content.includes('saved'))");
  await openCloudFile("page");
  await waitFor("Boolean(document.querySelector('[data-cloud-native=true] .document-surface-slot.is-committed:not(.is-obscured) .html-document-editor iframe[aria-busy=false]'))");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await writeFile(path.join(artifacts, "cloud-html.png"), (await window.webContents.capturePage()).toPNG());
  await evaluate("document.querySelector('[data-cloud-native=true] .desktop-editor-pane-handle').click()");
  await waitFor("Boolean([...document.querySelectorAll('.desktop-editor-pane-menu button')].find(button => button.textContent === 'Show code'))");
  await evaluate("[...document.querySelectorAll('.desktop-editor-pane-menu button')].find(button => button.textContent === 'Show code').click()");
  await waitFor("Boolean(document.querySelector('[data-cloud-native=true] .document-surface-slot.is-committed:not(.is-obscured) .html-document-editor .cm-editor'))");
  await evaluate("window.__nativeCloudWorkbenchSmoke.edit('cloud', '<!doctype html><h1>Cloud HTML saved</h1>')");
  await waitFor("window.__nativeCloudWorkbenchSmoke.state().cloudWrites.some(write => write.path === 'page.html' && write.content.includes('Cloud HTML saved'))");
  await openCloudFile("report");
  await waitFor("Boolean(document.querySelector('[data-cloud-native=true] .document-surface-slot.is-committed[data-surface-ready=true] .office-spreadsheet-preview'))");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await writeFile(path.join(artifacts, "cloud-office.png"), (await window.webContents.capturePage()).toPNG());
  const formatAcceptance = await acceptCloudFormats({window, evaluate, waitFor, fixtures:formats, artifacts, assert});
  expectedResourceFailure=true;
  formatAcceptance.expiry = await acceptExpiredCloudMedia({evaluate,waitFor,assert,expire:(token)=>{resourceToken=token;}});
  expectedResourceFailure=false;
  assert(deniedResourceRequests > 0, 'Expiry test must perform a real rejected old-token request');
  await writeFile(path.join(artifacts,'cloud-format-acceptance.json'),JSON.stringify({...formatAcceptance,deniedResourceRequests,handledResourceErrors},null,2));
  await nativePreviews.closeAll();
  await evaluate("window.__nativeCloudWorkbenchSmoke.openCloudFile('readme.txt')");
  await waitFor("document.querySelector('[data-cloud-native=true] .cm-content')?.textContent.includes('CLOUD_EDIT_ONLY')");
  if (filesOnly) {
    assert(!errors.length, `Renderer errors: ${errors.join('; ')}`);
    await evaluate("window.__nativeCloudWorkbenchSmoke.finishLocalSaves()");
    await writeFile(path.join(artifacts, 'file-operations-report.json'), JSON.stringify({
      passed: true, scope: 'Cloud file operations and format previews',
      rootReadsAtEntry: initialCloudRequests.filter(path => path === '/content/11111111-1111-4111-8111-111111111111/ls?path=').length,
      openedFileRequests, snapshot: await state(), errors,
    }, null, 2));
    console.log('Cloud file operations Electron acceptance passed: shared directory reads, one-request text open, edits, drafts, and format previews.');
    window.destroy(); app.exit(0); return;
  }
  assert(await evaluate("[...document.querySelectorAll('[data-cloud-workspace-tool]')].every(button => !button.disabled) && !window.__nativeCloudWorkbenchSmoke.state().requests.some(path => path.includes('/mcp-endpoints') || path.includes('/synchronize'))"),
    'Cloud tool pages must load only when the user opens a ready CTA');
  assert(await evaluate("!document.querySelector('[data-cloud-workspace-tool=automation], [data-cloud-workspace-tool=connect]')"),
    'Cloud Header exposes Share, History and Agent');
  const beforeSharing = (await state()).requests.length;
  await evaluate("document.querySelector('[data-cloud-workspace-tool=share]').click()");
  await waitFor("Boolean(document.querySelector('.desktop-cloud-workspace-share input'))");
  assert(await evaluate("document.querySelector('.desktop-cloud-workspace-share input').value.endsWith('/11111111-1111-4111-8111-111111111111/')"),
    'Workspace sharing must expose its canonical human URL');
  assert((await state()).requests.length === beforeSharing, 'Sharing a URL must not issue Cloud API requests');
  await captureSettledDialog('cloud-share', '.desktop-cloud-workspace-share');
  await evaluate("document.querySelector('.desktop-cloud-workspace-share .desktop-dialog-icon-button').click()");
  await evaluate("document.querySelector('[data-cloud-workspace-tool=history]').click()");
  await waitFor("document.querySelector('.desktop-cloud-workspace-history')?.textContent.includes('Update research notes')");
  const beforeDetail = (await state()).requests.length;
  await evaluate("document.querySelector('.desktop-cloud-workspace-history .desktop-history-row').click()");
  await waitFor("Boolean(document.querySelector('.desktop-cloud-workspace-history .desktop-commit-detail'))");
  assert((await state()).requests.length === beforeDetail, 'Commit details must reuse the history response');
  await writeFile(path.join(artifacts, 'cloud-history.png'), (await window.webContents.capturePage()).toPNG());
  await evaluate("document.querySelector('.desktop-cloud-workspace-history button[aria-label=Close]').click()");
  for (const width of [1100, 640]) for (const theme of ["light", "dark"]) {
    window.setContentSize(width, 760);
    await waitFor(`innerWidth === ${width}`);
    await evaluate(`window.__nativeCloudWorkbenchSmoke.setLoginAppearance('${theme}', 'en')`);
    let before;
    for (const [index, location] of ["local", "cloud", "local"].entries()) {
      if ((await state()).location !== location) await selectLocation(location);
      if (location === "cloud") await captureCloudReady(`${theme}-${width}`);
      const sample = await headerPresentation(location);
      assert(await evaluate(`document.querySelectorAll('[data-cloud-workspace-tool]').length === ${location === 'cloud' ? 3 : 0}`),
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
        await waitFor("Boolean(document.querySelector('button[data-project-location=cloud]'))");
        await evaluate("Promise.all(document.querySelector('.desktop-project-location-indicator').getAnimations().map(animation => animation.finished.catch(() => {})))");
        assert(await evaluate(`(() => {
          const track = document.querySelector('.desktop-project-location-tabs');
          const indicator = track.querySelector('.desktop-project-location-indicator').getBoundingClientRect();
          const selected = track.querySelector('button[aria-pressed=true]').getBoundingClientRect();
          return Math.abs(indicator.x-selected.x)<1 && Math.abs(indicator.width-selected.width)<1;
        })()`), 'Sliding indicator must align with the selected translated button');
        headerPresentations.push({ theme, width, expanded:true, ...await headerPresentation(location) });
        await evaluate("document.querySelector('button[data-project-location=cloud]').click()");
        assert(await evaluate("Boolean(document.querySelector('.desktop-project-location-menu'))"), "Selecting the current location must keep the bar open");
        await evaluate("document.querySelector('.desktop-titlebar-location-button').click()");
        await waitFor("!document.querySelector('.desktop-project-location-menu')");
      }
    }
  }
  for (const width of [1100, 640]) for (const theme of ['light', 'dark']) {
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
  await openProjectMenu();
  await waitFor("Boolean(document.querySelector('button[data-project-location=cloud]'))");
  await evaluate("document.querySelector('button[data-project-location=cloud]').click()");
  await waitFor("Boolean(document.querySelector('.desktop-cloud-workspace-switch-dialog [data-cloud-sign-in-action]'))");
  assert(await evaluate("window.__nativeCloudWorkbenchSmoke.state().location === 'local' && !document.querySelector('[data-workspace-location=local]').hidden && document.querySelector('[data-workspace-location=cloud]').hidden"), "Sign-in must precede Cloud selection");
  assert(await evaluate("Boolean(document.querySelector('.desktop-titlebar-workspace-mark[data-project-location=local]')) && Boolean(document.querySelector('.desktop-titlebar-terminal')) && Boolean(document.querySelector('.desktop-titlebar-changes'))"),
    'An unresolved sign-in gate must retain the Local Header identity and actions');
  assert(await evaluate("!document.querySelector('.desktop-cloud-workspace-switch-dialog aside, .desktop-cloud-workspace-switch-dialog nav')"), "The sign-in dialog must not introduce service navigation");
  await headerPresentation("local");
  // Cached Cloud entry no longer supplies an accidental network delay after
  // the preceding sidebar collapse/expand matrix. Measure the settled pane.
  await evaluate("Promise.all([...document.querySelectorAll('[data-workspace-location=local] .po-collapsible-pane-frame')].flatMap(node => node.getAnimations()).map(animation => animation.finished.catch(() => {})))");
  const authGeometry = await presentation("local");
  for (const region of ["explorer", "editor", "footer"]) for (const property of ["x", "y", "width", "height"]) {
    assert(Math.abs(authGeometry[region][property] - localPresentation[region][property]) < 1,
      `Authentication changed retained local ${region} ${property}: ${localPresentation[region][property]} -> ${authGeometry[region][property]}`);
  }
  await waitFor("getComputedStyle(document.querySelector('.desktop-cloud-workspace-switch-dialog')).opacity === '1' && document.querySelector('.desktop-cloud-workspace-switch-dialog').getBoundingClientRect().height > 200");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await writeFile(path.join(artifacts, "login-before-switch.png"), (await window.webContents.capturePage()).toPNG());
  const loginPresentations = [];
  const verifyLogin = async (scene) => {
    await evaluate(`Promise.all([
      ...document.querySelector('[data-cloud-sign-in-action]').getAnimations(),
      ...document.querySelector('.desktop-cloud-workspace-switch-dialog').getAnimations()
    ].map(animation => animation.finished.catch(() => {})))`);
    await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    const sample = await evaluate(`(() => {
      const dialog = document.querySelector('.desktop-cloud-workspace-switch-dialog');
      const cta = dialog.querySelector('.desktop-cloud-project-activation');
      const button = cta.querySelector('[data-cloud-sign-in-action]');
      const box = (node) => { const r = node.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; };
      return { dialog:box(dialog), cta:box(cta), button:box(button),
        centered:[cta, ...cta.querySelectorAll('h2, [data-cloud-sign-in-action]')].map(node => box(node).x + box(node).width / 2),
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
    assert(sample.dialog.width <= 642 && sample.dialog.height < window.getContentSize()[1]-32, `Sign-in is oversized: ${scene}`);
    loginPresentations.push({ scene, ...sample });
    return sample;
  };
  const initialLogin = await verifyLogin("dark-en");
  const preview = { x: Math.floor(initialLogin.dialog.x - 24), y: Math.floor(initialLogin.dialog.y - 24),
    width: Math.ceil(initialLogin.dialog.width + 48), height: Math.ceil(initialLogin.dialog.height + 48) };
  await writeFile(path.join(artifacts, "login-preview.png"), (await window.webContents.capturePage(preview)).toPNG());
  await evaluate("document.querySelector('[data-cloud-sign-in-action]').click()");
  await waitFor("document.querySelector('.desktop-cloud-project-activation')?.getAttribute('aria-busy') === 'true'");
  let login = await verifyLogin("waiting-en");
  assert(login.disabled && login.text.includes("Finish signing in in your browser"), "Pending login needs clear browser guidance");
  await writeFile(path.join(artifacts, "login-waiting.png"), (await window.webContents.capturePage()).toPNG());
  await evaluate("window.__nativeCloudWorkbenchSmoke.failLogin()");
  await waitFor("Boolean(document.querySelector('.desktop-cloud-project-activation [role=alert]'))");
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
  await waitFor("!document.querySelector('.desktop-cloud-workspace-switch-dialog')");
  await evaluate("window.__nativeCloudWorkbenchSmoke.setCloudSessionAvailable(true)");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  assert((await state()).location === "local", "Late authentication after cancellation must not select Cloud");
  await headerPresentation("local");
  await evaluate("window.__nativeCloudWorkbenchSmoke.setCloudSessionAvailable(false)");
  await openProjectMenu();
  await waitFor("Boolean(document.querySelector('button[data-project-location=cloud]'))");
  await evaluate("document.querySelector('button[data-project-location=cloud]').click()");
  await waitFor("Boolean(document.querySelector('.desktop-cloud-workspace-switch-dialog'))");
  await evaluate("window.__nativeCloudWorkbenchSmoke.setCloudSessionAvailable(true)");
  await waitFor("window.__nativeCloudWorkbenchSmoke.state().location === 'cloud' && !document.querySelector('.desktop-cloud-workspace-switch-dialog')");
  await waitFor("document.querySelector('[data-cloud-native=true]').textContent.includes('cloud-only')");
  await selectLocation("local");
  assert(await evaluate("document.querySelector('[data-workspace-location=local] .cm-editor')?.dataset.fixtureIdentity === 'retained-local-host' && document.querySelector('[data-workspace-location=local] .cm-content').textContent.includes('LOCAL_UNSAVED_DRAFT')"), "Authentication must preserve local drafts");
  await evaluate("window.__nativeCloudWorkbenchSmoke.setRepositoryLocalOnly(true); window.__nativeCloudWorkbenchSmoke.setCloudSessionAvailable(false)");
  await openProjectMenu();
  await evaluate("document.querySelector('button[data-project-location=cloud]').click()");
  await waitFor("Boolean(document.querySelector('[data-cloud-sign-in-action]'))");
  const activationTitle = await evaluate("document.querySelector('.desktop-cloud-project-activation h2').textContent");
  await evaluate("window.__nativeCloudWorkbenchSmoke.setCloudSessionAvailable(true)");
  await waitFor("Boolean(document.querySelector('[data-cloud-publish-action]:not(:disabled)'))");
  assert(await evaluate(`document.querySelector('.desktop-cloud-project-activation h2').textContent === ${JSON.stringify(activationTitle)}`),
    "Signing in to an unhosted repository must retain the same value surface");
  const publishPresentations = [];
  for (const [width, height] of [[1100,760], [720,640], [640,640], [480,640]]) {
    window.setContentSize(width, height);
    await waitFor(`innerWidth === ${width}`);
    for (const theme of ['light', 'dark']) {
      await evaluate(`window.__nativeCloudWorkbenchSmoke.setLoginAppearance('${theme}', 'en')`);
      await evaluate(`Promise.all([
        ...document.querySelector('[data-cloud-publish-action]').getAnimations(),
        ...document.querySelector('.desktop-cloud-workspace-switch-dialog').getAnimations()
      ].map(animation => animation.finished.catch(() => {})))`);
      const presentation = await evaluate(`(() => {
        const dialog = document.querySelector('.desktop-cloud-workspace-switch-dialog');
        const card = dialog.querySelector('.desktop-cloud-project-activation');
        const button = card.querySelector('[data-cloud-publish-action]');
        const rect = dialog.getBoundingClientRect(), style = getComputedStyle(card);
        return { width:rect.width, height:rect.height, x:rect.x, y:rect.y, padding:style.padding,
          overflow:card.scrollWidth > card.clientWidth || button.scrollWidth > button.clientWidth,
          action:button.textContent, color:getComputedStyle(button).color, background:getComputedStyle(button).backgroundColor };
      })()`);
      assert(presentation.x >= 31 && presentation.y >= 31 && !presentation.overflow,
        `Publish dialog must preserve fixed insets without clipping (${theme}/${width}): ${JSON.stringify(presentation)}`);
      assert(presentation.padding === '32px 28px' && presentation.action === 'Deploy this project to Cloud',
        'Authenticated activation must retain spacing and offer actual publication');
      publishPresentations.push({theme, viewport:width, ...presentation});
      if (width === 1100 || width === 640) await writeFile(path.join(artifacts, `publish-${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG());
    }
  }
  window.setContentSize(1100,760);
  await evaluate("document.querySelector('[data-cloud-publish-action]').click()");
  await waitFor("Boolean(document.querySelector('.desktop-cloud-publish-confirmation'))");
  assert((await state()).publishRequests.length === 0, 'The existing upload confirmation must precede publication');
  await evaluate("document.querySelector('.desktop-cloud-publish-confirmation .desktop-dialog-button.primary').click()");
  await waitFor("window.__nativeCloudWorkbenchSmoke.state().publishRequests.length === 1");
  assert((await state()).publishRequests[0] === 'fixture-org', 'Publication must use the selected organization');
  assert((await state()).location === 'local' && await evaluate("Boolean(document.querySelector('.desktop-cloud-workspace-switch-dialog .desktop-cloud-publish-running'))"),
    'Uploading must retain the Local workbench and show existing publication progress');
  await evaluate("window.__nativeCloudWorkbenchSmoke.finishPublish()");
  await waitFor("window.__nativeCloudWorkbenchSmoke.state().location === 'cloud' && !document.querySelector('.desktop-cloud-workspace-switch-dialog')");
  await selectLocation('local');
  await evaluate("window.__nativeCloudWorkbenchSmoke.setRepositoryWrongHost(true)");
  await openProjectMenu();
  await evaluate("document.querySelector('button[data-project-location=cloud]').click()");
  await waitFor("Boolean(document.querySelector('.desktop-cloud-project-connection-error'))");
  for (const theme of ['light', 'dark']) {
    await evaluate(`window.__nativeCloudWorkbenchSmoke.setLoginAppearance('${theme}', 'en')`);
    await evaluate(`(() => {
      const dialog = document.querySelector('.desktop-cloud-workspace-switch-dialog');
      return Promise.all([...dialog.getAnimations(), ...dialog.querySelector('button.primary').getAnimations()]
        .map(animation => animation.finished.catch(() => {})));
    })()`);
    await writeFile(path.join(artifacts, `connection-error-${theme}.png`), (await window.webContents.capturePage()).toPNG());
  }
  await evaluate("document.querySelector('.desktop-cloud-project-connection-error summary').click()");
  await waitFor("document.querySelector('.desktop-cloud-project-connection-error details').open");
  await writeFile(path.join(artifacts, 'connection-error-details.png'), (await window.webContents.capturePage()).toPNG());
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await waitFor("!document.querySelector('.desktop-cloud-workspace-switch-dialog')");
  await evaluate("window.__nativeCloudWorkbenchSmoke.setRepositoryWrongHost(false)");
  await evaluate("window.__nativeCloudWorkbenchSmoke.setRepositoryMissing(true)");
  await openProjectMenu();
  await evaluate("document.querySelector('button[data-project-location=cloud]').click()");
  await waitFor("Boolean(document.querySelector('[data-cloud-replace-action]'))");
  assert((await state()).detachRequests.length === 0, 'A missing Cloud project must not automatically detach the Git connection');
  for (const theme of ['light', 'dark']) {
    await evaluate(`window.__nativeCloudWorkbenchSmoke.setLoginAppearance('${theme}', 'en')`);
    await waitFor(`document.querySelector('.desktop-overlay-root')?.dataset.themeMode === '${theme}'`);
    await captureSettledDialog(`missing-project-${theme}`, '.desktop-cloud-workspace-switch-dialog');
  }
  await evaluate("document.querySelector('[data-cloud-replace-action]').click()");
  await waitFor("Boolean(document.querySelector('.desktop-cloud-publish-confirmation'))");
  await captureSettledDialog('missing-project-confirmation', '.desktop-cloud-publish-confirmation');
  assert((await state()).detachRequests.length === 0, 'Replacement confirmation must precede detaching');
  await evaluate("[...document.querySelectorAll('.desktop-cloud-publish-confirmation button')].find(button => button.textContent === 'Cancel').click()");
  await waitFor("!document.querySelector('.desktop-cloud-publish-confirmation')");
  assert((await state()).detachRequests.length === 0, 'Cancelling replacement must keep the old connection');
  await evaluate("document.querySelector('[data-cloud-replace-action]').click()");
  await waitFor("Boolean(document.querySelector('.desktop-cloud-publish-confirmation'))");
  await evaluate("document.querySelector('.desktop-cloud-publish-confirmation button.primary').click()");
  await waitFor("Boolean(document.querySelector('[data-cloud-publish-action]'))");
  assert((await state()).detachRequests.length === 1 && (await state()).detachRequests[0].join(',') === 'puppyone',
    'Reviewed replacement must detach exactly the old canonical Cloud remote');
  assert((await state()).publishRequests.length === 1,
    'Replacing the connection must return to explicit organization-scoped publication without uploading automatically');
  await captureSettledDialog('missing-project-ready-to-publish', '.desktop-cloud-workspace-switch-dialog');
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await waitFor("!document.querySelector('.desktop-cloud-workspace-switch-dialog')");
  await evaluate("window.__nativeCloudWorkbenchSmoke.finishLocalSaves()");
  snapshot = await state();
  assert(!errors.length, `Renderer errors: ${errors.join("; ")}`);
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify({ passed: true, electronVersion:process.versions.electron, pdfRuntimeDiagnostics, localHost, localPresentation, cloudPresentation, headerPresentations,  nativeCornerCaptures, authGeometry, loginPresentations, publishPresentations, snapshot, errors }, null, 2));
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
