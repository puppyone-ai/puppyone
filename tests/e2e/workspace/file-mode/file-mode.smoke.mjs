#!/usr/bin/env electron
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, Menu } from "electron";
import { workspaceFromPath } from "../../../../electron/local-api/workspace.mjs";
import { createWorkspaceStateStore } from "../../../../electron/main/workspace-state-store.mjs";
import { getDesktopBuildChannelPolicy } from "../../../../shared/desktop-build-identity.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporaryRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-file-mode-")));
const reportDirectory = path.join(repoRoot, "artifacts/tests/file-mode", new Date().toISOString().replaceAll(":", "-"));
await fs.mkdir(reportDirectory, { recursive: true });
app.setAppPath(repoRoot);
app.setPath("appData", temporaryRoot);
app.setPath("userData", path.join(temporaryRoot, getDesktopBuildChannelPolicy("dev").userDataName));
await fs.mkdir(app.getPath("userData"), { recursive: true });

// Real windows, but out of the way: nothing here should take the keyboard from a developer.
const { show } = BrowserWindow.prototype;
BrowserWindow.prototype.show = function quietShow() { this.setOpacity(0); this.showInactive(); };
BrowserWindow.prototype.focus = () => undefined;
app.focus = () => undefined;
void show;

const report = { ok: false, stage: "fixtures", checks: {}, asked: [], error: null };
const LONG_NAME = "a file name long enough to reach the window controls on both sides of a narrow title bar.md";
const docs = path.join(temporaryRoot, "docs");
const site = path.join(temporaryRoot, "site");
const inDocs = (name) => path.join(docs, name);
const read = (file) => fs.readFile(file, "utf8");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const guard = setTimeout(() => { console.error(`File Mode check timed out during: ${report.stage}`); finish(1); }, 180_000);
let server;

function check(name, actual, expected = true) {
  report.checks[name] = actual;
  assert.deepEqual(actual, expected, name);
}

async function until(probe, label, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const value = await probe();
      if (value) return value;
    } catch { /* The page may be mid-navigation; try again. */ }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await wait(40);
  }
}

