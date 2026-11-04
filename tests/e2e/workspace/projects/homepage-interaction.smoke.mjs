#!/usr/bin/env electron
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { app, BrowserWindow, ipcMain, Menu } from "electron";
import { workspaceFromPath } from "../../../../electron/local-api/workspace.mjs";
import { createWorkspaceStateStore } from "../../../../electron/main/workspace-state-store.mjs";
import { getDesktopBuildChannelPolicy } from "../../../../shared/desktop-build-identity.mjs";

// More than the twenty a recents list used to keep, so that a cap cannot hide.
const PROJECTS = 30;
const CREATE_DELAY_MS = 900;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-homepage-interaction-"));
const documents = path.join(temporaryRoot, "documents");
await fs.mkdir(documents);
app.setAppPath(repoRoot);
app.setPath("appData", temporaryRoot);
app.setPath("documents", documents);
app.setPath("userData", path.join(temporaryRoot, getDesktopBuildChannelPolicy("dev").userDataName));
await fs.mkdir(app.getPath("userData"), { recursive: true });
app.on("window-all-closed", () => {});

let window;
let server;
const run = promisify(execFile);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = (source) => window.webContents.executeJavaScript(source, true);
const guard = setTimeout(() => { console.error("Homepage interaction check timed out"); app.exit(1); }, 110_000);

// Creating is slowed so that its busy state can be looked at. Everything else is real.
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => handle(channel, async (event, ...args) => {
  if (channel === "workspace:create-project-current") await wait(CREATE_DELAY_MS);
  return listener(event, ...args);
});

const failures = [];
function check(name, passed, detail = "") {
  console.log(`${passed ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!passed) failures.push(name);
}

async function until(expression, description = expression) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await evaluate(expression)) return;
    await wait(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

const pointAt = (selector) => evaluate(`(() => {
  const bounds = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
  return { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) };
})()`);
async function move({ x, y }) {
  window.webContents.sendInputEvent({ type: "mouseMove", x, y });
  await wait(80);
}
async function click(point) {
  await move(point);
  window.webContents.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await wait(30);
  window.webContents.sendInputEvent({ type: "mouseUp", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await wait(160);
}
async function press(keyCode, modifiers = []) {
  window.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
  // A form submits on the character Return types, not on the key going down.
  if (keyCode === "Return") window.webContents.sendInputEvent({ type: "char", keyCode: "\r", modifiers });
  await wait(20);
  window.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
  await wait(120);
}

const TILE = ".onboarding-project-tile";
const ACTIONS = ".onboarding-project-actions";
const AWAY = { x: 1120, y: 90 };
const litRows = `[...document.querySelectorAll('.onboarding-project-row-wrap')].filter((row) => row.matches(':hover'))`;
const focusIsIn = (selector) => `!!document.activeElement?.closest(${JSON.stringify(selector)})`;
const activeTile = `[...document.querySelectorAll(${JSON.stringify(TILE)})].indexOf(document.activeElement)`;

async function openCreateDialog() {
  await click(await pointAt(".onboarding-entry-menu-root .onboarding-entry-action-default"));
  await until("!!document.querySelector('[role=dialog]')", "the create dialog");
  await until("!!document.querySelector('[role=dialog] button[type=submit]:not(:disabled)')", "the default location");
  await wait(220);
}

async function initialize() {
  const registry = createWorkspaceStateStore({ app, filename: "desktop-workspace-state.json", canonicalizeWorkspacePath: async (value) => value });
  for (let index = 1; index <= PROJECTS; index += 1) {
    const root = path.join(temporaryRoot, `Project ${String(index).padStart(2, "0")}`);
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, "note.md"), `# ${index}\n`);
    await run("git", ["init", "-q"], { cwd: root });
    await registry.rememberWorkspaceComposition([await workspaceFromPath(root)]);
  }
  // Launching on the Homepage, not on the project remembered last.
  const statePath = path.join(app.getPath("userData"), "desktop-workspace-state.json");
  await fs.writeFile(statePath, JSON.stringify({ ...JSON.parse(await fs.readFile(statePath, "utf8")), lastActiveWorkspacePaths: [] }));
  const { createServer } = await import("vite");
  server = await createServer({
    root: repoRoot, cacheDir: path.join(temporaryRoot, "vite-cache"), logLevel: "error",
    define: {
      "import.meta.env.VITE_DESKTOP_CLOUD_API_URL": JSON.stringify("http://127.0.0.1:9/api/v1"),
      "import.meta.env.VITE_DESKTOP_CLOUD_WEB_URL": JSON.stringify("http://127.0.0.1:9"),
    },
    server: { host: "127.0.0.1", port: 5392, strictPort: false, hmr: false, watch: null, fs: { allow: [repoRoot, await fs.realpath(path.join(repoRoot, "node_modules")), temporaryRoot] } },
  });
  await server.listen();
  process.env.PUPPYONE_DESKTOP_DEV_URL = `http://127.0.0.1:${server.httpServer.address().port}`;
  app.on("browser-window-created", (_event, owner) => owner.webContents.setBackgroundThrottling(false));
  process.env.VITE_DESKTOP_CLOUD_API_URL = "http://127.0.0.1:9/api/v1";
  process.env.VITE_DESKTOP_CLOUD_WEB_URL = "http://127.0.0.1:9";
  await import("../../../../electron/main.mjs");
}

