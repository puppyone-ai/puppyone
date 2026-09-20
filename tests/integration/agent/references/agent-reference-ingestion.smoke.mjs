#!/usr/bin/env electron

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme } from "electron";
import { createAgentAttachmentStore } from "../../../../electron/main/agent/agent-attachment-store.mjs";
import { registerAgentIpcHandlers } from "../../../../electron/main/ipc/agent-ipc.mjs";
import { createProjectSessionService } from "../../../../electron/main/workspace/project-sessions/project-session-service.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const preloadPath = path.join(repoRoot, "electron", "preload.cjs");
const rendererPath = path.join(repoRoot, "dist", "index.html");
const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "puppyone-agent-reference-smoke-"));
const userDataPath = path.join(tempRoot, "user-data");
const workspacePath = path.join(tempRoot, "workspace");
const stagingPath = path.join(userDataPath, "agent-runtime", "attachments");
const imagePath = path.join(tempRoot, "finder-capture.png");
const epoch = "electron-smoke-draft";
const originalImage = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4AWP8DwQMQMDEAAUAPfgEADYYS7QAAAAASUVORK5CYII=", "base64");
const grantsOnly = process.argv.includes("--grants-only");
const windows = [];
const projectSessions = createProjectSessionService();
let attachmentStore = null;
let consumedReference = null;

await fsp.mkdir(userDataPath, { recursive: true });
await fsp.mkdir(path.join(workspacePath, "src"), { recursive: true });
await fsp.writeFile(path.join(workspacePath, "alpha.md"), "alpha");
await fsp.writeFile(path.join(workspacePath, "beta.md"), "beta");
await fsp.writeFile(imagePath, originalImage);
app.setPath("userData", userDataPath);
app.commandLine.appendSwitch("disable-gpu");

async function runSmoke() {
  console.log("agent-reference smoke: Electron ready");
  if (!grantsOnly) await fsp.access(rendererPath);
  if (nativeImage.createFromBuffer(originalImage).isEmpty()) throw new Error("The image fixture must be decodable.");
  registerLocalizationFixture();
  attachmentStore = createAgentAttachmentStore({ rootPath: stagingPath });
  await attachmentStore.initialize();
  registerAgentIpcHandlers({
    ipcMain,
    projectSessions,
    attachmentStore,
    dialog,
    getDialogOwnerWindow: (sender) => BrowserWindow.fromWebContents(sender),
    authorizeWorkspaceRoot: async (_event, requestedRoot) => {
      if (requestedRoot !== workspacePath) throw new Error("Electron smoke workspace authorization failed closed.");
      return workspacePath;
    },
    localAgentInventory: { discover: async () => ({ connections: [], scannedAt: new Date(0).toISOString(), warnings: [] }) },
    agentService: {
      assertSessionInstance(_sender, request) {
        if (request.sessionId !== "electron-smoke-session" || request.instanceId !== "electron-smoke-instance") {
          throw new Error("Electron smoke session instance mismatch.");
        }
      },
      getReferenceInputCapabilities: () => ({
        schemaVersion: 1,
        workspace: { files: true, directories: true },
        attachments: {
          image: { accepted: true, mimeTypes: ["image/png"], maxBytes: 25 * 1024 * 1024 },
          text: { accepted: false },
          audio: { accepted: false },
          video: { accepted: false },
          binary: { accepted: false },
        },
        limits: {
          maxCount: 32,
          maxBytesPerReference: 25 * 1024 * 1024,
          maxTotalBytes: 25 * 1024 * 1024,
        },
        steer: false,
        attachmentOnly: false,
      }),
      startTurn: async (sender, request, authorizedRoot) => {
        if (authorizedRoot !== workspacePath || sender.id <= 0) throw new Error("Electron smoke owner correlation failed.");
        const staged = request.references.find((reference) => reference.kind === "staged-attachment");
        if (!staged || !request.privateReferenceLease?.tokens?.length) {
          throw new Error("Electron smoke did not receive an authorized leased snapshot.");
        }
        consumedReference = {
          path: staged.path,
          bytes: await fsp.readFile(staged.path),
          token: request.privateReferenceLease.tokens[0],
          ownerId: sender.id,
          references: request.references,
        };
        return { sessionId: "electron-smoke-session", turnId: "electron-smoke-turn" };
      },
    },
  });

  const grantResult = await runNativeGrantSmoke();
  console.log("agent-reference smoke: native grants passed");
  const layoutResult = grantsOnly ? { layout: "not-run" } : await runProductionLayoutSmoke();
  if (!grantsOnly) console.log("agent-reference smoke: production layout passed");
  console.log(JSON.stringify({ ok: true, ...grantResult, ...layoutResult }, null, 2));
}

