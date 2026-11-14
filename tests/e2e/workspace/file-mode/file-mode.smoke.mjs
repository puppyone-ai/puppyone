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
/** The file window's Header: the product Header, above the document. */
const HEADER = ".file-mode-window > .desktop-titlebar";
/**
 * Source of a page function that opens a Header menu and resolves with it, or null. An editor
 * taking focus as it mounts closes a menu opened that moment, so press again until it stays.
 */
const openMenu = `(async (trigger, menuSelector) => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const menu = document.querySelector(menuSelector);
    if (menu && trigger.getAttribute("aria-expanded") === "true") return menu;
  }
  return null;
})`;
/** The editor's controls in the Header: one button per control, the view menu's options, the settings menu's items. Controls left inside the editor are reported, not hidden. */
const headerControls = (window) => evaluate(window, `(async () => {
  if (document.querySelector(".file-mode-window__document :is(.csv-table-editor__settings, .html-editor-options)")) return "inside the editor";
  const actions = document.querySelector("${HEADER} .desktop-titlebar-actions");
  const settle = () => new Promise((resolve) => setTimeout(resolve, 300));
  const count = async (trigger, menuSelector, itemSelector) => {
    if (!trigger) return 0;
    const found = (await ${openMenu}(trigger, menuSelector))?.querySelectorAll(itemSelector).length ?? -1;
    trigger.click();
    await settle();
    return found;
  };
  const buttons = [...actions.querySelectorAll("button")];
  return {
    buttons: buttons.length,
    // Header commands, in sight without the pointer anywhere near, at the project Header's icon size.
    headerCommands: buttons.every((button) => button.classList.contains("desktop-titlebar-action")
      && getComputedStyle(button).opacity === "1" && button.querySelector("svg").getBoundingClientRect().width === 15),
    views: await count(actions.querySelector(".file-mode-window__view-mode"), ".desktop-editor-view-mode-menu", "[role=menuitemradio]"),
    settings: await count(actions.querySelector(".file-mode-window__settings"), ".desktop-editor-pane-menu:not(.desktop-editor-view-mode-menu)", "[role^=menuitem]"),
  };
})()`);
/** Clicks the middle of `selector` with the real mouse. */
async function clickWithMouse(window, selector) {
  const { x, y } = await evaluate(window, `(() => {
    const { left, top, width, height } = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: Math.round(left + width / 2), y: Math.round(top + height / 2) };
  })()`);
  for (const type of ["mouseDown", "mouseUp"]) window.webContents.sendInputEvent({ type, x, y, button: "left", clickCount: 1 });
  await wait(300);
}
/** Picks a view from the Header's view menu by its place in the list. */
const chooseView = (window, index) => evaluate(window, `(async () => {
  const menu = await ${openMenu}(document.querySelector("${HEADER} .file-mode-window__view-mode"), ".desktop-editor-view-mode-menu");
  menu.querySelectorAll("[role=menuitemradio]")[${index}].click();
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
  await fs.writeFile(inDocs("wide-code.md"), `# Wide code\n\n\`\`\`js\nconst first = 1;\nconst line = "${"x".repeat(400)}";\nconst last = 3;\n\`\`\`\n\n$$\n${"a+".repeat(200)}a\n$$\n`);
  await fs.writeFile(inDocs("rows.csv"), `name,amount\n${"Ada,100\n".repeat(300)}`);
  await fs.writeFile(inDocs("plain-rows.csv"), "Ada,London\n".repeat(300));
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
  check("Header names the file", await evaluate(window, `document.querySelector("${HEADER} .desktop-titlebar-context-name").textContent`), "plan.md");
  if (process.platform === "darwin") {
    // As in a project window: the name starts where the project Header's content does, clear of the traffic lights.
    check("the name starts where a project's does", await evaluate(window, `document.querySelector("${HEADER} .desktop-titlebar-context-item").getBoundingClientRect().left`), 86);
  }
  check("Header can drag the window", await evaluate(window, `getComputedStyle(document.querySelector("${HEADER}")).webkitAppRegion`), "drag");
  check("Header draws the project Header's divider", await evaluate(window, `getComputedStyle(document.querySelector("${HEADER}"), "::after").content !== "none"`));
  check("the document starts below the Header", await evaluate(window, `document.querySelector(".file-mode-window__document").getBoundingClientRect().top === document.querySelector("${HEADER}").getBoundingClientRect().bottom`));
  check("Markdown shows its current view in the Header", await headerControls(window), { buttons: 1, headerCommands: true, views: 2, settings: 0 });
  await clickWithMouse(window, ".file-mode-window__view-mode");
  await clickWithMouse(window, '.desktop-editor-view-mode-menu [role=menuitemradio][aria-checked="true"]');
  check("the view menu closes after a mouse pick", await exists(window, ".desktop-editor-view-mode-menu"), false);
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
  check("Markdown switches between rendered and source from the Header", true);
  check("switching views leaves the file unchanged", await read(inDocs("plan.md")), beforeViews);
  check("document uses the window width", await evaluate(window, `document.querySelector(".cm-editor").getBoundingClientRect().width === innerWidth`));
  await screenshot(window, "markdown");

  // A name too long for the Header gives way before it reaches the traffic lights or the file's controls.
  const long = await openAndWait(inDocs(LONG_NAME), ".cm-editor");
  long.setSize(720, 520);
  await wait(300);
  check("a long name gives way before the window's controls and the file's", await evaluate(long, `(() => {
    const name = document.querySelector("${HEADER} .desktop-titlebar-context-name");
    const { left, right } = name.getBoundingClientRect();
    const control = document.querySelector("${HEADER} .desktop-titlebar-actions button").getBoundingClientRect();
    return name.scrollWidth > name.clientWidth && left >= ${process.platform === "darwin" ? 86 : 6} && right <= control.left;
  })()`));
  await screenshot(long, "long-name");
  await closeAndWait(long);
  await scrollbars();
  return window;
}

