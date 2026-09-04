#!/usr/bin/env electron

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import pty from "node-pty";
import { registerTerminalIpcHandlers } from "../electron/main/ipc/terminal-ipc.mjs";
import { createTerminalService } from "../electron/main/terminal-service.mjs";
import { createSenderWorkspaceAuthorization } from "../electron/main/workspace-authorization.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rendererPath = path.join(repoRoot, "dist", "index.html");
const preloadPath = path.join(repoRoot, "electron", "preload.cjs");
const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "puppyone-terminal-p0-"));
const workspaceRoots = ["one", "two", "three"].map((name) => (
  path.join(tempRoot, `workspace-${name}`)
));
const userDataPath = path.join(tempRoot, "user-data");
const windows = [];
const ptyRecords = [];
const createEvents = [];
const appearanceEvents = [];

await Promise.all([
  fsp.mkdir(userDataPath, { recursive: true }),
  ...workspaceRoots.map((workspaceRoot) => fsp.mkdir(workspaceRoot, { recursive: true })),
]);
await fsp.access(rendererPath).catch(() => {
  throw new Error("Terminal P0 smoke requires a built renderer. Run `npm run build` first.");
});

app.setPath("userData", userDataPath);
app.commandLine.appendSwitch("disable-gpu");

const coreTerminalService = createTerminalService({
  appVersion: "terminal-p0-smoke",
  initializeWorkspaceEditReview: async () => undefined,
  ptyService: createTrackedPtyService(),
  logger: console,
});
const terminalService = {
  create: async (sender, request, workspaceRoot) => {
    const result = await coreTerminalService.create(sender, request, workspaceRoot);
    createEvents.push(Object.freeze({
      id: result.id,
      pid: result.pid,
      requestedRoot: request.rootPath,
      workspaceRoot,
    }));
    return result;
  },
  input: coreTerminalService.input,
  resize: coreTerminalService.resize,
  appearance: (sender, request) => {
    const updated = coreTerminalService.appearance(sender, request);
    if (updated) appearanceEvents.push(structuredClone(request));
    return updated;
  },
  close: coreTerminalService.close,
};

registerLocalizationFixture();
registerTerminalIpcHandlers({
  ipcMain,
  terminalAgentLocator: {
    locate: async ({ onProgress } = {}) => {
      onProgress?.({
        availableAgentIds: [],
        completedAgentCount: 6,
        totalAgentCount: 6,
      });
      return {
        availableAgentIds: [],
        scannedAt: new Date(0).toISOString(),
        source: "scan",
      };
    },
  },
  terminalService,
  authorizeWorkspaceRoot: createSenderWorkspaceAuthorization({
    fsModule: { promises: fsp },
    getWorkspaceRootsForSender: () => workspaceRoots,
  }),
});

app.whenReady().then(run).catch(async (error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
  await finish();
});