async function everyProjectIsListed() {
  const rows = await evaluate("document.querySelectorAll('.onboarding-project-row-wrap').length");
  check("Home lists every project", rows === PROJECTS, `${rows} of ${PROJECTS}`);
  const list = await evaluate(`(() => {
    const list = document.querySelector('.onboarding-project-list');
    return { tag: list.tagName, items: list.querySelectorAll(':scope > li').length, label: list.getAttribute('aria-label') };
  })()`);
  check("The projects are a real list", list.tag === "UL" && list.items === PROJECTS && Boolean(list.label), JSON.stringify(list));
}

/** Closing a dialog uncovers a project under a pointer that has not moved. */
async function aClosedDialogLightsNothing() {
  await openCreateDialog();
  const inert = await evaluate("document.getElementById('root').hasAttribute('inert')");
  check("The page behind an open dialog is inert", inert);
  const cancel = await pointAt("[role=dialog] .desktop-dialog-footer .desktop-dialog-button:not(.primary):not(.onboarding-entry-paste-template)");
  await click(cancel);
  await until("!document.querySelector('[role=dialog]')", "the dialog to close");
  check("The page comes back when the dialog closes", !await evaluate("document.getElementById('root').hasAttribute('inert')"));
  await wait(280);
  const under = await evaluate(`(() => {
    const row = [...document.querySelectorAll('.onboarding-project-row-wrap')].find((candidate) => {
      const bounds = candidate.getBoundingClientRect();
      return ${cancel.x} >= bounds.left && ${cancel.x} <= bounds.right && ${cancel.y} >= bounds.top && ${cancel.y} <= bounds.bottom;
    });
    return row?.textContent ?? null;
  })()`);
  assert.ok(under, "the Cancel button did not sit over a project, so nothing was tested");
  const lit = await evaluate(`${litRows}.length`);
  check("A closing dialog lights no project under a resting pointer", lit === 0, `over ${under}`);
  // A real pointer moves in a stream: the first event wakes the rows, the next finds one.
  await move({ x: cancel.x + 2, y: cancel.y + 1 });
  await move({ x: cancel.x + 4, y: cancel.y + 2 });
  await wait(120);
  check("The project answers once the pointer really moves", await evaluate(`${litRows}.length`) === 1);
  await move(AWAY);
}

/** One stop on the way through the page, and the arrow keys inside it, with a visible ring. */
async function theListIsOneTabStop() {
  await evaluate("document.querySelector('.onboarding-entry-menu-trigger').focus()");
  await press("Tab");
  check("Tab enters the list at its first project", await evaluate(`${activeTile} === 0`), `at ${await evaluate(activeTile)}`);
  const ring = await evaluate(`(() => {
    const style = getComputedStyle(document.activeElement);
    return { visible: document.activeElement.matches(':focus-visible'), style: style.outlineStyle, width: style.outlineWidth,
      focus: document.activeElement.matches(':focus'), windowFocus: document.hasFocus() };
  })()`);
  assert.ok(ring.windowFocus, "the page has no focus, so its focus styles cannot be judged");
  check("The focused project shows a focus ring", ring.visible && ring.style === "solid" && ring.width === "2px", JSON.stringify(ring));
  const columns = await evaluate(`(() => {
    const tiles = [...document.querySelectorAll(${JSON.stringify(TILE)})];
    return tiles.filter((tile) => tile.getBoundingClientRect().top === tiles[0].getBoundingClientRect().top).length;
  })()`);
  await press("Right");
  check("Right moves to the next project", await evaluate(`${activeTile} === 1`), `at ${await evaluate(activeTile)}`);
  await press("Down");
  check("Down moves one row down", await evaluate(`${activeTile} === ${1 + columns}`), `at ${await evaluate(activeTile)}, ${columns} columns`);
  await press("Left");
  await press("Up");
  check("Left and Up come back", await evaluate(`${activeTile} === 0`), `at ${await evaluate(activeTile)}`);
  await press("End");
  check("End reaches the last project", await evaluate(`${activeTile} === ${PROJECTS - 1}`), `at ${await evaluate(activeTile)}`);
  await press("Home");
  check("Home reaches the first project", await evaluate(`${activeTile} === 0`), `at ${await evaluate(activeTile)}`);
  await press("Tab");
  check("Tab reaches the project's actions", await evaluate(`document.activeElement === document.querySelector(${JSON.stringify(ACTIONS)})`));
  await press("Tab");
  check("The next Tab leaves the list", !await evaluate(focusIsIn(".onboarding-project-list")));
}