function registerLocalizationFixture() {
  const state = { preference: "en", locale: "en", direction: "ltr", systemLanguages: ["en"] };
  ipcMain.handle("localization:get-bootstrap", async () => state);
  ipcMain.handle("localization:set-language-preference", async () => state);
}

async function runNativeGrantSmoke() {
  console.log("agent-reference smoke: creating native grant window");
  const window = createWindow({ show: false, width: 760, height: 700, preload: true });
  const record = projectSessions.open(window.webContents.id, { path: workspacePath, workspace: { id: "reference-smoke-project" } });
  const projectContext = { projectId: record.projectId, rootPath: record.rootPath, generation: record.generation };
  await window.loadURL(referenceHarnessUrl(projectContext));
  console.log("agent-reference smoke: native grant window loaded");
  await waitForRenderer(window, "Boolean(window.puppyoneDesktop && window.puppyoneSmoke)", Boolean);

  window.webContents.debugger.attach("1.3");
  const { root } = await window.webContents.debugger.sendCommand("DOM.getDocument", { depth: 2 });
  const { nodeId } = await window.webContents.debugger.sendCommand("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: "#native-file-input",
  });
  if (!nodeId) throw new Error("Electron smoke file input was not found.");
  await window.webContents.debugger.sendCommand("DOM.setFileInputFiles", { nodeId, files: [imagePath] });
  try {
    await waitForRenderer(window, "window.puppyoneSmoke.results.length", (value) => value >= 1, 1_000);
  } catch {
    await window.webContents.executeJavaScript(
      "document.querySelector('#native-file-input').dispatchEvent(new Event('change', { bubbles: true }))",
      true,
    );
    await waitForRenderer(window, "window.puppyoneSmoke.results.length", (value) => value >= 1);
  }

  await window.webContents.executeJavaScript("window.puppyoneSmoke.dispatchDrop()", true);
  await waitForRenderer(window, "window.puppyoneSmoke.results.length", (value) => value >= 2);
  await window.webContents.executeJavaScript("window.puppyoneSmoke.dispatchPaste()", true);
  await waitForRenderer(window, "window.puppyoneSmoke.results.length", (value) => value >= 3);
  await window.webContents.executeJavaScript("window.puppyoneSmoke.dispatchVirtualImage('drop')", true);
  await waitForRenderer(window, "window.puppyoneSmoke.results.length", (value) => value >= 4);
  await window.webContents.executeJavaScript("window.puppyoneSmoke.dispatchVirtualImage('paste')", true);
  await waitForRenderer(window, "window.puppyoneSmoke.results.length", (value) => value >= 5);
  const workspaceReferences = await window.webContents.executeJavaScript("window.puppyoneSmoke.resolveWorkspace()", true);
  const results = await window.webContents.executeJavaScript("window.puppyoneSmoke.results", true);

  const drafts = results.map((entry) => entry.references?.[0]);
  if (results.map((entry) => entry.source).join(",") !== "picker,drop,paste,virtual-drop,virtual-paste") {
    throw new Error(`Electron smoke ingestion order was unexpected: ${JSON.stringify(results)}`);
  }
  if (drafts.some((draft) => !draft?.token || draft.kind !== "staged-attachment" || draft.status !== "ready")) {
    throw new Error("Electron smoke did not stage native and pathless Files through production preload.");
  }
  if (new Set(drafts.map((draft) => draft.token)).size !== 1) {
    throw new Error("Electron smoke did not deduplicate identical native and pathless images.");
  }
  if (JSON.stringify({ results, workspaceReferences }).includes(tempRoot)) {
    throw new Error("Electron smoke leaked an absolute source or workspace path to Renderer metadata.");
  }
  if (workspaceReferences.length !== 3
    || workspaceReferences.filter((reference) => reference.entryType === "file").length !== 2
    || workspaceReferences.filter((reference) => reference.entryType === "directory").length !== 1) {
    throw new Error("Electron smoke did not resolve the ordered multi-entry Explorer selection.");
  }

  const failures = await window.webContents.executeJavaScript("window.puppyoneSmoke.checkProjectFailures()", true);
  if (failures.join(",") !== "PROJECT_CONTEXT_REQUIRED,PROJECT_STALE,PROJECT_UNAUTHORIZED") {
    throw new Error(`Electron smoke project authorization regressed: ${JSON.stringify(failures)}`);
  }

  await fsp.writeFile(imagePath, "source changed after staging");
  await window.webContents.executeJavaScript("window.puppyoneSmoke.startTurn()", true);
  if (!consumedReference || !consumedReference.bytes.equals(originalImage) || consumedReference.path === imagePath) {
    throw new Error("Electron smoke did not consume the immutable private snapshot.");
  }
  const revokeWhileLeased = await window.webContents.executeJavaScript("window.puppyoneSmoke.revokeCurrent()", true);
  if (revokeWhileLeased.revoked !== 0) throw new Error("Renderer revocation broke an active snapshot lease.");
  await fsp.access(consumedReference.path);
  await attachmentStore.revokeLeased({
    ownerId: consumedReference.ownerId,
    workspaceRoot: workspacePath,
    tokens: [consumedReference.token],
  });
  await expectMissing(consumedReference.path);
  window.webContents.debugger.detach();
  return {
    nativeGrantRoutes: results.map((entry) => entry.source),
    explorerEntries: workspaceReferences.map((reference) => `${reference.entryType}:${reference.relativePath}`),
    immutableSnapshotBytes: consumedReference.bytes.byteLength,
    projectAuthorizationFailures: failures,
  };
}