async function run() {
  try {
    const window = createWindow();
    const nativeResult = await runMultiRootPtyLifecycle(window);
    const layoutResult = await runProductionTerminalLayout(window);
    console.log(JSON.stringify({ ok: true, nativeResult, layoutResult }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  } finally {
    await finish();
  }
}

async function runMultiRootPtyLifecycle(window) {
  await window.loadURL("data:text/html,<title>Terminal P0 native lifecycle</title>");
  await waitForRenderer(window, "Boolean(window.puppyoneDesktop?.createTerminal)");
  const requests = workspaceRoots.map((workspaceRoot, index) => ({
    id: `terminal_p0_native_${index + 1}`,
    rootPath: workspaceRoot,
    cwd: workspaceRoot,
    cols: 80 + index,
    rows: 24 + index,
    launcherId: "shell",
  }));
  const results = await window.webContents.executeJavaScript(`(async () => {
    window.__terminalP0Native = { data: [], exits: [] };
    window.__terminalP0Native.stopData = window.puppyoneDesktop.onTerminalData(
      (event) => window.__terminalP0Native.data.push(event),
    );
    window.__terminalP0Native.stopExit = window.puppyoneDesktop.onTerminalExit(
      (event) => window.__terminalP0Native.exits.push(event),
    );
    return Promise.all(${JSON.stringify(requests)}.map(
      (request) => window.puppyoneDesktop.createTerminal(request),
    ));
  })()`, true);

  assert(results.length === 3, `Expected three native PTYs: ${JSON.stringify(results)}`);
  assert(new Set(results.map(({ pid }) => pid)).size === 3, "Native PTY PIDs are not unique.");
  assert(coreTerminalService.getSessionCount() === 3, "TerminalService did not retain three PTYs.");
  const canonicalRoots = await Promise.all(workspaceRoots.map((value) => fsp.realpath(value)));
  for (const [index, result] of results.entries()) {
    const event = createEvents.find(({ id }) => id === result.id);
    assert(event?.workspaceRoot === canonicalRoots[index], `PTY ${result.id} used the wrong Root.`);
    assert(result.cwd === canonicalRoots[index], `PTY ${result.id} used the wrong cwd.`);
  }

  const lifecycle = requests.map((request, index) => ({
    id: request.id,
    cols: 96 + index,
    rows: 32 + index,
    marker: `PUPPYONE_P0_NATIVE_${index + 1}`,
  }));
  await window.webContents.executeJavaScript(`(() => {
    for (const entry of ${JSON.stringify(lifecycle)}) {
      window.puppyoneDesktop.resizeTerminal(entry);
      window.puppyoneDesktop.writeTerminal({
        id: entry.id,
        data: ${JSON.stringify(shellCommandTemplate())}.replace("__MARKER__", entry.marker),
      });
    }
  })()`, true);
  await waitForRenderer(window, `(() => {
    const text = window.__terminalP0Native.data.map(({ data }) => data).join("");
    return ${JSON.stringify(lifecycle.map(({ marker }) => marker))}.every(
      (marker) => text.includes(marker),
    );
  })()`);

  for (const [index, result] of results.entries()) {
    const record = ptyRecords.find(({ pid }) => pid === result.pid);
    assert(record, `Missing node-pty record for ${result.id}.`);
    assert(
      record.resizes.some(({ cols, rows }) => (
        cols === lifecycle[index].cols && rows === lifecycle[index].rows
      )),
      `PTY ${result.id} did not receive its resize.`,
    );
  }

  await window.webContents.executeJavaScript(`Promise.all(
    ${JSON.stringify(requests.map(({ id }) => id))}.map(
      (id) => window.puppyoneDesktop.closeTerminal(id),
    ),
  ).then(() => {
    window.__terminalP0Native.stopData();
    window.__terminalP0Native.stopExit();
  })`, true);
  await waitFor(() => coreTerminalService.getSessionCount() === 0, "Native PTYs did not close.");
  for (const { pid } of results) {
    assert(ptyRecords.find((record) => record.pid === pid)?.kills === 1, `PTY ${pid} was not killed once.`);
  }
  return {
    roots: canonicalRoots,
    sessionIds: results.map(({ id }) => id),
    pids: results.map(({ pid }) => pid),
  };
}

async function runProductionTerminalLayout(window) {
  const url = pathToFileURL(rendererPath);
  url.searchParams.set("workspacePath", workspaceRoots[0]);
  url.searchParams.set("theme", "dark");
  url.hash = "terminal-p0-smoke";
  await window.loadURL(url.href);
  await waitForRenderer(window, `Boolean(
    document.querySelector('[data-terminal-p0-smoke-ready="true"]')
    && document.querySelector('.desktop-terminal-launcher-shell')
  )`);

  for (let expectedCount = 1; expectedCount <= 3; expectedCount += 1) {
    if (expectedCount > 1) {
      await clickRendererElement(window, ".desktop-terminal-new-button");
      await waitForRenderer(window, "Boolean(document.querySelector('.desktop-terminal-launcher-shell'))");
    }
    await clickRendererElement(window, ".desktop-terminal-launcher-shell");
    await waitForRenderer(window, `(() => {
      const tabs = [...document.querySelectorAll('[data-terminal-tab-session-id]')];
      return tabs.length === ${expectedCount}
        && tabs.every((tab) => tab.dataset.status === 'running');
    })()`);
  }

  const sessionIds = await rendererSessionIds(window);
  assert(sessionIds.length === 3, `Production UI did not create three Sessions: ${sessionIds}`);
  const baseline = ptyIdentitySnapshot(sessionIds);
  assert(baseline.length === 3, "Production UI did not create three tracked PTYs.");
  assert(new Set(baseline.map(({ pid }) => pid)).size === 3, "Production UI PTY PIDs are not unique.");
  assertPtyIdentity(sessionIds, baseline, "initial three-Session layout");
  await waitFor(
    () => sessionIds.every((id) => appearanceEvents.some((event) => event.id === id)),
    "Production terminals did not synchronize their renderer colors to Main.",
  );
  const renderedBackground = await window.webContents.executeJavaScript(`(() => {
    const terminal = document.querySelector('.desktop-terminal-xterm');
    if (!(terminal instanceof HTMLElement)) return null;
    const css = getComputedStyle(terminal).backgroundColor;
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = css;
    context.fillRect(0, 0, 1, 1);
    return {
      css,
      rgb: [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)],
    };
  })()`, true);
  assert(renderedBackground, "Unable to resolve the production terminal background.");
  for (const { id, pid } of baseline) {
    const record = ptyRecords.find((candidate) => candidate.pid === pid);
    const appearance = appearanceEvents.findLast((event) => event.id === id);
    const dark = isDarkRgb(appearance?.defaultColors?.background);
    assert(
      record?.colorFgBg === (dark ? "15;0" : "0;15"),
      `PTY ${id} received inconsistent COLORFGBG: ${record?.colorFgBg}`,
    );
    assert(
      JSON.stringify(appearance?.defaultColors?.background) === JSON.stringify(renderedBackground.rgb),
      `PTY ${id} OSC background disagrees with Chromium: ${JSON.stringify({
        appearance,
        renderedBackground,
      })}`,
    );
  }
  await assertTerminalNewButtonContract(window);

  const uiLifecycle = sessionIds.map((id, index) => ({
    id,
    cols: 110 + index,
    rows: 38 + index,
    marker: `PUPPYONE_P0_UI_${index + 1}`,
  }));
  await window.webContents.executeJavaScript(`(() => {
    window.__terminalP0Ui = { data: [] };
    window.__terminalP0Ui.stopData = window.puppyoneDesktop.onTerminalData(
      (event) => window.__terminalP0Ui.data.push(event),
    );
    for (const entry of ${JSON.stringify(uiLifecycle)}) {
      window.puppyoneDesktop.resizeTerminal(entry);
      window.puppyoneDesktop.writeTerminal({
        id: entry.id,
        data: ${JSON.stringify(shellCommandTemplate())}.replace("__MARKER__", entry.marker),
      });
    }
  })()`, true);
  await waitForRenderer(window, `(() => {
    const data = window.__terminalP0Ui.data;
    return ${JSON.stringify(uiLifecycle)}.every(({ id, marker }) => (
      data.some((event) => event.id === id && String(event.data).includes(marker))
    ));
  })()`);
  for (const entry of uiLifecycle) {
    const pid = baseline.find(({ id }) => id === entry.id)?.pid;
    const record = ptyRecords.find((candidate) => candidate.pid === pid);
    assert(
      record?.resizes.some(({ cols, rows }) => cols === entry.cols && rows === entry.rows),
      `Production PTY ${entry.id} did not receive its independent resize.`,
    );
  }

  // Keep the smoke effectively invisible while exercising Chromium's trusted
  // input path instead of dispatching synthetic DOM or React events. Showing
  // without activation avoids the test runner and host app fighting over macOS
  // focus between pointerdown and pointermove.
  window.setOpacity(0.01);
  window.showInactive();
  await waitFor(
    () => window.isVisible(),
    "Terminal P0 smoke window did not become visible for trusted input.",
  );
  await window.webContents.executeJavaScript(`(() => {
    window.__terminalP0InputTrace = [];
    for (const type of [
      'mousedown',
      'mousemove',
      'mouseup',
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
      'gotpointercapture',
      'lostpointercapture',
    ]) {
      document.addEventListener(type, (event) => {
        window.__terminalP0InputTrace.push({
          type,
          trusted: event.isTrusted,
          button: event.button,
          buttons: event.buttons,
          pointerId: event.pointerId ?? null,
          target: event.target instanceof Element
            ? event.target.getAttribute('class') || event.target.tagName
            : null,
        });
      }, true);
    }
    window.addEventListener('blur', () => window.__terminalP0InputTrace.push({ type: 'window-blur' }), true);
    window.addEventListener('focus', () => window.__terminalP0InputTrace.push({ type: 'window-focus' }), true);
    document.addEventListener('visibilitychange', () => window.__terminalP0InputTrace.push({
      type: 'visibilitychange',
      state: document.visibilityState,
    }), true);
    let dragClassActive = document.body.classList.contains('desktop-terminal-session-dragging');
    new MutationObserver(() => {
      const nextActive = document.body.classList.contains('desktop-terminal-session-dragging');
      if (nextActive === dragClassActive) return;
      dragClassActive = nextActive;
      window.__terminalP0InputTrace.push({
        type: nextActive ? 'drag-class-add' : 'drag-class-remove',
      });
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  })()`, true);
  await delay(120);
  window.webContents.debugger.attach("1.3");
  try {
    const [firstSessionId, secondSessionId, thirdSessionId] = sessionIds;
    const initialGroups = await rendererGroups(window);
    assert(initialGroups.length === 1, `Expected one initial Group: ${JSON.stringify(initialGroups)}`);

    await dragTabToContentEdge(window, secondSessionId, initialGroups[0].id, "right");
    await waitForGroupCount(window, 2);
    assertPtyIdentity(sessionIds, baseline, "two-Group split");

    let groups = await rendererGroups(window);
    const firstGroup = groupContaining(groups, firstSessionId);
    await dragTabToBar(window, secondSessionId, firstGroup.id);
    await waitForGroupCount(window, 1);
    assertPtyIdentity(sessionIds, baseline, "cross-Bar reunion");

    groups = await rendererGroups(window);
    await dragTabToContentEdge(window, secondSessionId, groups[0].id, "right");
    await waitForGroupCount(window, 2);
    groups = await rendererGroups(window);
    const leftGroupId = groups[0].id;
    const rightGroupId = groupContaining(groups, secondSessionId).id;
    await dragGroupToContentEdge(window, rightGroupId, leftGroupId, "left");
    await waitForRenderer(window, `(
      document.querySelector('[data-terminal-group-pane-id]')
        ?.dataset.terminalGroupPaneId === ${JSON.stringify(rightGroupId)}
    )`);
    assertPtyIdentity(sessionIds, baseline, "left-right Group exchange");

    groups = await rendererGroups(window);
    const thirdSourceGroup = groupContaining(groups, thirdSessionId);
    await dragTabToContentEdge(window, thirdSessionId, thirdSourceGroup.id, "bottom");
    await waitForGroupCount(window, 3);
    assertPtyIdentity(sessionIds, baseline, "three-Group nested split");

    groups = await rendererGroups(window);
    await dragTabToBar(window, thirdSessionId, groupContaining(groups, firstSessionId).id);
    await waitForGroupCount(window, 2);
    groups = await rendererGroups(window);
    await dragTabToBar(window, secondSessionId, groupContaining(groups, firstSessionId).id);
    await waitForGroupCount(window, 1);
    assertPtyIdentity(sessionIds, baseline, "final three-Tab reunion");
  } finally {
    if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach();
  }

  await window.webContents.executeJavaScript(`Promise.all(
    ${JSON.stringify(sessionIds)}.map((id) => window.puppyoneDesktop.closeTerminal(id)),
  ).then(() => {
    window.__terminalP0Ui.stopData();
    return true;
  })`, true);
  await waitFor(() => coreTerminalService.getSessionCount() === 0, "Production UI PTYs did not close.");
  for (const { pid } of baseline) {
    assert(ptyRecords.find((record) => record.pid === pid)?.kills === 1, `UI PTY ${pid} was not killed once.`);
  }
  return {
    sessionIds,
    pids: baseline.map(({ pid }) => pid),
    operations: ["split", "reunite", "swap", "nested-split", "reunite-all"],
  };
}

function createWindow() {
  const window = new BrowserWindow({
    show: false,
    width: 1200,
    height: 820,
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error(`Terminal P0 Renderer exited: ${details.reason}`);
  });
  windows.push(window);
  return window;
}

function createTrackedPtyService() {
  return {
    spawn(file, args, options) {
      const terminal = pty.spawn(file, args, options);
      const record = {
        pid: terminal.pid,
        file,
        args: [...args],
        cwd: options.cwd,
        colorFgBg: options.env?.COLORFGBG ?? null,
        resizes: [],
        kills: 0,
      };
      const resize = terminal.resize.bind(terminal);
      const kill = terminal.kill.bind(terminal);
      terminal.resize = (cols, rows) => {
        record.resizes.push({ cols, rows });
        return resize(cols, rows);
      };
      terminal.kill = (...killArgs) => {
        record.kills += 1;
        return kill(...killArgs);
      };
      ptyRecords.push(record);
      return terminal;
    },
  };
}

function registerLocalizationFixture() {
  const state = {
    preference: "en",
    locale: "en",
    direction: "ltr",
    systemLanguages: ["en"],
  };
  ipcMain.handle("localization:get-bootstrap", async () => state);
  ipcMain.handle("localization:set-language-preference", async () => state);
}

function ptyIdentitySnapshot(sessionIds) {
  return sessionIds.map((id) => {
    const matches = createEvents.filter((event) => event.id === id);
    assert(matches.length === 1, `Expected one PTY create for ${id}, received ${matches.length}.`);
    return { id, pid: matches[0].pid };
  });
}

function assertPtyIdentity(sessionIds, baseline, label) {
  assert(coreTerminalService.getSessionCount() === 3, `${label}: live PTY count changed.`);
  const current = ptyIdentitySnapshot(sessionIds);
  assert(JSON.stringify(current) === JSON.stringify(baseline), `${label}: PTY identity changed.`);
}

async function rendererSessionIds(window) {
  return window.webContents.executeJavaScript(`[
    ...document.querySelectorAll('[data-terminal-tab-session-id]'),
  ].map((tab) => tab.dataset.terminalTabSessionId)`, true);
}

async function rendererGroups(window) {
  return window.webContents.executeJavaScript(`[
    ...document.querySelectorAll('[data-terminal-group-pane-id]'),
  ].map((group) => ({
    id: group.dataset.terminalGroupPaneId,
    sessions: [...group.querySelectorAll('[data-terminal-tab-session-id]')]
      .map((tab) => tab.dataset.terminalTabSessionId),
  }))`, true);
}

function groupContaining(groups, sessionId) {
  const group = groups.find(({ sessions }) => sessions.includes(sessionId));
  if (!group) throw new Error(`Session ${sessionId} has no rendered Group.`);
  return group;
}

async function assertTerminalNewButtonContract(window) {
  const contract = await window.webContents.executeJavaScript(`(() => {
    const rail = document.querySelector('[data-terminal-tab-bar-group-id]');
    const tabs = rail
      ? [...rail.querySelectorAll(':scope > .desktop-terminal-tabs > [data-terminal-tab-session-id]')]
      : [];
    const create = rail?.querySelector(':scope > .desktop-terminal-new-button');
    if (!(rail instanceof HTMLElement) || !(create instanceof HTMLButtonElement) || tabs.length === 0) {
      return null;
    }
    const style = getComputedStyle(create);
    const createRect = create.getBoundingClientRect();
    const lastTabRight = Math.max(...tabs.map((tab) => tab.getBoundingClientRect().right));
    const iconRect = create.querySelector('svg')?.getBoundingClientRect() ?? null;
    return {
      directRailChild: create.parentElement === rail,
      gapAfterLastTab: createRect.left - lastTabRight,
      borderWidths: [
        style.borderTopWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
        style.borderLeftWidth,
      ],
      backgroundColor: style.backgroundColor,
      buttonSize: { width: createRect.width, height: createRect.height },
      iconCenterOffset: iconRect ? {
        x: Math.abs((iconRect.left + iconRect.width / 2) - (createRect.left + createRect.width / 2)),
        y: Math.abs((iconRect.top + iconRect.height / 2) - (createRect.top + createRect.height / 2)),
      } : null,
    };
  })()`, true);
  assert(contract, "Terminal new-Tab button contract could not be measured.");
  assert(contract.directRailChild, "Terminal new-Tab button is not a direct local Tab-rail child.");
  assert(
    contract.gapAfterLastTab >= 0 && contract.gapAfterLastTab <= 4,
    `Terminal new-Tab button drifted away from the final Tab: ${JSON.stringify(contract)}`,
  );
  assert(
    contract.borderWidths.every((width) => width === "0px"),
    `Terminal new-Tab button regained bordered chrome: ${JSON.stringify(contract)}`,
  );
  assert(
    contract.backgroundColor === "rgba(0, 0, 0, 0)"
      || contract.backgroundColor === "transparent",
    `Terminal new-Tab button default background is not transparent: ${JSON.stringify(contract)}`,
  );
  assert(
    contract.buttonSize.width === 28 && contract.buttonSize.height === 28,
    `Terminal new-Tab button dimensions changed: ${JSON.stringify(contract)}`,
  );
  assert(
    contract.iconCenterOffset
      && contract.iconCenterOffset.x <= 0.5
      && contract.iconCenterOffset.y <= 0.5,
    `Terminal new-Tab icon is not centered: ${JSON.stringify(contract)}`,
  );
}

async function clickRendererElement(window, selector) {
  const clicked = await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement) || element.hasAttribute('disabled')) return false;
    element.click();
    return true;
  })()`, true);
  assert(clicked, `Unable to click Renderer selector: ${selector}`);
}

async function dragTabToContentEdge(window, sessionId, targetGroupId, edge) {
  return dragRendererElements(
    window,
    `[data-terminal-tab-session-id="${sessionId}"] .desktop-terminal-tab-select`,
    `[data-terminal-content-drop-group-id="${targetGroupId}"]`,
    edge,
  );
}

async function dragGroupToContentEdge(window, sourceGroupId, targetGroupId, edge) {
  return dragRendererElements(
    window,
    `[data-terminal-group-pane-id="${sourceGroupId}"] .desktop-terminal-pane-handle`,
    `[data-terminal-content-drop-group-id="${targetGroupId}"]`,
    edge,
  );
}

async function dragTabToBar(window, sessionId, targetGroupId) {
  return dragRendererElements(
    window,
    `[data-terminal-tab-session-id="${sessionId}"] .desktop-terminal-tab-select`,
    `[data-terminal-tab-bar-group-id="${targetGroupId}"]`,
    "bar-end",
  );
}

async function dragRendererElements(window, sourceSelector, targetSelector, destination) {
  await window.webContents.executeJavaScript(`(() => {
    if (Array.isArray(window.__terminalP0InputTrace)) {
      window.__terminalP0InputTrace.length = 0;
    }
  })()`, true);
  const geometry = await window.webContents.executeJavaScript(`(() => {
    const source = document.querySelector(${JSON.stringify(sourceSelector)});
    const target = document.querySelector(${JSON.stringify(targetSelector)});
    if (!(source instanceof HTMLElement) || !(target instanceof HTMLElement)) return null;
    const from = source.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const points = {
      left: { x: to.left + 3, y: to.top + to.height / 2 },
      right: { x: to.right - 3, y: to.top + to.height / 2 },
      top: { x: to.left + to.width / 2, y: to.top + 3 },
      bottom: { x: to.left + to.width / 2, y: to.bottom - 3 },
      'bar-end': { x: to.right - 4, y: to.top + to.height / 2 },
    };
    return {
      from: { x: from.left + from.width / 2, y: from.top + from.height / 2 },
      to: points[${JSON.stringify(destination)}],
    };
  })()`, true);
  assert(geometry?.from && geometry?.to, `Drag geometry unavailable: ${sourceSelector} -> ${targetSelector}`);
  const { from, to } = geometry;
  await dispatchMouse(window, "mouseMoved", from.x, from.y, 0);
  await dispatchMouse(window, "mousePressed", from.x, from.y, 1, { button: "left", clickCount: 1 });
  await dispatchMouse(
    window,
    "mouseMoved",
    from.x + (to.x - from.x) * 0.55,
    from.y + (to.y - from.y) * 0.55,
    1,
  );
  await dispatchMouse(window, "mouseMoved", to.x, to.y, 1);
  await dispatchMouse(window, "mouseReleased", to.x, to.y, 0, { button: "left", clickCount: 1 });
  await delay(80);
  const completedState = await terminalDragState(window);
  assert(
    completedState.inputTrace.some(({ type }) => type === "drag-class-add"),
    `Trusted input never crossed the drag threshold: ${JSON.stringify({
      sourceSelector,
      targetSelector,
      destination,
      geometry,
      completedState,
    })}`,
  );
}

async function terminalDragState(window) {
  return window.webContents.executeJavaScript(`(() => JSON.parse(JSON.stringify({
    dragging: document.body.classList.contains('desktop-terminal-session-dragging'),
    operation: document.querySelector('[data-drop-target]')?.querySelector(
      '.desktop-terminal-drop-preview',
    )?.dataset.operation ?? null,
    edge: document.querySelector('[data-drop-target]')?.dataset.dropTarget ?? null,
    allowed: document.querySelector('.desktop-terminal-drop-preview')?.dataset.allowed ?? null,
    inputTrace: window.__terminalP0InputTrace ?? [],
  })))()`, true);
}

async function dispatchMouse(window, type, x, y, buttons, extra = {}) {
  await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
    type,
    x: Math.round(x),
    y: Math.round(y),
    buttons,
    pointerType: "mouse",
    ...extra,
  });
}

async function waitForGroupCount(window, count) {
  await waitForRenderer(
    window,
    `document.querySelectorAll('[data-terminal-group-pane-id]').length === ${count}`,
  );
}

async function waitForRenderer(window, expression, timeoutMs = 12_000) {
  return waitFor(
    async () => Boolean(await window.webContents.executeJavaScript(expression, true)),
    `Timed out waiting for Renderer expression: ${expression}`,
    timeoutMs,
  );
}

async function waitFor(predicate, message, timeoutMs = 8_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return;
    await delay(40);
  }
  throw new Error(message);
}

function shellCommandTemplate() {
  return process.platform === "win32"
    ? "echo __MARKER__\r"
    : "printf '__MARKER__\\n'\r";
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isDarkRgb(value) {
  if (!Array.isArray(value) || value.length !== 3) return false;
  const channels = value.map((channel) => {
    const normalized = Number(channel) / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return ((0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])) < 0.5;
}

async function finish() {
  coreTerminalService.closeAll();
  for (const window of windows) {
    if (!window.isDestroyed()) window.destroy();
  }
  await fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  app.quit();
}