/** A menu and a dialog raised from a project both hand focus back to its button. */
async function focusComesBackToTheProject() {
  const trigger = `document.querySelector(${JSON.stringify(ACTIONS)})`;
  await move(await pointAt(TILE));
  await click(await pointAt(ACTIONS));
  await until("!!document.querySelector('.desktop-project-row-actions-menu')", "the project's menu");
  await wait(120);
  const first = await evaluate("document.activeElement.textContent");
  await press("Down");
  const next = await evaluate("document.activeElement.textContent");
  check("The arrow keys walk the project's menu", first !== next, `${first} -> ${next}`);
  await press("Escape");
  check("Escape closes the project's menu", !await evaluate("!!document.querySelector('.desktop-project-row-actions-menu')"));
  check("Escape returns focus to the project's button", await evaluate(`document.activeElement === ${trigger}`));

  await click(await pointAt(ACTIONS));
  await until("!!document.querySelector('.desktop-project-row-actions-menu')", "the project's menu");
  await wait(120);
  await click(await pointAt(".desktop-project-row-actions-menu .desktop-menu-item:nth-of-type(2), .desktop-project-row-actions-menu .desktop-menu-item:last-of-type"));
  await until("!!document.querySelector('[role=dialog]')", "a dialog from the menu");
  await press("Escape");
  await until("!document.querySelector('[role=dialog]')", "the dialog to close");
  check("A dialog from the menu returns focus to the project's button", await evaluate(`document.activeElement === ${trigger}`));

  const lighting = () => evaluate(`(() => {
    const row = document.querySelector('.onboarding-project-row-wrap');
    return { actions: getComputedStyle(row.querySelector(${JSON.stringify(ACTIONS)})).opacity,
      tile: getComputedStyle(row.querySelector(${JSON.stringify(TILE)})).backgroundColor };
  })()`);
  const unlit = ({ actions, tile }) => actions === "0" && tile === "rgba(0, 0, 0, 0)";

  // Closed from the keyboard, the lit row is how someone on the keyboard sees where they are.
  await move(AWAY);
  await wait(220);
  const byKeyboard = await lighting();
  check("Focus handed back to the keyboard keeps its project lit", !unlit(byKeyboard), JSON.stringify(byKeyboard));

  // Closed with the pointer, nobody is looking for focus, so the project must not stay lit.
  await move(await pointAt(TILE));
  await click(await pointAt(ACTIONS));
  await until("!!document.querySelector('.desktop-project-row-actions-menu')", "the project's menu");
  await wait(120);
  await click(await pointAt(".desktop-project-row-actions-menu .desktop-menu-item:nth-of-type(2), .desktop-project-row-actions-menu .desktop-menu-item:last-of-type"));
  await until("!!document.querySelector('[role=dialog]')", "a dialog from the menu");
  await click(await pointAt("[role=dialog] .desktop-dialog-footer .desktop-dialog-button:not(.primary):not(.destructive)"));
  await until("!document.querySelector('[role=dialog]')", "the dialog to close");
  check("A pointer closing the dialog still returns focus", await evaluate(`document.activeElement === ${trigger}`));
  await move(AWAY);
  await wait(220);
  const byPointer = await lighting();
  check("Focus handed back to a pointer leaves its project unlit", unlit(byPointer), JSON.stringify(byPointer));
}

/** Every control is disabled while creating, which is no reason for focus to leave. */
async function creatingKeepsFocusInTheDialog() {
  await openCreateDialog();
  await press("Return");
  await until("!!document.querySelector('[role=dialog] [type=submit]:disabled')", "creating to start");
  await wait(Math.round(CREATE_DELAY_MS / 3));
  const held = await evaluate(`({
    body: document.activeElement === document.body,
    inside: ${focusIsIn("[role=dialog]")},
    ring: getComputedStyle(document.activeElement).outlineStyle,
  })`);
  check("Creating keeps focus in the dialog", held.inside && !held.body, JSON.stringify(held));
  await wait(CREATE_DELAY_MS);
}

async function main() {
  await app.whenReady();
  Menu.setApplicationMenu(null);
  for (let attempt = 0; attempt < 300 && !BrowserWindow.getAllWindows().length; attempt += 1) await wait(50);
  window = BrowserWindow.getAllWindows()[0];
  assert.ok(window, "production Main created a window");
  window.setContentSize(1200, 800);
  await until("document.querySelectorAll('.onboarding-project-row-wrap').length > 0", "the Homepage");
  // Focus styles need a focused page, and this must not take the screen from whoever is using it.
  window.webContents.debugger.attach("1.3");
  await window.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
  window.webContents.focus();
  await wait(400);

  await everyProjectIsListed();
  await aClosedDialogLightsNothing();
  await theListIsOneTabStop();
  await focusComesBackToTheProject();
  await creatingKeepsFocusInTheDialog();

  assert.deepEqual(failures, [], "the Homepage's interaction checks failed");
  console.log("Homepage interaction smoke passed.");
}

await initialize();
main().then(async () => {
  clearTimeout(guard);
  await server.close();
  app.exit(0);
}).catch(async (error) => {
  console.error(error.message);
  await server?.close();
  app.exit(1);
});