const evaluate = (window, source) => window.webContents.executeJavaScript(source, true);
const exists = (window, selector) => evaluate(window, `!!document.querySelector(${JSON.stringify(selector)})`);
const windows = () => BrowserWindow.getAllWindows();
const windowNamed = (title) => windows().find((window) => !window.isDestroyed() && window.getTitle() === title);
const openFromSystem = (target) => app.emit("open-file", { preventDefault() {} }, target);
/** The editor's controls in the title bar: one button per control, the view menu's options, the settings menu's items. Controls left inside the editor are reported, not hidden. */
const titlebarControls = (window) => evaluate(window, `(async () => {
  if (document.querySelector(".file-mode-window__document :is(.csv-table-editor__settings, .html-editor-options)")) return "inside the editor";
  const bar = document.querySelector(".file-mode-window__titlebar");
  const settle = () => new Promise((resolve) => setTimeout(resolve, 300));
  const count = async (trigger, menuSelector, itemSelector) => {
    if (!trigger) return 0;
    trigger.click();
    await settle();
    const found = document.querySelector(menuSelector)?.querySelectorAll(itemSelector).length ?? -1;
    trigger.click();
    await settle();
    return found;
  };
  // At rest an icon is the name's ink, a shade lighter.
  const alpha = (colour) => Number(/[/,]\\s*([\\d.]+)\\)$/.exec(colour)?.[1] ?? 1);
  const name = getComputedStyle(bar.querySelector(".file-mode-window__name")).color;
  return {
    buttons: bar.querySelectorAll("button").length,
    iconsLighterThanTheName: [...bar.querySelectorAll("button svg")].every((icon) => icon.getBoundingClientRect().width === 15 && alpha(getComputedStyle(icon).color) < alpha(name)),
    views: await count(bar.querySelector(".file-mode-window__view-mode"), ".desktop-editor-view-mode-menu", "[role=menuitemradio]"),
    settings: await count(bar.querySelector(".file-mode-window__action:not(.file-mode-window__view-mode)"), ".desktop-editor-pane-menu:not(.desktop-editor-view-mode-menu)", "[role^=menuitem]"),
  };
})()`);
/** Moves the real pointer to `fraction` of the window's height and reports whether the file's controls show. */
async function controlsShowWithPointerAt(window, fraction) {
  const [width, height] = window.getContentSize();
  window.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(width / 2), y: Math.round(height * fraction) });
  await wait(250);
  return evaluate(window, `getComputedStyle(document.querySelector(".file-mode-window__controls")).opacity === "1"`);
}
/** Clicks the middle of `selector` with the real mouse. */
async function clickWithMouse(window, selector) {
  const { x, y } = await evaluate(window, `(() => {
    const { left, top, width, height } = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: Math.round(left + width / 2), y: Math.round(top + height / 2) };
  })()`);
  for (const type of ["mouseDown", "mouseUp"]) window.webContents.sendInputEvent({ type, x, y, button: "left", clickCount: 1 });
  await wait(300);
}
/** Picks a view from the title bar's view menu by its place in the list. */
const chooseView = (window, index) => evaluate(window, `(async () => {
  document.querySelector(".file-mode-window__titlebar .file-mode-window__view-mode").click();
  await new Promise((resolve) => setTimeout(resolve, 300));
  document.querySelectorAll(".desktop-editor-view-mode-menu [role=menuitemradio]")[${index}].click();
})()`);
/** Source of a page function: the colour an element shows, from itself or the nearest painted ancestor. */
const visibleColour = `((element) => { for (; element; element = element.parentElement) { const colour = getComputedStyle(element).backgroundColor; if (colour !== "rgba(0, 0, 0, 0)") return colour; } return null; })`;
const editorText = (window) => evaluate(window, `document.querySelector(".cm-content")?.innerText ?? ""`);
async function type(window, text) {
  await evaluate(window, `document.querySelector(".cm-content").focus()`);
  window.webContents.insertText(text);
  await until(async () => (await editorText(window)).includes(text), "the typed text");
}
async function openAndWait(file, selector) {
  const name = path.basename(file);
  openFromSystem(file);
  const window = await until(() => windowNamed(name), `the ${name} window`);
  await until(() => exists(window, selector), `${name} to show`);
  return window;
}
async function closeAndWait(window) {
  window.close();
  await until(() => window.isDestroyed(), "the window to close");
}
async function screenshot(window, name) {
  await fs.writeFile(path.join(reportDirectory, `${name}.png`), (await window.webContents.capturePage()).toPNG());
}
/** The gate logs each refusal. Only the attacks below may appear, or a real feature was cut off. */
const EXPECTED_REFUSALS = [
  "agent:session-create",
  "terminal:create",
  "workspace:delete-entry",
  "workspace:get-file-url",
  "workspace:list-folder-children",
  "workspace:read-file",
  "workspace:write-file",
];
const refusals = new Set();
for (const level of ["warn", "error"]) {
  const write = console[level];
  console[level] = (...values) => {
    const refused = /(?:handler for '|untrusted IPC event on )([\w-]+:[\w-]+)/.exec(String(values[0]))?.[1];
    if (refused && values.some((value) => String(value).includes("not available in this window"))) refusals.add(refused);
    write(...values);
  };
}

/** Every question the app asks is recorded; a File Mode window should ask none. */
dialog.showMessageBox = async (_window, options) => {
  report.asked.push(options.message);
  return { response: 0 };
};

async function prepareFixtures() {
  await fs.mkdir(path.join(docs, "images"), { recursive: true });
  await fs.mkdir(path.join(site, "sub"), { recursive: true });
  const project = path.join(temporaryRoot, "last-project");
  await fs.mkdir(project);
  await fs.writeFile(path.join(project, "note.md"), "# Last project\n");
  await fs.writeFile(inDocs("images/dot.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNkYPhfz0AEYBxVSF+FAAhKDveksOjmAAAAAElFTkSuQmCC", "base64"));
  await fs.writeFile(inDocs("plan.md"), "# Plan\n\nBody.\n\n![dot](./images/dot.png)\n\n```mermaid\ngraph TD\n  A --> B\n```\n");
  // The numbers make the first row read as a header; plain rows have none.
  await fs.writeFile(inDocs("rows.csv"), `name,amount\n${"Ada,100\n".repeat(300)}`);
  await fs.writeFile(inDocs("plain-rows.csv"), "Ada,London\n".repeat(300));
  await fs.writeFile(inDocs("long.md"), `# Long\n\n${"A paragraph long enough to scroll under the title bar.\n\n".repeat(80)}`);
  for (const name of ["save.md", "clean.md", "second.md", "theme.md", LONG_NAME]) {
    await fs.writeFile(inDocs(name), `# ${name}\n`);
  }
  await fs.writeFile(inDocs("secret.txt"), "FAKE-SECRET\n");
  await fs.writeFile(inDocs("table.csv"), "name,city\r\nAda,London\r\n");
  // 姓名,金额\n张三,100\n in GBK, as Excel writes it on a Chinese system.
  await fs.writeFile(inDocs("gbk.csv"), Buffer.from("d0d5c3fb2cbdf0b6ee0ad5c5c8fd2c3130300a", "hex"));
  await fs.writeFile(inDocs("big.csv"), "a,b,c,d\n".repeat(200_000));
  await fs.writeFile(inDocs("report.pdf"), "%PDF-1.4\n");
  await fs.writeFile(path.join(site, "secret.txt"), "FAKE-SECRET\n");
  await fs.writeFile(path.join(site, "data.json"), '{"secret":"FAKE-SECRET"}\n');
  await fs.writeFile(path.join(site, "sub", "deep.txt"), "FAKE-SECRET\n");
  await fs.writeFile(path.join(site, "style.css"), "h1 { color: rgb(0, 187, 102); }\n");
  await fs.writeFile(path.join(site, "long-page.html"), `<!doctype html><html><head><meta charset="utf-8"></head><body>
<h1 id="banner">Long page</h1>${"<p>A paragraph long enough to scroll under the title bar.</p>".repeat(120)}</body></html>`);
  await fs.writeFile(path.join(site, "page.html"), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head>
<body><h1 id="title">Page</h1><pre id="out">running</pre><script>
(async () => {
  const attempt = async (name, read) => { try { return [name, "READ:" + String(await read()).slice(0, 40)]; } catch { return [name, "BLOCKED"]; } };
  const xhr = (url) => new Promise((resolve, reject) => { const request = new XMLHttpRequest(); request.onload = () => resolve(request.responseText); request.onerror = reject; request.open("GET", url); request.send(); });
  const results = await Promise.all([
    attempt("fetch sibling", () => fetch("secret.txt").then((response) => response.text())),
    attempt("fetch nested", () => fetch("sub/deep.txt").then((response) => response.text())),
    attempt("xhr sibling", () => xhr("secret.txt")),
    attempt("json module", () => import(new URL("data.json", document.baseURI).href, { with: { type: "json" } }).then((module) => JSON.stringify(module.default))),
  ]);
  document.getElementById("out").textContent = JSON.stringify(Object.fromEntries(results));
})();
</script></body></html>
`);
  const registry = createWorkspaceStateStore({ app, filename: "desktop-workspace-state.json", canonicalizeWorkspacePath: async (value) => value });
  await registry.rememberWorkspaceComposition([await workspaceFromPath(project)]);
}

async function startApplication() {
  const { createServer } = await import("vite");
  server = await createServer({
    root: repoRoot, cacheDir: path.join(temporaryRoot, "vite-cache"), logLevel: "error",
    define: {
      "import.meta.env.VITE_DESKTOP_CLOUD_API_URL": JSON.stringify("http://127.0.0.1:9/api/v1"),
      "import.meta.env.VITE_DESKTOP_CLOUD_WEB_URL": JSON.stringify("http://127.0.0.1:9"),
    },
    server: { host: "127.0.0.1", port: 5382, strictPort: false, hmr: false, watch: null, fs: { allow: [repoRoot, await fs.realpath(path.join(repoRoot, "node_modules"))] } },
  });
  await server.listen();
  process.env.PUPPYONE_DESKTOP_DEV_URL = `http://127.0.0.1:${server.httpServer.address().port}`;
  process.env.VITE_DESKTOP_CLOUD_API_URL = "http://127.0.0.1:9/api/v1";
  process.env.VITE_DESKTOP_CLOUD_WEB_URL = "http://127.0.0.1:9";
  app.on("browser-window-created", (_event, window) => window.webContents.setBackgroundThrottling(false));
  report.stage = "loading the main process";
  await import("../../../../electron/main.mjs");
  // Before ready, exactly when macOS delivers a double-clicked file to a cold app.
  openFromSystem(inDocs("plan.md"));
}

async function coldStart() {
  const window = await until(() => windows()[0], "the first window");
  await until(() => exists(window, ".cm-editor"), "the document", 90_000);
  check("cold start shows only the file, not the last project", windows().length, 1);
  check("window is in File Mode", window.webContents.getURL().endsWith("#file-mode"));
  check("title is the file name", window.getTitle(), "plan.md");
  check("title bar names the file", await evaluate(window, `document.querySelector(".file-mode-window__name").textContent`), "plan.md");
  // macOS draws its traffic lights over the left of this bar; the name starts where the project titlebar's content does.
  check("title sits in the middle of the window", await evaluate(window, `(() => { const { left, right } = document.querySelector(".file-mode-window__name").getBoundingClientRect(); return Math.abs((left + right) / 2 - innerWidth / 2) <= 1; })()`));
  check("title bar shares the document's colour", await evaluate(window, `${visibleColour}(document.querySelector(".file-mode-window__titlebar")) === getComputedStyle(document.querySelector(".markdown-codemirror-editor")).backgroundColor`));
  check("title bar can drag the window", await evaluate(window, `getComputedStyle(document.querySelector(".file-mode-window__titlebar")).webkitAppRegion`), "drag");
  check("Markdown shows its current view in the title bar", await titlebarControls(window), { buttons: 1, iconsLighterThanTheName: true, views: 2, settings: 0 });
  // Like a project pane's chrome, the controls keep out of the way until the pointer comes near the top.
  check("title bar controls stay hidden while reading lower down", await controlsShowWithPointerAt(window, 0.6), false);
  check("title bar controls show in the top third of the window", await controlsShowWithPointerAt(window, 0.2), true);
  await screenshot(window, "controls-revealed");
  check("title bar controls hide again below it", await controlsShowWithPointerAt(window, 0.4), false);
  await evaluate(window, `document.querySelector(".file-mode-window__view-mode").click()`);
  check("title bar controls stay while their menu is open", await controlsShowWithPointerAt(window, 0.6), true);
  await evaluate(window, `document.querySelector(".file-mode-window__view-mode").click()`);
  check("title bar controls hide once the menu closes", await controlsShowWithPointerAt(window, 0.6), false);
  // Picking a view with the mouse leaves focus on the control, but no reason to keep it in sight.
  await controlsShowWithPointerAt(window, 0.05);
  await clickWithMouse(window, ".file-mode-window__view-mode");
  await clickWithMouse(window, '.desktop-editor-view-mode-menu [role=menuitemradio][aria-checked="true"]');
  check("the view menu closes after a mouse pick", await exists(window, ".desktop-editor-view-mode-menu"), false);
  check("title bar controls hide below the top third after a mouse pick", await controlsShowWithPointerAt(window, 0.6), false);
  check("project shell is not mounted", await exists(window, ".desktop-editor-pane"), false);
  check("project application is not loaded", await evaluate(window, `performance.getEntriesByType("resource").some((entry) => /\\/src\\/App\\.tsx/.test(entry.name))`), false);
  await until(() => evaluate(window, `[...document.querySelectorAll("img")].some((image) => image.complete && image.naturalWidth > 0)`), "the relative image");
  check("relative image shows", true);
  await until(() => exists(window, ".cm-md-mermaid-svg-root"), "the Mermaid diagram");
  check("Mermaid shows", true);
  const beforeViews = await read(inDocs("plan.md"));
  await chooseView(window, 1);
  await until(async () => !(await exists(window, ".cm-md-mermaid-svg-root")), "the Markdown source view");
  await chooseView(window, 0);
  await until(() => exists(window, ".cm-md-mermaid-svg-root"), "the rendered Markdown again");
  check("Markdown switches between rendered and source from the title bar", true);
  check("switching views leaves the file unchanged", await read(inDocs("plan.md")), beforeViews);
  check("document uses the window width", await evaluate(window, `document.querySelector(".cm-editor").getBoundingClientRect().width === innerWidth`));
  await screenshot(window, "markdown");

  // A name too long for the bar gives way on both sides before it reaches the traffic lights or the file's controls.
  const long = await openAndWait(inDocs(LONG_NAME), ".cm-editor");
  long.setSize(720, 520);
  await wait(300);
  check("a long title gives way before the window's controls and the file's", await evaluate(long, `(() => {
    const name = document.querySelector(".file-mode-window__name");
    const { left, right } = name.getBoundingClientRect();
    const control = document.querySelector(".file-mode-window__titlebar button").getBoundingClientRect();
    return name.scrollWidth > name.clientWidth && left >= ${process.platform === "darwin" ? 86 : 6} && right <= control.left;
  })()`));
  await closeAndWait(long);
  await scrollEdge();
  return window;
}

/** Whether the document is scrolled under the title bar, and whether it fades there. */
const scrollEdgeOf = (window) => evaluate(window, `(() => {
  const surface = document.querySelector(".file-mode-window__document");
  return { scrolled: surface.hasAttribute("data-scrolled"), masked: getComputedStyle(surface).maskImage !== "none" };
})()`);

/** No divider under the bar: text scrolled up under it fades out, and only once the document has left its top. */
async function scrollEdge() {
  const window = await openAndWait(inDocs("long.md"), ".cm-scroller");
  const edge = () => scrollEdgeOf(window);
  const scrollTo = (top) => evaluate(window, `document.querySelector(".cm-scroller").scrollTop = ${top}`);
  check("title bar draws no divider", await evaluate(window, `getComputedStyle(document.querySelector(".file-mode-window__titlebar"), "::after").content`), "none");
  check("nothing fades at the top of the document", await edge(), { scrolled: false, masked: false });
  // Leaves a line half under the bar, where the fade shows.
  await scrollTo(430);
  await until(async () => (await edge()).masked, "the edge to fade");
  check("text scrolled under the title bar fades out", await edge(), { scrolled: true, masked: true });
  await wait(250);
  await screenshot(window, "scrolled-under-title-bar");
  await scrollTo(0);
  await until(async () => !(await edge()).scrolled, "the edge to clear");
  check("back at the top, nothing fades", await edge(), { scrolled: false, masked: false });
  await closeAndWait(window);
}

async function savingAndOutsideChanges(window) {
  const file = inDocs("plan.md");
  const original = await read(file);
  // As in a project window: what is typed is in the file, with no save step and nothing asking to save.
  await type(window, "typed ");
  await until(async () => (await read(file)).includes("typed "), "the edit to reach the file");
  check("edits reach the file as they are typed", (await read(file)).replace("typed ", ""), original);
  await wait(300);
  check("nothing shows a save step", await exists(window, ".editor-save-overlay"), false);
  check("the window is never marked unsaved", window.isDocumentEdited(), false);

  await fs.appendFile(file, "\nchanged outside\n");
  await evaluate(window, `window.dispatchEvent(new Event("focus"))`);
  await until(async () => (await editorText(window)).includes("changed outside"), "the outside change");
  check("outside change shows on return", true);

  await type(window, "more ");
  await until(async () => (await read(file)).includes("more "), "the next edit to reach the file");
  check("editing after an outside change keeps it", (await read(file)).includes("changed outside"));
}

async function windowAuthority(window) {
  const attempt = (call) => evaluate(window, `(async () => { const desktop = window.puppyoneDesktop; try { await ${call}; return "allowed"; } catch { return "refused"; } })()`);
  const root = JSON.stringify(docs);
  check("reads the bound file", await attempt(`desktop.readFile({ rootPath: ${root}, path: "plan.md" })`), "allowed");
  check("reads Markdown media", await attempt(`desktop.getFileUrl({ rootPath: ${root}, path: "images/dot.png", purpose: "markdown-asset" })`), "allowed");
  check("refuses reading a neighbour", await attempt(`desktop.readFile({ rootPath: ${root}, path: "secret.txt" })`), "refused");
  check("refuses a URL for a neighbour", await attempt(`desktop.getFileUrl({ rootPath: ${root}, path: "secret.txt", purpose: "markdown-asset" })`), "refused");
  check("refuses writing a neighbour", await attempt(`desktop.writeFile({ rootPath: ${root}, path: "secret.txt", content: "x" })`), "refused");
  check("refuses listing the folder", await attempt(`desktop.listFolderChildren({ rootPath: ${root}, folderPath: null })`), "refused");
  check("refuses deleting", await attempt(`desktop.deleteEntry({ rootPath: ${root}, path: "secret.txt" })`), "refused");
  check("refuses a terminal", await attempt(`desktop.createTerminal({})`), "refused");
  check("refuses an Agent session", await attempt(`desktop.createAgentSession({})`), "refused");
  check("neighbour is untouched", await read(inDocs("secret.txt")), "FAKE-SECRET\n");
}

async function routing(window) {
  const count = windows().length;
  openFromSystem(inDocs("plan.md"));
  await wait(400);
  check("reopening focuses the existing window", windows().length, count);
  openFromSystem(inDocs("report.pdf"));
  await wait(400);
  check("unsupported format opens nothing", windows().length, count);
  openFromSystem(inDocs("missing.md"));
  await wait(400);
  check("missing file opens nothing", windows().length, count);
  check("first window survives bad requests", window.isDestroyed(), false);
  app.emit("second-instance", {}, [], temporaryRoot, { version: 2, workspacePath: null, filePath: inDocs("second.md") });
  const second = await until(() => windowNamed("second.md"), "the window from a second instance");
  await until(() => exists(second, ".cm-editor"), "its document");
  check("a file from a second instance opens", true);
  await closeAndWait(second);
}

async function csv() {
  const window = await openAndWait(inDocs("table.csv"), ".csv-table-editor__table");
  await screenshot(window, "csv");
  check("CSV settings sit behind the title bar menu", await titlebarControls(window), { buttons: 1, iconsLighterThanTheName: true, views: 0, settings: 4 });
  await evaluate(window, `(() => {
    const cell = document.querySelector('input[data-csv-row="1"][data-csv-column="1"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(cell, "Paris");
    cell.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await until(async () => (await read(inDocs("table.csv"))).includes("Paris"), "the CSV edit to reach the file");
  check("CSV edit saves itself and keeps its line endings", await read(inDocs("table.csv")), "name,city\r\nAda,Paris\r\n");
  await closeAndWait(window);

  for (const [file, selector, masked, name] of [
    ["rows.csv", ".csv-table-editor__table thead", false, "a table's pinned header row does not fade"],
    ["plain-rows.csv", ".csv-table-editor__table tbody", true, "rows without a header fade under the title bar"],
  ]) {
    const rows = await openAndWait(inDocs(file), selector);
    await evaluate(rows, `document.querySelector(".csv-table-editor__scroll").scrollTop = 400`);
    await until(async () => (await scrollEdgeOf(rows)).scrolled, `${file} to scroll under the title bar`);
    check(name, await scrollEdgeOf(rows), { scrolled: true, masked });
    await wait(250);
    await screenshot(rows, `${file}-scrolled`);
    await closeAndWait(rows);
  }
}

async function dataSafety() {
  const before = await fs.readFile(inDocs("gbk.csv"));
  const legacy = await openAndWait(inDocs("gbk.csv"), ".csv-table-editor__table");
  check("legacy text is readable", await evaluate(legacy, `document.querySelector('input[data-csv-row="1"][data-csv-column="0"]').value`), "张三");
  check("legacy file explains itself", await exists(legacy, ".file-mode-window__notice"));
  check("legacy file cannot be edited", await evaluate(legacy, `document.querySelector('input[data-csv-row="1"][data-csv-column="0"]').readOnly`));
  await screenshot(legacy, "legacy-encoding");
  await closeAndWait(legacy);
  check("legacy file bytes are unchanged", Buffer.compare(before, await fs.readFile(inDocs("gbk.csv"))), 0);

  const large = await openAndWait(inDocs("big.csv"), '[role="alert"]');
  check("large file says why it cannot open", await evaluate(large, `document.querySelector('[role="alert"]').textContent.includes("1 MB")`));
  await closeAndWait(large);
}

async function html() {
  const window = await openAndWait(path.join(site, "page.html"), "iframe");
  const frame = await until(() => window.webContents.mainFrame.framesInSubtree.find((candidate) => candidate !== window.webContents.mainFrame && candidate.url.startsWith("puppyone-local:")), "the page frame");
  const results = await until(async () => {
    const text = await frame.executeJavaScript(`document.getElementById("out").textContent`);
    return text === "running" ? null : JSON.parse(text);
  }, "the page probes");
  check("page scripts cannot read local files", results, {
    "fetch sibling": "BLOCKED", "fetch nested": "BLOCKED", "xhr sibling": "BLOCKED", "json module": "BLOCKED",
  });
  check("HTML shows its current view in the title bar", await titlebarControls(window), { buttons: 1, iconsLighterThanTheName: true, views: 3, settings: 0 });
  check("page still loads its own stylesheet", await frame.executeJavaScript(`getComputedStyle(document.getElementById("title")).color`), "rgb(0, 187, 102)");
  const area = await evaluate(window, `(() => { const { width, height } = document.querySelector("iframe").getBoundingClientRect(); return { width, height, windowWidth: innerWidth, windowHeight: innerHeight }; })()`);
  report.htmlArea = area;
  check("page fills the document area", area.width === area.windowWidth && area.height > area.windowHeight * 0.8);
  check("page content has real height", await frame.executeJavaScript(`document.getElementById("title").getBoundingClientRect().height > 0 && document.documentElement.clientHeight > 300`));
  await wait(800);
  await screenshot(window, "html");
  await closeAndWait(window);
}

/** The frame showing an HTML page, once its document has `selector`. A view switch replaces it. */
async function pageFrame(window, selector, exclude = null) {
  return until(async () => {
    for (const candidate of window.webContents.mainFrame.framesInSubtree) {
      if (candidate === window.webContents.mainFrame || candidate === exclude || !candidate.url.startsWith("puppyone-local:")) continue;
      if (await candidate.executeJavaScript(`!!document.querySelector(${JSON.stringify(selector)})`).catch(() => false)) return candidate;
    }
    return null;
  }, "the page frame");
}

/**
 * Moves the pointer inside the page's own frame, where a real mouse over the page is seen (the window
 * itself is not told), and reports whether the file's controls show. null leaves the page.
 */
async function controlsShowWithPagePointerAt(window, frame, fraction) {
  const [width, height] = window.getContentSize();
  const top = await evaluate(window, `document.querySelector(".file-mode-window__document iframe").getBoundingClientRect().top`);
  await frame.executeJavaScript(fraction === null
    ? `document.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: null }))`
    : `document.body.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: ${Math.round(width / 2)}, clientY: ${Math.round(height * fraction - top)} }))`);
  await wait(250);
  return evaluate(window, `getComputedStyle(document.querySelector(".file-mode-window__controls")).opacity === "1"`);
}

/** An HTML page scrolls and takes the pointer inside its own frame; the window treats it as it treats Markdown. */
async function htmlEdges() {
  const page = await openAndWait(path.join(site, "long-page.html"), "iframe");
  let frame = await pageFrame(page, "#banner");
  for (const view of ["preview", "visual edit"]) {
    check(`${view}: over the page, the title bar controls stay hidden lower down`, await controlsShowWithPagePointerAt(page, frame, 0.6), false);
    check(`${view}: over the page, the title bar controls show in the top third`, await controlsShowWithPagePointerAt(page, frame, 0.2), true);
    check(`${view}: over the page, the title bar controls hide again below it`, await controlsShowWithPagePointerAt(page, frame, 0.6), false);
    await controlsShowWithPagePointerAt(page, frame, 0.2);
    check(`${view}: leaving the page hides the title bar controls`, await controlsShowWithPagePointerAt(page, frame, null), false);
    check(`${view}: nothing fades at the top of the page`, await scrollEdgeOf(page), { scrolled: false, masked: false });
    await frame.executeJavaScript(`scrollTo(0, 430)`);
    await until(async () => (await scrollEdgeOf(page)).masked, `the ${view} edge to fade`);
    check(`${view}: a page scrolled under the title bar fades out`, await scrollEdgeOf(page), { scrolled: true, masked: true });
    await wait(250);
    await screenshot(page, `html-${view.replace(" ", "-")}-scrolled`);
    await frame.executeJavaScript(`scrollTo(0, 0)`);
    await until(async () => !(await scrollEdgeOf(page)).scrolled, `the ${view} edge to clear`);
    check(`${view}: back at the top of the page, nothing fades`, await scrollEdgeOf(page), { scrolled: false, masked: false });
    if (view === "preview") {
      await chooseView(page, 1);
      frame = await pageFrame(page, "[data-puppyone-html-target]", frame);
      await until(() => evaluate(page, `document.querySelector(".html-visual-editor iframe")?.getAttribute("aria-busy") === "false"`), "the visual editor");
    }
  }
  await closeAndWait(page);
}

async function closing() {
  const clean = await openAndWait(inDocs("clean.md"), ".cm-editor");
  await closeAndWait(clean);

  // Closed the moment after typing, before anything else happens: the edit is still saved.
  const save = await openAndWait(inDocs("save.md"), ".cm-editor");
  await evaluate(save, `document.querySelector(".cm-content").focus()`);
  save.webContents.insertText("written ");
  await closeAndWait(save);
  check("closing right after an edit keeps it", (await read(inDocs("save.md"))).includes("written "));
  check("no window asked about saving", report.asked, []);
}

async function projectWindows(window) {
  openFromSystem(docs);
  const project = await until(() => windows().find((candidate) => !candidate.isDestroyed() && !candidate.webContents.getURL().includes("#file-mode") && candidate.webContents.getURL()), "the folder's project window");
  await until(() => exists(project, ".desktop-titlebar-workspace-name"), "the project's title bar", 60_000);
  check("a folder from the system opens as a project", true);
  // The file window draws no divider; its document fades out under the bar instead.
  const look = (target, header, name) => evaluate(target, `(() => {
    const style = (selector, properties) => { const computed = getComputedStyle(document.querySelector(selector)); return properties.map((property) => computed[property]); };
    return [
      ...style(${JSON.stringify(header)}, ["height"]),
      ...style(${JSON.stringify(name)}, ["color", "fontFamily", "fontSize", "fontWeight", "lineHeight"]),
    ].join(" | ");
  })()`);
  check("file and project title bars share size and type",
    await look(window, ".file-mode-window__titlebar", ".file-mode-window__name"),
    await look(project, ".desktop-titlebar", ".desktop-titlebar-workspace-name"));
  check("project windows keep their full access", await evaluate(project, `window.puppyoneDesktop.listFolderChildren({ rootPath: ${JSON.stringify(docs)}, folderPath: null }).then((children) => children.length > 0)`));

  const theme = (target) => evaluate(target, `document.documentElement.dataset.initialTheme`);
  const before = await theme(window);
  await until(() => evaluate(project, `!!localStorage.getItem("puppyone.desktop.appearance")`), "saved appearance preferences");
  await evaluate(project, `(() => {
    const key = "puppyone.desktop.appearance";
    const value = JSON.parse(localStorage.getItem(key));
    const root = value.byRootTheme[value.activeRootThemeId];
    root.requestedColorMode = ${JSON.stringify(before === "dark" ? "light" : "dark")};
    root.requestedSubThemeIds = { light: "default.github", dark: "default.github" };
    localStorage.setItem(key, JSON.stringify(value));
  })()`);
  await until(async () => (await theme(window)) !== before, "the file window to follow the theme", 8_000);
  check("file windows follow theme changes", true);
  // Sub-theme colours only reach elements under an appearance root, as in a project window.
  await until(() => evaluate(window, `document.querySelector(".file-mode-window").dataset.subThemeId === "default.github"`), "the file window to take the sub-theme", 8_000);
  check("title bar takes the sub-theme's document colour", await evaluate(window, `${visibleColour}(document.querySelector(".file-mode-window__titlebar"))`), before === "dark" ? "rgb(255, 255, 255)" : "rgb(13, 17, 23)");
  check("Markdown takes the sub-theme's styles", await evaluate(window, `getComputedStyle(document.querySelector(".markdown-codemirror-editor")).getPropertyValue("--po-host-md-link-color").trim()`), before === "dark" ? "#4183c4" : "#b8c0c8");
  await closeAndWait(project);
}

async function finish(code) {
  clearTimeout(guard);
  await fs.writeFile(path.join(reportDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`).catch(() => undefined);
  for (const window of windows()) window.destroy();
  await server?.close().catch(() => undefined);
  await fs.rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
  app.exit(code);
}