async function runProductionLayoutSmoke() {
  const window = createWindow({ show: false, width: 760, height: 820, preload: false });
  const matrix = [];
  const pickerThemes = [];
  const imageControls = [];
  for (const theme of ["light", "dark"]) {
    nativeTheme.themeSource = theme;
    const url = pathToFileURL(rendererPath);
    url.searchParams.set("theme", theme);
    url.hash = "agent-visual-smoke";
    await window.loadURL(url.href);
    await waitForRenderer(window, `(() => ({
      cards: document.querySelectorAll('.desktop-agent-visual-attachments > .desktop-agent-visual-attachment').length,
      mentions: document.querySelectorAll('.desktop-agent-prompt-mention').length,
    }))()`, (value) => value?.cards === 1 && value?.mentions === 2);
    for (const width of [420, 560, 760]) {
      window.setContentSize(width, 820);
      await new Promise((resolve) => setTimeout(resolve, 50));
      const snapshot = await window.webContents.executeJavaScript(`(() => {
        const boundary = document.querySelector('.desktop-agent-boundary');
        const trigger = document.querySelector('.desktop-agent-reference-trigger');
        const error = document.querySelector('.desktop-agent-prompt-mention.is-error');
        const promptContent = document.querySelector('.desktop-agent-prompt-editor .cm-content');
        const modelTrigger = document.querySelector('.desktop-agent-composer-picker.is-model .desktop-agent-picker-trigger');
        const effortTrigger = document.querySelector('.desktop-agent-composer-picker.is-effort .desktop-agent-picker-trigger');
        const imageCard = document.querySelector('.desktop-agent-visual-attachment');
        const imageActions = Array.from(imageCard?.querySelectorAll('button') || []);
        const cardRect = imageCard?.getBoundingClientRect();
        const removeRect = imageActions[0]?.getBoundingClientRect();
        const promptStyle = promptContent ? getComputedStyle(promptContent) : null;
        const modelStyle = modelTrigger ? getComputedStyle(modelTrigger) : null;
        const effortStyle = effortTrigger ? getComputedStyle(effortTrigger) : null;
        const textStart = (element, style) => element && style
          ? element.getBoundingClientRect().left + Number.parseFloat(style.paddingInlineStart || '0')
          : null;
        return {
          theme: document.querySelector('[data-smoke-theme]')?.getAttribute('data-smoke-theme'),
          width: Math.round(boundary?.getBoundingClientRect().width || 0),
          viewport: window.innerWidth,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          visualAttachments: document.querySelectorAll('.desktop-agent-visual-attachments > .desktop-agent-visual-attachment').length,
          inlineMentions: document.querySelectorAll('.desktop-agent-prompt-mention').length,
          imagePreviews: document.querySelectorAll('.desktop-agent-visual-attachment img').length,
          imageActionCount: imageActions.length,
          imageSize: { width: cardRect?.width, height: cardRect?.height },
          imageRemoveLabel: imageActions[0]?.getAttribute('aria-label') || '',
          compactCornerRemove: Boolean(cardRect && removeRect && removeRect.width <= 24
            && removeRect.height <= 24 && Math.abs(removeRect.right - cardRect.right) <= 8
            && Math.abs(removeRect.top - cardRect.top) <= 8),
          transcriptMediaChips: document.querySelectorAll('.desktop-agent-message-references > span').length,
          addLabel: trigger?.getAttribute('aria-label') || '',
          inlineError: error?.getAttribute('title') || '',
          composerTextStarts: {
            prompt: textStart(promptContent, promptStyle),
            model: textStart(modelTrigger, modelStyle),
          },
          pickerPadding: [modelStyle, effortStyle].map((style) => ({
            start: Number.parseFloat(style?.paddingInlineStart || '0'),
            end: Number.parseFloat(style?.paddingInlineEnd || '0'),
          })),
        };
      })()`, true);
      const pickerPaddingIsBalanced = snapshot.pickerPadding.length === 2
        && snapshot.pickerPadding.every(({ start, end }) => start >= 8 && end >= 8 && start === end);
      const composerTextIsAligned = snapshot.composerTextStarts.prompt !== null
        && snapshot.composerTextStarts.model !== null
        && Math.abs(snapshot.composerTextStarts.prompt - snapshot.composerTextStarts.model) <= 0.5;
      if (snapshot.theme !== theme || snapshot.width <= 0 || snapshot.width > snapshot.viewport
        || snapshot.overflow || snapshot.visualAttachments !== 1
        || snapshot.inlineMentions !== 2
        || snapshot.imagePreviews !== 1 || snapshot.transcriptMediaChips !== 1
        || snapshot.imageActionCount !== 1 || !snapshot.imageRemoveLabel || !snapshot.compactCornerRemove
        || snapshot.imageSize.width !== 40 || snapshot.imageSize.height !== 40
        || !snapshot.addLabel || !snapshot.inlineError || !pickerPaddingIsBalanced
        || !composerTextIsAligned) {
        throw new Error(`Production Agent reference layout smoke failed: ${JSON.stringify(snapshot)}`);
      }
      matrix.push(`${theme}:${width}`);
    }
    imageControls.push(await checkImageControls(window, theme));
    const directPicker = await window.webContents.executeJavaScript(`(() => ({
      input: Boolean(document.querySelector('.desktop-agent-attachment-control input[type=file]')),
      menu: Boolean(document.querySelector('[role=menu]')),
    }))()`, true);
    if (!directPicker.input || directPicker.menu) {
      throw new Error(`Production Agent direct picker contract failed: ${JSON.stringify(directPicker)}`);
    }
    await window.webContents.executeJavaScript(`(() => {
      const trace = [];
      const capture = () => {
        const surface = document.querySelector('.desktop-agent-picker-popover[data-positioned=true]');
        const trigger = document.querySelector('.desktop-agent-composer-picker.is-model .desktop-agent-picker-trigger');
        if (!surface || !trigger) return;
        const surfaceRect = surface.getBoundingClientRect();
        const triggerRect = trigger.getBoundingClientRect();
        trace.push({
          placement: surface.getAttribute('data-placement') || '',
          top: surfaceRect.top,
          bottom: surfaceRect.bottom,
          anchorTop: triggerRect.top,
        });
      };
      const observer = new MutationObserver(capture);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-placement', 'data-positioned', 'style'],
        childList: true,
        subtree: true,
      });
      window.__agentPickerPlacementTrace = trace;
      window.__agentPickerPlacementObserver = observer;
      document.querySelector('.desktop-agent-composer-picker.is-model button')?.click();
    })()`, true);
    await waitForRenderer(
      window,
      "Boolean(document.querySelector('.desktop-agent-picker-popover[data-positioned=true]'))",
      Boolean,
    );
    await window.webContents.executeJavaScript(`new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    })`, true);
    const pickerSnapshot = await window.webContents.executeJavaScript(`(() => {
      const surface = document.querySelector('.desktop-agent-picker-popover');
      const trigger = document.querySelector('.desktop-agent-composer-picker.is-model .desktop-agent-picker-trigger');
      const option = surface?.querySelector('[role=option]');
      const rootStyle = getComputedStyle(document.documentElement);
      const surfaceStyle = surface ? getComputedStyle(surface) : null;
      const optionStyle = option ? getComputedStyle(option) : null;
      const trace = Array.isArray(window.__agentPickerPlacementTrace)
        ? [...window.__agentPickerPlacementTrace]
        : [];
      window.__agentPickerPlacementObserver?.disconnect();
      const surfaceRect = surface?.getBoundingClientRect();
      const triggerRect = trigger?.getBoundingClientRect();
      return {
        sharedSurface: surface?.classList.contains('desktop-menu-surface') || false,
        nativeOccluder: surface?.getAttribute('data-native-surface-occluder') === 'true',
        quietTone: surface?.getAttribute('data-menu-tone') === 'quiet',
        compactElevation: surface?.getAttribute('data-menu-elevation') === 'compact',
        listbox: Boolean(surface?.querySelector('[role=listbox]')),
        optionCount: surface?.querySelectorAll('[role=option]').length || 0,
        borderRadius: surfaceStyle?.borderRadius || '',
        expectedBorderRadius: rootStyle.getPropertyValue('--po-menu-radius').trim(),
        optionWeight: optionStyle?.fontWeight || '',
        placement: surface?.getAttribute('data-placement') || '',
        aboveAnchor: Boolean(surfaceRect && triggerRect && surfaceRect.bottom <= triggerRect.top - 7),
        placementTrace: trace,
      };
    })()`, true);
    const placementTops = pickerSnapshot.placementTrace.map(({ top }) => top);
    const placementIsStable = placementTops.length > 0
      && Math.max(...placementTops) - Math.min(...placementTops) <= 0.5
      && pickerSnapshot.placementTrace.every(({ placement, bottom, anchorTop }) => (
        placement === "above" && bottom <= anchorTop - 7
      ));
    if (!pickerSnapshot.sharedSurface || !pickerSnapshot.nativeOccluder || !pickerSnapshot.quietTone
      || !pickerSnapshot.compactElevation || !pickerSnapshot.listbox || pickerSnapshot.optionCount < 2
      || pickerSnapshot.borderRadius !== pickerSnapshot.expectedBorderRadius
      || Number(pickerSnapshot.optionWeight) > 400 || pickerSnapshot.placement !== "above"
      || !pickerSnapshot.aboveAnchor || !placementIsStable) {
      throw new Error(`Production Agent picker primitive smoke failed: ${JSON.stringify(pickerSnapshot)}`);
    }
    await window.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`, true);
    await waitForRenderer(
      window,
      "Boolean(document.querySelector('.desktop-agent-picker-popover'))",
      (value) => !value,
    );
    await window.webContents.executeJavaScript(`(() => {
      document.querySelector('.desktop-agent-composer-picker.is-effort button')?.click();
    })()`, true);
    await waitForRenderer(
      window,
      "document.querySelector('.desktop-agent-picker-popover[data-positioned=true]')?.getAttribute('data-placement')",
      (value) => value === "above",
    );
    pickerThemes.push(theme);
    const image = await window.capturePage();
    if (image.isEmpty()) throw new Error(`Production Agent reference ${theme} capture was empty.`);
    await window.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`, true);
    const artifactDirectory = process.env.PUPPYONE_AGENT_RENDER_ARTIFACT_DIR;
    if (artifactDirectory) {
      const rect = await window.webContents.executeJavaScript(`(() => {
        const rect = document.querySelector('.desktop-agent-composer').getBoundingClientRect();
        return { x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
      })()`, true);
      await fsp.mkdir(path.resolve(artifactDirectory), { recursive: true });
      await fsp.writeFile(path.join(path.resolve(artifactDirectory), `reference-composer-${theme}.png`), (await window.capturePage(rect)).toPNG());
    }
  }
  window.destroy();
  return { productionLayoutMatrix: matrix, pickerThemes, imageControls };
}