/** Scrollers in the window that overflow but are left to the platform's native scrollbar. */
const nativeScrollers = (window) => evaluate(window, `[...document.querySelectorAll("*")].filter((element) => {
  const { overflowX, overflowY } = getComputedStyle(element);
  const scrolls = (/auto|scroll/.test(overflowX) && element.scrollWidth > element.clientWidth + 1)
    || (/auto|scroll/.test(overflowY) && element.scrollHeight > element.clientHeight + 1);
  return scrolls && !element.hasAttribute("data-po-scrollbar");
}).map((element) => element.tagName.toLowerCase() + "." + [...element.classList].join("."))`);

/** One scrollbar throughout: wide blocks scroll sideways on the product scrollbar, and a code block's hides none of its lines. */
async function scrollbars() {
  const window = await openAndWait(inDocs("wide-code.md"), ".cm-md-code-textarea");
  await until(() => exists(window, ".cm-md-math-block-widget"), "the wide formula");
  await wait(300);
  check("a wide code block scrolls sideways on the product scrollbar without hiding a line", await evaluate(window, `(() => {
    const code = document.querySelector(".cm-md-code-textarea");
    return { scrollbar: code.dataset.poScrollbar, overflows: code.scrollWidth > code.clientWidth, linesHidden: code.scrollHeight > code.clientHeight };
  })()`), { scrollbar: "horizontal", overflows: true, linesHidden: false });
  check("a wide formula scrolls sideways on the product scrollbar", await evaluate(window, `(() => {
    const math = document.querySelector(".cm-md-math-block-widget");
    return { scrollbar: math.dataset.poScrollbar, overflows: math.scrollWidth > math.clientWidth };
  })()`), { scrollbar: "horizontal", overflows: true });
  check("nothing in a Markdown window scrolls on the native scrollbar", await nativeScrollers(window), []);
  await screenshot(window, "wide-code");
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
  check("CSV settings sit behind the Header menu", await headerControls(window), { buttons: 1, headerCommands: true, views: 0, settings: 4 });
  await evaluate(window, `(() => {
    const cell = document.querySelector('input[data-csv-row="1"][data-csv-column="1"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(cell, "Paris");
    cell.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await until(async () => (await read(inDocs("table.csv"))).includes("Paris"), "the CSV edit to reach the file");
  check("CSV edit saves itself and keeps its line endings", await read(inDocs("table.csv")), "name,city\r\nAda,Paris\r\n");
  await closeAndWait(window);
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
  check("HTML shows its current view in the Header", await headerControls(window), { buttons: 1, headerCommands: true, views: 3, settings: 0 });
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

/** An HTML page sits below the Header and scrolls inside its own frame on the product scrollbar. */
async function htmlScrolling() {
  const page = await openAndWait(path.join(site, "long-page.html"), "iframe");
  const frame = await pageFrame(page, "#banner");
  check("a page without scrollbar styles of its own gets the product scrollbar", await frame.executeJavaScript(`!!document.getElementById("puppyone-html-page-scrollbar")`));
  check("a page starts below the Header", await evaluate(page, `document.querySelector(".file-mode-window__document iframe").getBoundingClientRect().top >= document.querySelector("${HEADER}").getBoundingClientRect().bottom`));
  await frame.executeJavaScript(`scrollTo(0, 430)`);
  await until(() => frame.executeJavaScript("scrollY > 0"), "the page to scroll");
  await wait(250);
  await screenshot(page, "html-scrolled");
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
  // One Header in both windows: its fill, divider, height and the name's type.
  const look = (target, header, name) => evaluate(target, `(() => {
    const style = (selector, properties, pseudo) => { const computed = getComputedStyle(document.querySelector(selector), pseudo); return properties.map((property) => computed[property]); };
    return [
      ...style(${JSON.stringify(header)}, ["height", "backgroundColor"]),
      ...style(${JSON.stringify(header)}, ["backgroundColor"], "::after"),
      ...style(${JSON.stringify(name)}, ["color", "fontFamily", "fontSize", "fontWeight", "lineHeight"]),
    ].join(" | ");
  })()`);
  check("file and project windows share one Header",
    await look(window, HEADER, ".desktop-titlebar-context-name"),
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
  check("the document takes the sub-theme's colour", await evaluate(window, `${visibleColour}(document.querySelector(".markdown-codemirror-editor"))`), before === "dark" ? "rgb(255, 255, 255)" : "rgb(13, 17, 23)");
  check("the Header takes the sub-theme's Header colour", await evaluate(window, `(() => {
    const probe = document.createElement("div");
    probe.style.background = "var(--po-header)";
    document.querySelector(".file-mode-window").append(probe);
    const expected = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return getComputedStyle(document.querySelector("${HEADER}")).backgroundColor === expected;
  })()`));
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
      windowAuthority, routing, savingAndOutsideChanges, csv, dataSafety, html, htmlScrolling, closing, projectWindows,
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