/** What each window was showing, so a failure can be read without rerunning it. */
async function recordWindows() {
  report.windows = [];
  for (const [index, window] of windows().entries()) {
    if (window.isDestroyed()) continue;
    report.windows.push({
      title: window.getTitle(),
      url: window.webContents.getURL(),
      text: await evaluate(window, "document.body.innerText.slice(0, 400)").catch(() => null),
    });
    await screenshot(window, `failure-${index}`).catch(() => undefined);
  }
}

async function fail(error) {
  report.error = error instanceof Error ? error.stack : String(error);
  await recordWindows();
  console.error("File Mode check failed:", report.error);
  await finish(1);
}

// Not awaited here: Electron holds `ready` until this entry module finishes.
async function run() {
  try {
    await app.whenReady();
    Menu.setApplicationMenu(null);
    report.stage = "cold start";
    const window = await coldStart();
    for (const [stage, scenario] of Object.entries({
      windowAuthority, routing, savingAndOutsideChanges, csv, dataSafety, html, htmlEdges, closing, projectWindows,
    })) {
      report.stage = stage;
      await scenario(window);
    }
    check("no window was refused anything it needs", [...refusals].sort(), EXPECTED_REFUSALS);
    report.ok = true;
    console.log(`File Mode: ${Object.keys(report.checks).length} checks passed. Report: ${reportDirectory}`);
    await finish(0);
  } catch (error) {
    await fail(error);
  }
}

// The main process has to load before `ready`, as it does in the real app.
try {
  await prepareFixtures();
  report.stage = "starting the application";
  await startApplication();
  void run();
} catch (error) {
  await fail(error);
}
