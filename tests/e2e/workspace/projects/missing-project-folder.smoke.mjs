#!/usr/bin/env electron
// A project whose folder was renamed on disk, through production Main and the real App:
// on the Homepage before it is opened, and in its window while it is open. Each time the
// App says what happened instead of failing, offers the folder by its new name, and
// carries on from there.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { app, BrowserWindow, Menu } from "electron";
import { workspaceFromPath } from "../../../../electron/local-api/workspace.mjs";
import { createWorkspaceStateStore } from "../../../../electron/main/workspace-state-store.mjs";
import { getDesktopBuildChannelPolicy } from "../../../../shared/desktop-build-identity.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const temporaryRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-missing-folder-")));
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
const guard = setTimeout(() => { console.error("Missing project folder check timed out"); app.exit(1); }, 150_000);
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

// Controls are found as a person with a screen reader meets them: by name, never by class.
const NAMED = `(name) => [...document.querySelectorAll("button, [role=button], [role=menuitem]")]
  .find((element) => (element.getAttribute("aria-label") ?? element.textContent ?? "").replace(/[\\u2066-\\u2069]/g, "").replace(/\\s+/g, " ").trim() === name)`;
const button = (name) => `(${NAMED})(${JSON.stringify(name)})`;
const click = async (name) => {
  await until(`!!${button(name)}`, `the "${name}" button`);
  await evaluate(`${button(name)}.click()`);
};
const text = () => evaluate("document.body.innerText.replace(/[\\u2066-\\u2069]/g, '')");
// The Explorer shows a file's name without its extension.
const FILE_LISTED = "document.body.innerText.split('\\n').includes('note')";

const ORIGINAL = path.join(temporaryRoot, "Plans");
const RENAMED = path.join(temporaryRoot, "Plans 2026");
const FINAL = path.join(temporaryRoot, "Plans final");

async function initialize() {
  const registry = createWorkspaceStateStore({ app, filename: "desktop-workspace-state.json", canonicalizeWorkspacePath: async (value) => value });
  await fs.mkdir(ORIGINAL);
  await fs.writeFile(path.join(ORIGINAL, "note.md"), "# Plans\n");
  await run("git", ["init", "-q"], { cwd: ORIGINAL });
  await registry.rememberWorkspaceComposition([await workspaceFromPath(ORIGINAL)]);
  const statePath = path.join(app.getPath("userData"), "desktop-workspace-state.json");
  await fs.writeFile(statePath, JSON.stringify({ ...JSON.parse(await fs.readFile(statePath, "utf8")), lastActiveWorkspacePaths: [] }));
  // Renamed in Finder while PuppyOne was closed.
  await fs.rename(ORIGINAL, RENAMED);
  const { createServer } = await import("vite");
  server = await createServer({
    root: repoRoot, cacheDir: path.join(temporaryRoot, "vite-cache"), logLevel: "error",
    define: {
      "import.meta.env.VITE_DESKTOP_CLOUD_API_URL": JSON.stringify("http://127.0.0.1:9/api/v1"),
      "import.meta.env.VITE_DESKTOP_CLOUD_WEB_URL": JSON.stringify("http://127.0.0.1:9"),
    },
    server: { host: "127.0.0.1", port: 5393, strictPort: false, hmr: false, watch: null,
      fs: { allow: [repoRoot, await fs.realpath(path.join(repoRoot, "node_modules")), temporaryRoot] } },
  });
  await server.listen();
  process.env.PUPPYONE_DESKTOP_DEV_URL = `http://127.0.0.1:${server.httpServer.address().port}`;
  app.on("browser-window-created", (_event, owner) => owner.webContents.setBackgroundThrottling(false));
  process.env.VITE_DESKTOP_CLOUD_API_URL = "http://127.0.0.1:9/api/v1";
  process.env.VITE_DESKTOP_CLOUD_WEB_URL = "http://127.0.0.1:9";
  await import("../../../../electron/main.mjs");
}

async function onTheHomepage() {
  await until(`!!${button("Open Plans locally")}`, "the project on the Homepage");
  await until(`${button("Open Plans locally")}.innerText.includes("Can’t find")`, "the caption under its name");
  check("The Homepage says the project's folder cannot be found, under its name", true);
  await click("Open Plans locally");
  await until("!!document.querySelector('[role=dialog]')", "the question about it");
  const dialog = (await evaluate("document.querySelector('[role=dialog]').innerText")).replace(/[\u2066-\u2069]/g, "");
  check("Opening it asks instead of failing, and names its new name", dialog.includes("“Plans” is now called “Plans 2026”."), dialog);
  await click("Use “Plans 2026”");
  await until(`!document.querySelector('[role=dialog]') && !!${button("Open Plans 2026 locally")}`, "the project under its new name");
  check("The project is listed at its new place, with nothing left to say", !(await text()).includes("Can’t find"));
}

async function inItsWindow() {
  await click("Open Plans 2026 locally");
  await until(FILE_LISTED, "the project's files");
  // Renamed again while the project is open; PuppyOne notices when it comes back to the front.
  await fs.rename(RENAMED, FINAL);
  await evaluate("window.dispatchEvent(new Event('focus'))");
  await until("document.body.innerText.replace(/[\\u2066-\\u2069]/g, '').includes('“Plans 2026” is now called “Plans final”.')", "the notice in the window");
  // An editor that was showing a file of the folder settles on the product's words too.
  await until("!/ENOENT|Error invoking|realpath/.test(document.body.innerText)", "no system error anywhere in the window");
  check("The window says what happened to its folder in a notice, and no system error remains", true);
  await click("Use “Plans final”");
  await until(`!document.body.innerText.includes('is now called') && ${FILE_LISTED}`, "the project reopened at its new place");
  check("The project carries on from its new place", true);
  const state = JSON.parse(await fs.readFile(path.join(app.getPath("userData"), "desktop-workspace-state.json"), "utf8"));
  const recentPaths = state.recentWorkspaces.map((record) => record.path);
  check("PuppyOne remembers the project at its new place, once", recentPaths.filter((item) => item.startsWith(temporaryRoot)).join() === FINAL,
    recentPaths.join(", "));
}

async function main() {
  await app.whenReady();
  Menu.setApplicationMenu(null);
  for (let attempt = 0; attempt < 300 && !BrowserWindow.getAllWindows().length; attempt += 1) await wait(50);
  window = BrowserWindow.getAllWindows()[0];
  assert.ok(window, "production Main created a window");
  window.setContentSize(1200, 800);
  await onTheHomepage();
  await inItsWindow();
  assert.deepEqual(failures, [], "the missing project folder checks failed");
  console.log("Missing project folder smoke passed.");
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