async function checkImageControls(window, theme) {
  const debug = window.webContents.debugger;
  debug.attach("1.3");
  await debug.sendCommand("DOM.enable");
  await debug.sendCommand("CSS.enable");
  const { root } = await debug.sendCommand("DOM.getDocument");
  const node = async (selector) => (await debug.sendCommand("DOM.querySelector", { nodeId: root.nodeId, selector })).nodeId;
  const cardId = await node(".desktop-agent-visual-attachment");
  const buttonId = await node(".desktop-agent-visual-attachment-actions > button");
  const hover = (nodeId, enabled) => debug.sendCommand("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: enabled ? ["hover"] : [] });
  const read = () => window.webContents.executeJavaScript(`(async () => {
    const card = document.querySelector('.desktop-agent-visual-attachment');
    await Promise.all(card.getAnimations({subtree:true}).filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished));
    const actions = card.querySelector('.desktop-agent-visual-attachment-actions');
    const button = actions.querySelector('button');
    const buttonStyle = getComputedStyle(button);
    return { visible: getComputedStyle(actions).opacity, hitTest: getComputedStyle(actions).pointerEvents,
      opacity: buttonStyle.opacity, background: buttonStyle.backgroundColor, color: buttonStyle.color,
      cardOpacity: getComputedStyle(card).opacity,
      previewOpacity: getComputedStyle(card.querySelector('.desktop-agent-visual-attachment-preview')).opacity,
      focusable: button.tabIndex === 0 && !button.disabled, focused: document.activeElement === button,
      hoverAvailable: matchMedia('(hover: hover)').matches };
  })()`, true);
  const capture = async (state) => {
    const directory = process.env.PUPPYONE_AGENT_RENDER_ARTIFACT_DIR;
    if (!directory) return;
    await fsp.mkdir(path.resolve(directory), { recursive: true });
    await fsp.writeFile(path.join(path.resolve(directory), `image-control-${theme}-${state}.png`), (await window.capturePage()).toPNG());
  };
  try {
    await window.webContents.executeJavaScript("document.activeElement?.blur()", true);
    const idle = await read();
    if (!idle.focusable || (idle.hoverAvailable && (idle.visible !== "0" || idle.hitTest !== "none"))) {
      throw new Error(`Image remove should be quiet but keyboard reachable: ${JSON.stringify(idle)}`);
    }
    await capture("idle");
    await hover(cardId, true);
    const cardHover = await read();
    if (cardHover.visible !== "1" || cardHover.hitTest !== "auto") throw new Error("Image hover did not reveal remove.");
    await hover(buttonId, true);
    const buttonHover = await read();
    if (buttonHover.visible !== "1" || buttonHover.opacity !== "1" || buttonHover.cardOpacity !== "1"
      || buttonHover.background === cardHover.background || buttonHover.color === cardHover.color
      || buttonHover.previewOpacity !== idle.previewOpacity) {
      throw new Error(`Image remove hover must emphasize without fading: ${JSON.stringify({ cardHover, buttonHover })}`);
    }
    await capture("hover");
    await hover(buttonId, false); await hover(cardId, false);
    await window.webContents.executeJavaScript("document.querySelector('.desktop-agent-visual-attachment-actions > button').focus()", true);
    const focused = await read();
    if (!focused.focused || focused.visible !== "1" || focused.hitTest !== "auto") throw new Error("Keyboard focus did not reveal image remove.");
    await window.webContents.executeJavaScript("document.activeElement.blur()", true);
    const blurred = await read();
    if (blurred.hoverAvailable && blurred.visible !== "0") throw new Error("Image remove stayed visible after leaving.");
    return { theme, idle, cardHover, buttonHover, focused, blurred };
  } finally {
    await hover(buttonId, false); await hover(cardId, false);
    debug.detach();
  }
}

function createWindow({ show, width, height, preload }) {
  const window = new BrowserWindow({
    show,
    width,
    height,
    webPreferences: {
      ...(preload ? { preload: preloadPath } : {}),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  windows.push(window);
  return window;
}

function referenceHarnessUrl(projectContext) {
  const html = `<!doctype html>
    <html><body>
      <input id="native-file-input" type="file" accept="image/png">
      <div id="drop-zone" tabindex="0">drop</div>
      <textarea id="paste-zone"></textarea>
      <script>
        const rootPath = ${JSON.stringify(workspacePath)};
        const epoch = ${JSON.stringify(epoch)};
        const projectContext = ${JSON.stringify(projectContext)};
        const results = [];
        let pickerStarted = false;
        let workspaceReferences = [];
        async function ingest(source, files) {
          const references = await window.puppyoneDesktop.stageAgentAttachments({ rootPath, epoch, projectContext, files });
          if (references?.agentFailure) throw new Error(references.agentFailure.code + ': ' + references.agentFailure.message);
          results.push({ source, references });
          return references;
        }
        const input = document.querySelector('#native-file-input');
        input.addEventListener('change', () => {
          if (pickerStarted) return;
          pickerStarted = true;
          void ingest('picker', Array.from(input.files));
        });
        const dropZone = document.querySelector('#drop-zone');
        dropZone.addEventListener('dragover', (event) => event.preventDefault());
        dropZone.addEventListener('drop', (event) => {
          event.preventDefault();
          void ingest(event.virtualSource ? 'virtual-drop' : 'drop', Array.from(event.dataTransfer.files));
        });
        const pasteZone = document.querySelector('#paste-zone');
        pasteZone.addEventListener('paste', (event) => {
          event.preventDefault();
          void ingest(event.virtualSource ? 'virtual-paste' : 'paste', Array.from(event.clipboardData.files));
        });
        window.puppyoneSmoke = {
          results,
          async dispatchVirtualImage(kind) {
            const original = input.files[0];
            const image = new File([await original.arrayBuffer()], original.name, { type: 'image/png' });
            if (window.puppyoneDesktop.getPathForFile(image)) throw new Error('Expected a pathless image');
            const transfer = new DataTransfer();
            transfer.items.add(image);
            const event = kind === 'drop'
              ? new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true })
              : new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true });
            Object.defineProperty(event, 'virtualSource', { value: true });
            (kind === 'drop' ? dropZone : pasteZone).dispatchEvent(event);
          },
          dispatchDrop() {
            const transfer = new DataTransfer();
            transfer.items.add(input.files[0]);
            dropZone.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
          },
          dispatchPaste() {
            const transfer = new DataTransfer();
            transfer.items.add(input.files[0]);
            pasteZone.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
          },
          async resolveWorkspace() {
            workspaceReferences = await window.puppyoneDesktop.resolveAgentWorkspaceReferences({
              rootPath,
              projectContext,
              paths: ['alpha.md', 'beta.md', 'src'],
            });
            return workspaceReferences;
          },
          startTurn() {
            return window.puppyoneDesktop.startAgentTurn({
              rootPath,
              projectContext,
              sessionId: 'electron-smoke-session',
              instanceId: 'electron-smoke-instance',
              prompt: 'Inspect the staged image and workspace selection.',
              referenceEpoch: epoch,
              references: [...workspaceReferences, results[0].references[0]],
            });
          },
          revokeCurrent() {
            return window.puppyoneDesktop.revokeAgentAttachments({
              rootPath,
              projectContext,
              tokens: [results[0].references[0].token],
            });
          },
          async checkProjectFailures() {
            const codes = [];
            for (const request of [
              { projectContext: undefined },
              { projectContext: { ...projectContext, generation: 'obsolete' } },
              { rootPath: rootPath + '-other' },
            ]) {
              const result = await window.puppyoneDesktop.stageAgentAttachments({ rootPath, epoch, projectContext, files: [input.files[0]], ...request });
              codes.push(result?.agentFailure?.code || 'unexpected-success');
            }
            return codes;
          },
        };
      </script>
    </body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

async function waitForRenderer(window, expression, predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await window.webContents.executeJavaScript(expression, true);
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Electron smoke timed out waiting for ${expression}; last value: ${String(value)}`);
}

async function expectMissing(filename) {
  try {
    await fsp.access(filename);
  } catch {
    return;
  }
  throw new Error(`Expected private snapshot cleanup: ${path.basename(filename)}`);
}

async function finish() {
  for (const window of windows) {
    if (!window.isDestroyed()) window.destroy();
  }
  await attachmentStore?.close?.().catch(() => undefined);
  await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  app.quit();
}

app.whenReady().then(async () => {
  try {
    await runSmoke();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await finish();
  }
}).catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
  await finish();
});
